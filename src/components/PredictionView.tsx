import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Plus, RefreshCw, Sparkles } from 'lucide-react';
import type { LivePredictionState, PredictionRecord } from '../engine/types';
import { postRound, retrainModel } from '../services/api';

interface PredictionViewProps {
  livePrediction: LivePredictionState;
  recentPredictions: PredictionRecord[];
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefreshState: () => Promise<void>;
  onSwitchToCollector: () => void;
}

export const PredictionView: React.FC<PredictionViewProps> = ({
  livePrediction,
  recentPredictions,
  autoRefresh,
  onToggleAutoRefresh,
  onRefreshState,
  onSwitchToCollector,
}) => {
  const [manualValue, setManualValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const {
    totalTours,
    nextPrediction,
    medianBaseline,
    modelActive,
    modelTrainedAtCount,
    nextRetrainAt,
    cible,
    fenetre,
    predireTousLes,
    reliability,
  } = livePrediction;

  const minTrainThreshold = fenetre + 100;
  const progressBase = totalTours < minTrainThreshold ? 0 : nextRetrainAt - predireTousLes;
  const progressSpan = totalTours < minTrainThreshold ? minTrainThreshold : predireTousLes;
  const progressValue = Math.max(0, Math.min(progressSpan, totalTours - progressBase));
  const progressPercent = Math.round((progressValue / progressSpan) * 100);

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const parsed = Number.parseFloat(manualValue.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 1.0 || parsed > 1000000) {
      setFeedback({
        type: 'error',
        text: 'Entre un multiplicateur valide supérieur ou égal à 1.00x.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await postRound(parsed, 'manual');
      setManualValue('');
      setFeedback({
        type: 'ok',
        text: res.retrained
          ? `Tour ${parsed.toFixed(2)}x enregistré et modèle ré-entraîné automatiquement sur ${res.livePrediction.totalTours} tours.`
          : `Tour ${parsed.toFixed(2)}x enregistré dans la base SQLite.`,
      });
      await onRefreshState();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Échec de l’enregistrement.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualRetrain() {
    setFeedback(null);
    setRetraining(true);
    try {
      const res = await retrainModel();
      setFeedback({
        type: 'ok',
        text: `Modèle Gradient Boosting ré-entraîné sur ${res.trainedOnCount} tours.`,
      });
      await onRefreshState();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Impossible de ré-entraîner le modèle.',
      });
    } finally {
      setRetraining(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Main Hero Prediction Panel */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
              <span className="font-mono-tabular text-slate-700">{totalTours} tours enregistrés</span>
              <span aria-hidden="true">·</span>
              <span>{modelActive ? `Modèle GBDT actif (entraîné à ${modelTrainedAtCount} tours)` : 'Témoin médian actif'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">Seuil testé {cible.toFixed(2)}x</span>
            </div>

            <h2 className="text-lg font-medium text-slate-600">
              Pour le prochain tour, estimation calculée :
            </h2>

            {nextPrediction === null ? (
              <div className="py-2 space-y-3">
                <p className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
                  En attente de données…
                </p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Il faut au moins <span className="font-mono-tabular font-semibold">{fenetre}</span> tours
                  enregistrés pour calculer une prédiction (actuellement{' '}
                  <span className="font-mono-tabular font-semibold">{totalTours}</span>).
                </p>
                <button
                  type="button"
                  onClick={onSwitchToCollector}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Ouvrir le collecteur
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-6 pt-1">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Cote prédite</div>
                  <div
                    data-testid="predicted-multiplier"
                    className="text-5xl sm:text-6xl font-bold tracking-tight font-mono-tabular text-slate-900"
                  >
                    {nextPrediction.toFixed(2)}x
                  </div>
                </div>

                <div className="h-12 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />

                <div className="space-y-1">
                  <div className="text-xs text-slate-500">Témoin médian</div>
                  <div className="text-2xl font-semibold font-mono-tabular text-slate-700">
                    {medianBaseline !== null ? `${medianBaseline.toFixed(2)}x` : '—'}
                  </div>
                </div>

                <div className="h-12 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />

                <div className="space-y-1">
                  <div className="text-xs text-slate-500">Décision simulée ({cible.toFixed(1)}x)</div>
                  <div
                    className={`text-base font-semibold ${
                      nextPrediction >= cible ? 'text-emerald-700' : 'text-slate-600'
                    }`}
                  >
                    {nextPrediction >= cible
                      ? `Au-dessus du seuil (${cible.toFixed(1)}x)`
                      : `Sous le seuil (${cible.toFixed(1)}x)`}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onToggleAutoRefresh}
              aria-pressed={autoRefresh}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                autoRefresh
                  ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {autoRefresh ? 'Auto (2s) : Actif' : 'Auto (2s) : Pause'}
            </button>

            <button
              type="button"
              onClick={handleManualRetrain}
              disabled={retraining || totalTours < fenetre + 11}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
              {retraining ? 'Ré-entraînement…' : 'Ré-entraîner le modèle'}
            </button>
          </div>
        </div>

        {/* Reliability Verdict Line (Exact logic from Section 13) */}
        <div
          data-testid="reliability-banner"
          className={`mt-6 p-4 rounded-lg border flex items-start gap-3 text-sm ${
            reliability.verdict === 'slightly_better'
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
              : reliability.verdict === 'no_advantage'
              ? 'bg-amber-50/70 border-amber-200 text-amber-950'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
        >
          {reliability.verdict === 'slightly_better' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : reliability.verdict === 'no_advantage' ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-medium leading-relaxed">{reliability.message}</p>
            {reliability.evaluatedCount > 0 && (
              <p className="text-xs opacity-80 font-mono-tabular">
                Erreur absolue moyenne (MAE) — Modèle :{' '}
                {reliability.modelMae !== null ? reliability.modelMae.toFixed(3) : '—'} · Témoin médian :{' '}
                {reliability.baselineMae !== null ? reliability.baselineMae.toFixed(3) : '—'} · Précision seuil :{' '}
                {reliability.directionalAccuracy !== null
                  ? `${(reliability.directionalAccuracy * 100).toFixed(1)}%`
                  : '—'}
              </p>
            )}
          </div>
        </div>

        {/* Automatic 50-Round Retraining Cycle Progress */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 mb-2">
            <span>
              {totalTours < minTrainThreshold
                ? `Collecte initiale avant le premier entraînement automatique (${totalTours}/${minTrainThreshold} tours)`
                : `Cycle de ré-entraînement automatique tous les ${predireTousLes} tours`}
            </span>
            <span className="font-mono-tabular font-medium text-slate-800">
              Prochain déclenchement à {nextRetrainAt} tours
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-600 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </section>

      {/* Two-column lower section: Quick Round Observation + Walk-forward Prediction Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Quick Manual Round Entry */}
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-semibold text-slate-900">Enregistrer un tour observé</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Ajoute un résultat manuellement. Le prédicteur évalue sa prédiction précédente avant d’inscrire le résultat dans SQLite.
          </p>

          <form onSubmit={handleQuickAdd} className="mt-4 space-y-3">
            <div>
              <label htmlFor="quick-multiplier" className="block text-xs font-medium text-slate-700 mb-1">
                Multiplicateur du tour terminé
              </label>
              <div className="flex gap-2">
                <input
                  id="quick-multiplier"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 2.34"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 text-sm font-mono-tabular bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter
                </button>
              </div>
            </div>

            {feedback && (
              <p
                role="status"
                className={`text-xs leading-relaxed ${
                  feedback.type === 'error' ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {feedback.text}
              </p>
            )}
          </form>

          <div className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-1.5">
            <div className="flex justify-between">
              <span>Fenêtre glissante</span>
              <span className="font-mono-tabular text-slate-700">{fenetre} derniers tours</span>
            </div>
            <div className="flex justify-between">
              <span>Fréquence ré-entraînement</span>
              <span className="font-mono-tabular text-slate-700">Tous les {predireTousLes} tours</span>
            </div>
            <div className="flex justify-between">
              <span>Évaluations sans fuite</span>
              <span className="font-mono-tabular text-slate-700">{reliability.evaluatedCount}</span>
            </div>
          </div>
        </section>

        {/* Recent Walk-Forward Predictions Table */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Dernières évaluations honnêtes (avant résultat)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Chaque prédiction est figée avant de connaître le résultat réel du tour.
              </p>
            </div>
          </div>

          {recentPredictions.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
              <p className="text-sm text-slate-600">Aucune prédiction évaluée pour le moment.</p>
              <p className="text-xs text-slate-500 mt-1">
                Les évaluations commencent automatiquement dès le {fenetre + 1}e tour enregistré.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-4">Tour</th>
                    <th className="py-2.5 px-3 text-right">Prédit</th>
                    <th className="py-2.5 px-3 text-right">Témoin médian</th>
                    <th className="py-2.5 px-3 text-right">Réel</th>
                    <th className="py-2.5 px-3 text-right">Erreur modèle</th>
                    <th className="py-2.5 pl-3 text-right">Seuil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentPredictions.slice(0, 12).map((row) => {
                    const errModel = Math.abs(row.prediction - row.reel);
                    const errBase = Math.abs(row.pred_temoin - row.reel);
                    const directionHit = row.pred_depasse === row.reel_depasse;

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 pr-4 font-mono-tabular text-slate-600">
                          #{row.numero_tour}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular font-medium text-slate-900">
                          {row.prediction.toFixed(2)}x
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-500">
                          {row.pred_temoin.toFixed(2)}x
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono-tabular font-semibold ${
                            row.reel >= row.cible ? 'text-emerald-700' : 'text-slate-900'
                          }`}
                        >
                          {row.reel.toFixed(2)}x
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono-tabular text-xs ${
                            errModel < errBase ? 'text-emerald-700' : 'text-slate-600'
                          }`}
                        >
                          {errModel.toFixed(2)}
                        </td>
                        <td className="py-2.5 pl-3 text-right text-xs font-medium">
                          <span className={directionHit ? 'text-emerald-700' : 'text-slate-500'}>
                            {directionHit ? 'Correct' : 'Manqué'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
