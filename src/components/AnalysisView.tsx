import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Play } from 'lucide-react';
import type { CollectorConfig } from '../engine/types';
import { fetchAnalysis, type AnalysisResponse } from '../services/api';

interface AnalysisViewProps {
  config: CollectorConfig;
  totalTours: number;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({ config, totalTours }) => {
  const [cible, setCible] = useState(String(config.cible));
  const [mise, setMise] = useState(String(config.mise));
  const [fenetre, setFenetre] = useState(String(config.fenetre));
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const [hoveredLag, setHoveredLag] = useState<number | null>(null);
  const [hoveredEquityIdx, setHoveredEquityIdx] = useState<number | null>(null);

  const runAnalysis = useCallback(async (c: number, m: number, f: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAnalysis({ cible: c, mise: m, fenetre: f });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’analyse.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runAnalysis(config.cible, config.mise, config.fenetre);
  }, [config.cible, config.mise, config.fenetre, totalTours, runAnalysis]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const c = Math.max(1.01, Number.parseFloat(cible.replace(',', '.')) || 2.0);
    const m = Math.max(0.1, Number.parseFloat(mise.replace(',', '.')) || 1.0);
    const f = Math.max(2, Math.min(50, Math.round(Number.parseFloat(fenetre)) || 10));
    setCible(String(c));
    setMise(String(m));
    setFenetre(String(f));
    void runAnalysis(c, m, f);
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data || data.descriptive.count === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
        <BarChart3 className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="text-base font-semibold text-slate-900">Aucune donnée à analyser</h2>
        <p className="text-sm text-slate-500">
          Enregistre tes premiers tours via le collecteur OCR, le pont sélecteur Web, l’import CSV ou la saisie manuelle pour afficher les statistiques d’équité et le backtest.
        </p>
      </div>
    );
  }

  const { descriptive, lag1, autocorrelations, distribution, backtest, params } = data;

  // Equity curve SVG geometry
  const eqPoints = descriptive.equityCurve;
  const eqMin = Math.min(0, ...eqPoints.map((p) => p.cumulativeProfit));
  const eqMax = Math.max(1, ...eqPoints.map((p) => p.cumulativeProfit));
  const eqSpan = Math.max(1e-6, eqMax - eqMin);
  const eqW = 680;
  const eqH = 190;
  const eqPad = 16;

