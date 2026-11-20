import React, { useCallback, useEffect, useState } from 'react';
import { Download, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { PredictionRecord, TourRecord } from '../engine/types';
import {
  clearDatabase,
  deleteTourById,
  fetchPredictions,
  fetchTours,
} from '../services/api';

interface DatabaseViewProps {
  onDataChanged: () => Promise<void>;
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({ onDataChanged }) => {
  const [activeTable, setActiveTable] = useState<'tours' | 'predictions'>('tours');
  const [tours, setTours] = useState<TourRecord[]>([]);
  const [toursTotal, setToursTotal] = useState(0);
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [predictionsTotal, setPredictionsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [minFilter, setMinFilter] = useState('');
  const [maxFilter, setMaxFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const pageSize = 40;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [toursRes, predsRes] = await Promise.all([
        fetchTours({
          limit: activeTable === 'tours' ? pageSize : 1,
          offset: activeTable === 'tours' ? page * pageSize : 0,
          min: minFilter,
          max: maxFilter,
          source: sourceFilter,
        }),
        fetchPredictions({
          limit: activeTable === 'predictions' ? pageSize : 1,
          offset: activeTable === 'predictions' ? page * pageSize : 0,
        }),
      ]);
      if (activeTable === 'tours') {
        setTours(toursRes.rows);
      } else {
        setPredictions(predsRes.rows);
      }
      setToursTotal(toursRes.total);
      setPredictionsTotal(predsRes.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la lecture SQLite.');
    } finally {
      setLoading(false);
    }
  }, [activeTable, page, minFilter, maxFilter, sourceFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleDeleteTour(id: number) {
    setBusyAction(true);
    try {
      await deleteTourById(id);
      await loadData();
      await onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer ce tour.');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleClearAll() {
    setBusyAction(true);
    try {
      await clearDatabase();
      setConfirmClear(false);
      setPage(0);
      await loadData();
      await onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de réinitialiser la base.');
    } finally {
      setBusyAction(false);
    }
  }

  const totalCount = activeTable === 'tours' ? toursTotal : predictionsTotal;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => {
                setActiveTable('tours');
                setPage(0);
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTable === 'tours'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Table tours ({toursTotal})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTable('predictions');
                setPage(0);
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTable === 'predictions'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Table predictions ({predictionsTotal})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="/api/export/csv"
              download="tours.csv"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Exporter CSV
            </a>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Vider la base
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <span className="text-xs font-medium text-red-800">Confirmer la suppression ?</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={busyAction}
                  className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded whitespace-nowrap shrink-0"
                >
                  Oui, vider
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded whitespace-nowrap shrink-0"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filters for Tours */}
        {activeTable === 'tours' && (
          <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="filter-min" className="block text-xs font-medium text-slate-600 mb-1">
                Multiplicateur min
              </label>
              <input
                id="filter-min"
                type="number"
                step="0.1"
                min="1"
                placeholder="1.00"
                value={minFilter}
                onChange={(e) => {
                  setMinFilter(e.target.value);
                  setPage(0);
                }}
                className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label htmlFor="filter-max" className="block text-xs font-medium text-slate-600 mb-1">
                Multiplicateur max
              </label>
              <input
                id="filter-max"
                type="number"
                step="0.1"
                min="1"
                placeholder="500.00"
                value={maxFilter}
                onChange={(e) => {
                  setMaxFilter(e.target.value);
                  setPage(0);
                }}
                className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label htmlFor="filter-source" className="block text-xs font-medium text-slate-600 mb-1">
                Source de collecte
              </label>
              <select
                id="filter-source"
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setPage(0);
                }}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="all">Toutes les sources</option>
                <option value="ocr">OCR Écran</option>
                <option value="dom">Sélecteur DOM / Bookmarklet</option>
                <option value="manual">Saisie manuelle</option>
                <option value="import">Import CSV / Texte</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setMinFilter('');
                  setMaxFilter('');
                  setSourceFilter('all');
                  setPage(0);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                Réinitialiser filtres
              </button>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Data Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : totalCount === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Aucun enregistrement dans la table {activeTable}.
            </p>
            <p className="text-xs text-slate-500">
              Lance une collecte OCR, utilise le pont sélecteur Web ou importe tes propres résultats pour alimenter tours.db.
            </p>
          </div>
        ) : activeTable === 'tours' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">Horodatage</th>
                  <th className="py-3 px-4 text-right">Multiplicateur</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tours.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-500">#{row.id}</td>
                    <td className="py-2.5 px-4 font-mono-tabular text-xs text-slate-600">
                      {new Date(row.horodatage).toLocaleString('fr-FR')}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono-tabular font-semibold ${
                        row.multiplicateur >= 10
                          ? 'text-sky-700'
                          : row.multiplicateur >= 2
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {row.multiplicateur.toFixed(2)}x
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">{row.source}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteTour(row.id)}
                        disabled={busyAction}
                        aria-label={`Supprimer le tour #${row.id} (${row.multiplicateur.toFixed(2)}x)`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Tour</th>
                  <th className="py-3 px-4">Horodatage</th>
                  <th className="py-3 px-4 text-right">Prédit</th>
                  <th className="py-3 px-4 text-right">Témoin médian</th>
                  <th className="py-3 px-4 text-right">Réel</th>
                  <th className="py-3 px-4 text-right">Seuil</th>
                  <th className="py-3 px-4 text-right">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {predictions.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-600">
                      #{row.numero_tour}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-xs text-slate-600">
                      {new Date(row.horodatage).toLocaleString('fr-FR')}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular font-medium text-slate-900">
                      {row.prediction.toFixed(2)}x
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-500">
                      {row.pred_temoin.toFixed(2)}x
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                      {row.reel.toFixed(2)}x
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-xs text-slate-600">
                      {row.cible.toFixed(2)}x
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-xs text-slate-700">
                      {Math.abs(row.prediction - row.reel).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalCount > pageSize && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
            <span className="font-mono-tabular">
              Page {page + 1} sur {totalPages} · {totalCount} lignes
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50"
              >
                Précédent
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
