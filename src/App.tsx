import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Camera,
  Database,
  Menu,
  RefreshCw,
  X,
} from 'lucide-react';
import { AnalysisView } from './components/AnalysisView';
import { CollectorView } from './components/CollectorView';
import { DatabaseView } from './components/DatabaseView';
import { GuideView } from './components/GuideView';
import { PredictionView } from './components/PredictionView';
import { fetchAppState, type AppStateResponse } from './services/api';

type NavTab = 'prediction' | 'collector' | 'analysis' | 'database' | 'guide';

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'prediction', label: 'Prédiction en direct', icon: Activity },
  { id: 'collector', label: 'Collecteur & OCR', icon: Camera },
  { id: 'analysis', label: 'Analyse & Backtest', icon: BarChart3 },
  { id: 'database', label: 'Base SQLite', icon: Database },
  { id: 'guide', label: 'Guide & Dépannage', icon: BookOpen },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('prediction');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [state, setState] = useState<AppStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const next = await fetchAppState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadState(false);
  }, [loadState]);

  useEffect(() => {
    if (!autoRefresh || activeTab !== 'prediction') return;
    const id = window.setInterval(() => {
      void loadState(true);
    }, 2000);
    return () => window.clearInterval(id);
  }, [autoRefresh, activeTab, loadState]);

  const activeNav = NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0];

  function handleSelectTab(tab: NavTab) {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A]">
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Workspace Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              CrashLab
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fermer le menu"
              className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav aria-label="Navigation principale" className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-lg transition-colors text-left whitespace-nowrap ${
                    isActive
                      ? 'bg-sky-50 text-sky-900 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-sky-600' : 'text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-5 border-t border-slate-200 space-y-2 text-xs text-slate-500">
          {state && (
            <div className="font-mono-tabular text-slate-700 font-medium">
              {state.livePrediction.totalTours} tours · {state.livePrediction.totalEvaluated} évalués
            </div>
          )}
          <p className="leading-relaxed">
            Observation, base SQLite et simulation statistique. Aucune mise réelle.
          </p>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir le menu de navigation"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline">CrashLab</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {activeNav.label}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadState(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1280px] w-full mx-auto">
          {loading && !state ? (
            <div className="space-y-4">
              <div className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
              <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : error && !state ? (
            <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
              {error}
            </div>
          ) : state ? (
            <>
              {activeTab === 'prediction' && (
                <PredictionView
                  livePrediction={state.livePrediction}
                  recentPredictions={state.recentPredictions.rows}
                  autoRefresh={autoRefresh}
                  onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
                  onRefreshState={() => loadState(false)}
                  onSwitchToCollector={() => setActiveTab('collector')}
                />
              )}

              {activeTab === 'collector' && (
                <CollectorView
                  config={state.config}
                  onConfigSaved={(nextConfig) =>
                    setState((prev) => (prev ? { ...prev, config: nextConfig } : prev))
                  }
                  onRoundRecorded={() => loadState(false)}
                />
              )}

              {activeTab === 'analysis' && (
                <AnalysisView
                  config={state.config}
                  totalTours={state.livePrediction.totalTours}
                />
              )}

              {activeTab === 'database' && (
                <DatabaseView onDataChanged={() => loadState(false)} />
              )}

              {activeTab === 'guide' && <GuideView />}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