  const eqPolyline = eqPoints
    .map((pt, idx) => {
      const x =
        eqPoints.length <= 1
          ? eqPad
          : eqPad + (idx / (eqPoints.length - 1)) * (eqW - eqPad * 2);
      const y =
        eqH - eqPad - ((pt.cumulativeProfit - eqMin) / eqSpan) * (eqH - eqPad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const zeroY = eqH - eqPad - ((0 - eqMin) / eqSpan) * (eqH - eqPad * 2);

  // Backtest comparison SVG geometry (capped cleanly to 0..10x vertical scale for legibility)
  const btPoints = backtest.testSeries;
  const btCap = 10;
  const btW = 680;
  const btH = 190;
  const btPad = 16;

  const mapBtY = (val: number) => {
    const clamped = Math.min(btCap, Math.max(1, val));
    return btH - btPad - ((clamped - 1) / (btCap - 1)) * (btH - btPad * 2);
  };
  const mapBtX = (idx: number) =>
    btPoints.length <= 1
      ? btPad
      : btPad + (idx / (btPoints.length - 1)) * (btW - btPad * 2);

  const btActualPath = btPoints
    .map((p, i) => `${mapBtX(i).toFixed(1)},${mapBtY(p.actual).toFixed(1)}`)
    .join(' ');
  const btPredPath = btPoints
    .map((p, i) => `${mapBtX(i).toFixed(1)},${mapBtY(p.predicted).toFixed(1)}`)
    .join(' ');
  const btMedianY = btPoints.length > 0 ? mapBtY(btPoints[0].medianBaseline) : btH / 2;

  return (
    <div className="space-y-6">
      {/* Parameter Controls */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="analysis-cible" className="block text-xs font-medium text-slate-600 mb-1">
              Cible de retrait (x)
            </label>
            <input
              id="analysis-cible"
              type="number"
              step="0.1"
              min="1.01"
              value={cible}
              onChange={(e) => setCible(e.target.value)}
              className="w-32 px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label htmlFor="analysis-mise" className="block text-xs font-medium text-slate-600 mb-1">
              Mise virtuelle par tour
            </label>
            <input
              id="analysis-mise"
              type="number"
              step="0.5"
              min="0.1"
              value={mise}
              onChange={(e) => setMise(e.target.value)}
              className="w-32 px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label htmlFor="analysis-fenetre" className="block text-xs font-medium text-slate-600 mb-1">
              Fenêtre modèle (tours)
            </label>
            <input
              id="analysis-fenetre"
              type="number"
              step="1"
              min="2"
              max="50"
              value={fenetre}
              onChange={(e) => setFenetre(e.target.value)}
              className="w-32 px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" />
            {loading ? 'Calcul…' : 'Lancer l’analyse'}
          </button>
        </form>
      </section>

      {/* Low Sample Warning (< 300 rounds, Section 7) */}
      {descriptive.warningLowSample && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-sm text-amber-950">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p>
            Attention : moins de 300 tours enregistrés ({descriptive.count}). Les conclusions statistiques restent fragiles — vise plusieurs milliers de tours avant de juger l’équité ou un modèle.
          </p>
        </div>
      )}

      {/* Row 1: 4-Column KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Nombre de tours</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {descriptive.count}
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono-tabular">
            Min {descriptive.min.toFixed(2)}x · Max {descriptive.max.toFixed(2)}x
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Moyenne / Médiane</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {descriptive.mean.toFixed(2)}x{' '}
            <span className="text-base font-medium text-slate-500">
              / {descriptive.median.toFixed(2)}x
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono-tabular">
            Écart-type {descriptive.stdDev.toFixed(2)}x
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Crashs avant 2.00x</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {(descriptive.under2xRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono-tabular">
            Réussite à {params.cible.toFixed(1)}x : {(descriptive.hitTargetRate * 100).toFixed(1)}%
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">
            Gain virtuel (retrait {params.cible.toFixed(1)}x)
          </div>
          <div
            className={`text-2xl font-bold font-mono-tabular mt-1 ${
              descriptive.totalVirtualProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {descriptive.totalVirtualProfit >= 0 ? '+' : ''}
            {descriptive.totalVirtualProfit.toFixed(1)}
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono-tabular">
            Moyen / tour : {descriptive.avgProfitPerRound >= 0 ? '+' : ''}
            {descriptive.avgProfitPerRound.toFixed(3)}
          </div>
        </div>
      </section>

      {/* Row 2: Independence Test (Pearson) & 70/30 Backtest Verdict */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pearson N / N+1 & Multi-lag Autocorrelation */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Test d’indépendance (tour N / tour N+1)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Corrélation de Pearson et autocorrélation sur les 10 décalages précédents.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div>
              <div className="text-xs text-slate-500">Corrélation Pearson (r)</div>
              <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-0.5">
                {lag1.r.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Valeur p (bilatérale)</div>
              <div
                className={`text-2xl font-bold font-mono-tabular mt-0.5 ${
                  lag1.significant ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {lag1.pValue.toFixed(3)}
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed">{lag1.interpretation}</p>

          {/* Autocorrelation Bar Chart */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Autocorrélation par décalage (Lag 1 à 10)</span>
              {hoveredLag !== null && autocorrelations[hoveredLag] && (
                <span className="font-mono-tabular text-slate-800 font-medium">
                  Lag {autocorrelations[hoveredLag].lag} : r={autocorrelations[hoveredLag].r.toFixed(3)} (p=
                  {autocorrelations[hoveredLag].pValue.toFixed(3)})
                </span>
              )}
            </div>
            <div className="grid grid-cols-10 gap-1.5 items-end h-28 pt-4 pb-1 px-2 border border-slate-200 rounded-lg bg-slate-50/50">
              {autocorrelations.map((item, idx) => {
                const heightPct = Math.min(100, Math.max(6, Math.abs(item.r) * 400));
                return (
                  <button
                    key={item.lag}
                    type="button"
                    onMouseEnter={() => setHoveredLag(idx)}
                    onMouseLeave={() => setHoveredLag(null)}
                    aria-label={`Lag ${item.lag}: r=${item.r.toFixed(3)}, p=${item.pValue.toFixed(3)}`}
                    className="flex flex-col items-center justify-end h-full group focus:outline-none"
                  >
                    <div
                      className={`w-full rounded-t transition-colors ${
                        item.significant
                          ? 'bg-amber-500 group-hover:bg-amber-600'
                          : 'bg-sky-600/80 group-hover:bg-sky-700'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[11px] font-mono-tabular text-slate-500 mt-1">
                      {item.lag}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Out-of-Sample 70/30 GBDT Backtest */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Backtest GBDT sans triche (70% / 30%)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Entraîné sur {backtest.trainCount} séquences, évalué sur {backtest.testCount} tours jamais vus.
              </p>
            </div>
          </div>

          {!backtest.ready ? (
            <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-sm text-slate-600">
              {backtest.verdict}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-xs text-slate-500">Erreur modèle</div>
                  <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-0.5">
                    {backtest.maeModel.toFixed(3)}
                  </div>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-xs text-slate-500">Toujours moyenne</div>
                  <div className="text-xl font-bold font-mono-tabular text-slate-700 mt-0.5">
                    {backtest.maeMeanBaseline.toFixed(3)}
                  </div>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-xs text-slate-500">Toujours médiane</div>
                  <div className="text-xl font-bold font-mono-tabular text-slate-700 mt-0.5">
                    {backtest.maeMedianBaseline.toFixed(3)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm border-t border-b border-slate-100 py-3.5">
                <div>
                  <div className="text-xs text-slate-500">
                    Précision « dépasse {backtest.targetMultiplier.toFixed(1)}x ? »
                  </div>
                  <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
                    {(backtest.directionalAccuracy * 100).toFixed(1)}%{' '}
                    <span className="text-xs font-normal text-slate-500">
                      (réponse paresseuse {(backtest.lazyBaselineAccuracy * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">
                    Gain virtuel en suivant le modèle
                  </div>
                  <div
                    className={`font-mono-tabular font-semibold mt-0.5 ${
                      backtest.modelVirtualProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {backtest.modelVirtualProfit >= 0 ? '+' : ''}
                    {backtest.modelVirtualProfit.toFixed(1)}{' '}
                    <span className="text-xs font-normal text-slate-500">
                      sur {backtest.playedRounds} tours joués
                    </span>
                  </div>
                </div>
              </div>

              <div
                className={`p-3.5 rounded-lg border flex items-start gap-2.5 text-sm ${
                  backtest.beatsBaselines
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                    : 'bg-amber-50/70 border-amber-200 text-amber-950'
                }`}
              >
                {backtest.beatsBaselines ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <span>{backtest.verdict}</span>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Row 3: Distribution Histogram & Cumulative Equity Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Distribution Histogram */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Distribution des multiplicateurs
              </h3>
              <p className="text-xs text-slate-500">Répartition empirique des crashs observés.</p>
            </div>
            {hoveredBucket !== null && distribution[hoveredBucket] && (
              <span className="text-xs font-mono-tabular font-medium text-slate-800">
                {distribution[hoveredBucket].label} : {distribution[hoveredBucket].count} (
                {distribution[hoveredBucket].percentage.toFixed(1)}%)
              </span>
            )}
          </div>

          <div className="space-y-2.5 pt-1">
            {distribution.map((b, idx) => (
              <div
                key={b.label}
                onMouseEnter={() => setHoveredBucket(idx)}
                onMouseLeave={() => setHoveredBucket(null)}
                className="grid grid-cols-12 items-center gap-3 text-xs"
              >
                <div className="col-span-3 font-mono-tabular text-slate-700">{b.label}</div>
                <div className="col-span-6 h-5 bg-slate-100 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      b.min >= 2.0 ? 'bg-sky-600' : 'bg-slate-400'
                    }`}
                    style={{ width: `${Math.max(2, b.percentage)}%` }}
                  />
                </div>
                <div className="col-span-3 text-right font-mono-tabular text-slate-600">
                  {b.count} ({b.percentage.toFixed(1)}%)
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cumulative Virtual Equity Curve */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Courbe d’équité virtuelle cumulée
              </h3>
              <p className="text-xs text-slate-500">
                Stratégie fixe : retrait à {params.cible.toFixed(1)}x avec mise {params.mise.toFixed(1)}.
              </p>
            </div>
            {hoveredEquityIdx !== null && eqPoints[hoveredEquityIdx] && (
              <span className="text-xs font-mono-tabular font-medium text-slate-800">
                Tour #{eqPoints[hoveredEquityIdx].round} :{' '}
                {eqPoints[hoveredEquityIdx].cumulativeProfit >= 0 ? '+' : ''}
                {eqPoints[hoveredEquityIdx].cumulativeProfit.toFixed(2)}
              </span>
            )}
          </div>

          <div className="border border-slate-200 rounded-lg bg-slate-50/40 p-2">
            <svg viewBox={`0 0 ${eqW} ${eqH}`} className="w-full h-48 overflow-visible">
              <line
                x1={eqPad}
                x2={eqW - eqPad}
                y1={zeroY}
                y2={zeroY}
                stroke="#CBD5E1"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              {eqPoints.length > 1 && (
                <polyline
                  fill="none"
                  stroke={descriptive.totalVirtualProfit >= 0 ? '#0284C7' : '#DC2626'}
                  strokeWidth="2"
                  points={eqPolyline}
                />
              )}
              {eqPoints.map((pt, idx) => {
                const x =
                  eqPoints.length <= 1
                    ? eqPad
                    : eqPad + (idx / (eqPoints.length - 1)) * (eqW - eqPad * 2);
                const y =
                  eqH - eqPad - ((pt.cumulativeProfit - eqMin) / eqSpan) * (eqH - eqPad * 2);
                return (
                  <circle
                    key={pt.round}
                    cx={x}
                    cy={y}
                    r={hoveredEquityIdx === idx ? 4.5 : 3}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoveredEquityIdx(idx)}
                    onMouseLeave={() => setHoveredEquityIdx(null)}
                  />
                );
              })}
            </svg>
          </div>
        </section>
      </div>

      {/* Out-of-sample Backtest Predictions vs Actual Chart */}
      {backtest.ready && btPoints.length > 1 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Données jamais vues (30% test) : Réel vs Prédit GBDT
              </h3>
              <p className="text-xs text-slate-500">
                Échelle plafonnée visuellement à 10x pour comparer la précision autour des cotes courantes.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span>— Réel (plafonné 10x)</span>
              <span className="text-sky-700 font-medium">— Prédit GBDT</span>
              <span className="text-amber-700">--- Médiane apprentissage</span>
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg bg-slate-50/40 p-2">
            <svg viewBox={`0 0 ${btW} ${btH}`} className="w-full h-48">
              <line
                x1={btPad}
                x2={btW - btPad}
                y1={btMedianY}
                y2={btMedianY}
                stroke="#D97706"
                strokeDasharray="5 4"
                strokeWidth="1.5"
              />
              <polyline fill="none" stroke="#94A3B8" strokeWidth="1.5" points={btActualPath} />
              <polyline fill="none" stroke="#0284C7" strokeWidth="2.2" points={btPredPath} />
            </svg>
          </div>
        </section>
      )}
    </div>
  );
};
