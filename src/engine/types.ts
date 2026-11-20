export type RoundSource = 'ocr' | 'dom' | 'manual' | 'import' | 'sim' | 'bookmarklet';

export interface TourRecord {
  id: number;
  horodatage: string;
  multiplicateur: number;
  source: RoundSource;
}

export interface PredictionRecord {
  id: number;
  horodatage: string;
  numero_tour: number;
  prediction: number;
  reel: number;
  pred_depasse: number;
  reel_depasse: number;
  pred_temoin: number;
  cible: number;
}

export interface ZoneConfig {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CollectorConfig {
  zone: ZoneConfig;
  intervalle_secondes: number;
  stable_requis: number;
  url_jeu: string;
  selecteur_multiplicateur: string;
  predire_tous_les: number;
  fenetre: number;
  cible: number;
  mise: number;
}

export interface LivePredictionState {
  totalTours: number;
  totalEvaluated: number;
  nextPrediction: number | null;
  medianBaseline: number | null;
  modelActive: boolean;
  modelTrainedAtCount: number | null;
  lastTrainedAt: string | null;
  nextRetrainAt: number;
  cible: number;
  fenetre: number;
  predireTousLes: number;
  reliability: {
    ready: boolean;
    evaluatedCount: number;
    minRequired: number;
    modelMae: number | null;
    baselineMae: number | null;
    modelBeatsBaseline: boolean;
    directionalAccuracy: number | null;
    verdict: 'insufficient' | 'slightly_better' | 'no_advantage';
    message: string;
  };
}

export interface DescriptiveStats {
  count: number;
  warningLowSample: boolean;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  under2xRate: number;
  hitTargetRate: number;
  totalVirtualProfit: number;
  avgProfitPerRound: number;
  equityCurve: { round: number; cumulativeProfit: number; multiplier: number }[];
}

export interface CorrelationResult {
  r: number;
  pValue: number;
  n: number;
  significant: boolean;
  interpretation: string;
}

export interface AutocorrelationLag {
  lag: number;
  r: number;
  pValue: number;
  significant: boolean;
}

export interface DistributionBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
  percentage: number;
}

export interface BacktestPoint {
  index: number;
  actual: number;
  predicted: number;
  medianBaseline: number;
}

export interface BacktestResult {
  ready: boolean;
  sampleWarning: boolean;
  totalRounds: number;
  windowSize: number;
  trainCount: number;
  testCount: number;
  targetMultiplier: number;
  betSize: number;
  maeModel: number;
  maeMeanBaseline: number;
  maeMedianBaseline: number;
  directionalAccuracy: number;
  lazyBaselineAccuracy: number;
  playedRounds: number;
  modelVirtualProfit: number;
  modelAvgProfitPerPlayed: number;
  beatsBaselines: boolean;
  verdict: string;
  testSeries: BacktestPoint[];
}

export interface RegressionTreeNode {
  isLeaf: boolean;
  value?: number;
  featureIndex?: number;
  threshold?: number;
  left?: RegressionTreeNode;
  right?: RegressionTreeNode;
}

export interface SerializedGBDT {
  version: number;
  windowSize: number;
  learningRate: number;
  initPrediction: number;
  trees: RegressionTreeNode[];
  trainedAt: string;
  trainedOnCount: number;
}
