import type {
  AutocorrelationLag,
  BacktestResult,
  CollectorConfig,
  CorrelationResult,
  DescriptiveStats,
  DistributionBucket,
  LivePredictionState,
  PredictionRecord,
  RoundSource,
  TourRecord,
} from '../engine/types';

export interface AppStateResponse {
  config: CollectorConfig;
  livePrediction: LivePredictionState;
  recentTours: { rows: TourRecord[]; total: number };
  recentPredictions: { rows: PredictionRecord[]; total: number };
}

export interface AnalysisResponse {
  descriptive: DescriptiveStats;
  lag1: CorrelationResult;
  autocorrelations: AutocorrelationLag[];
  distribution: DistributionBucket[];
  backtest: BacktestResult;
  params: {
    cible: number;
    mise: number;
    fenetre: number;
  };
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Erreur serveur HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchAppState(): Promise<AppStateResponse> {
  const res = await fetch('/api/state');
  return handleJson<AppStateResponse>(res);
}

export async function fetchAnalysis(params?: {
  cible?: number;
  mise?: number;
  fenetre?: number;
}): Promise<AnalysisResponse> {
  const query = new URLSearchParams();
  if (params?.cible !== undefined) query.set('cible', String(params.cible));
  if (params?.mise !== undefined) query.set('mise', String(params.mise));
  if (params?.fenetre !== undefined) query.set('fenetre', String(params.fenetre));
  const qs = query.toString();
  const res = await fetch(`/api/analysis${qs ? `?${qs}` : ''}`);
  return handleJson<AnalysisResponse>(res);
}

export async function fetchTours(params: {
  limit?: number;
  offset?: number;
  min?: string;
  max?: string;
  source?: string;
}): Promise<{ rows: TourRecord[]; total: number }> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.min) query.set('min', params.min);
  if (params.max) query.set('max', params.max);
  if (params.source && params.source !== 'all') query.set('source', params.source);
  const res = await fetch(`/api/tours?${query.toString()}`);
  return handleJson<{ rows: TourRecord[]; total: number }>(res);
}

export async function fetchPredictions(params: {
  limit?: number;
  offset?: number;
}): Promise<{ rows: PredictionRecord[]; total: number }> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  const res = await fetch(`/api/predictions?${query.toString()}`);
  return handleJson<{ rows: PredictionRecord[]; total: number }>(res);
}

export async function postRound(
  multiplicateur: number,
  source: RoundSource
): Promise<{
  tour: TourRecord;
  retrained: boolean;
  livePrediction: LivePredictionState;
}> {
  const res = await fetch('/api/rounds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ multiplicateur, source }),
  });
  return handleJson(res);
}

export async function postRoundBatch(
  values: number[],
  source: RoundSource
): Promise<{
  inserted: number;
  retrainedCount: number;
  livePrediction: LivePredictionState;
}> {
  const res = await fetch('/api/rounds/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values, source }),
  });
  return handleJson(res);
}

export async function deleteTourById(id: number): Promise<{ livePrediction: LivePredictionState }> {
  const res = await fetch(`/api/tours/${id}`, { method: 'DELETE' });
  return handleJson(res);
}

export async function clearDatabase(): Promise<{ livePrediction: LivePredictionState }> {
  const res = await fetch('/api/tours', { method: 'DELETE' });
  return handleJson(res);
}

export async function updateConfig(
  patch: Partial<CollectorConfig>
): Promise<{ config: CollectorConfig; livePrediction: LivePredictionState }> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function retrainModel(): Promise<{
  retrained: boolean;
  trainedOnCount: number;
  trainedAt: string;
  livePrediction: LivePredictionState;
}> {
  const res = await fetch('/api/model/retrain', { method: 'POST' });
  return handleJson(res);
}

export async function probeGameUrl(
  url: string,
  selector: string
): Promise<{
  reachable: boolean;
  status: number;
  hasSelectorInInitialHtml: boolean;
  note: string;
}> {
  const res = await fetch('/api/collector/probe-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, selector }),
  });
  return handleJson(res);
}
