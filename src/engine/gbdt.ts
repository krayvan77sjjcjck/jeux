import { computeMean, computeMedian } from './stats';
import type { BacktestPoint, BacktestResult, RegressionTreeNode, SerializedGBDT } from './types';

export interface GBDTOptions {
  nEstimators?: number;
  learningRate?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
}

function buildRegressionTree(
  X: number[][],
  residuals: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamplesLeaf: number
): RegressionTreeNode {
  const meanResidual =
    indices.reduce((acc, idx) => acc + residuals[idx], 0) / Math.max(1, indices.length);

  if (depth >= maxDepth || indices.length < minSamplesLeaf * 2) {
    return { isLeaf: true, value: meanResidual };
  }

  const numFeatures = X[0]?.length ?? 0;
  if (numFeatures === 0) {
    return { isLeaf: true, value: meanResidual };
  }

  // Variance / SSE reduction
  let totalSum = 0;
  for (let i = 0; i < indices.length; i++) {
    totalSum += residuals[indices[i]];
  }
  const n = indices.length;
  const parentScore = (totalSum * totalSum) / n;

  let bestGain = 1e-9;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  for (let f = 0; f < numFeatures; f++) {
    const sorted = [...indices].sort((a, b) => X[a][f] - X[b][f]);
    let leftSum = 0;
    let leftCount = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const idx = sorted[i];
      const nextIdx = sorted[i + 1];
      leftSum += residuals[idx];
      leftCount += 1;

      const rightCount = n - leftCount;
      if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) {
        continue;
      }

      const val = X[idx][f];
      const nextVal = X[nextIdx][f];
      if (val === nextVal) continue;

      const rightSum = totalSum - leftSum;
      const gain =
        (leftSum * leftSum) / leftCount + (rightSum * rightSum) / rightCount - parentScore;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = (val + nextVal) / 2;
        bestLeft = sorted.slice(0, i + 1);
        bestRight = sorted.slice(i + 1);
      }
    }
  }

  if (bestFeature === -1) {
    return { isLeaf: true, value: meanResidual };
  }

  return {
    isLeaf: false,
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: buildRegressionTree(X, residuals, bestLeft, depth + 1, maxDepth, minSamplesLeaf),
    right: buildRegressionTree(X, residuals, bestRight, depth + 1, maxDepth, minSamplesLeaf),
  };
}

function predictTree(node: RegressionTreeNode, row: number[]): number {
  let curr = node;
  while (!curr.isLeaf) {
    const f = curr.featureIndex ?? 0;
    const t = curr.threshold ?? 0;
    if (row[f] <= t) {
      if (!curr.left) break;
      curr = curr.left;
    } else {
      if (!curr.right) break;
      curr = curr.right;
    }
  }
  return curr.value ?? 0;
}

export class GradientBoostingRegressor {
  private readonly nEstimators: number;
  private readonly learningRate: number;
  private readonly maxDepth: number;
  private readonly minSamplesLeaf: number;
  private initPrediction = 1.0;
  private trees: RegressionTreeNode[] = [];
  private windowSize = 10;

  constructor(options: GBDTOptions = {}) {
    this.nEstimators = options.nEstimators ?? 50;
    this.learningRate = options.learningRate ?? 0.06;
    this.maxDepth = options.maxDepth ?? 3;
    this.minSamplesLeaf = options.minSamplesLeaf ?? 8;
  }

  public fit(X: number[][], y: number[]): this {
    if (X.length === 0 || X.length !== y.length) {
      throw new Error('Données d’entraînement invalides pour GradientBoostingRegressor.');
    }

    this.windowSize = X[0].length;
    this.initPrediction = computeMean(y);
    this.trees = [];

    const n = y.length;
    const currentPreds = new Array<number>(n).fill(this.initPrediction);
    const allIndices = Array.from({ length: n }, (_, i) => i);

    for (let m = 0; m < this.nEstimators; m++) {
      const residuals = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        residuals[i] = y[i] - currentPreds[i];
      }

      const tree = buildRegressionTree(
        X,
        residuals,
        allIndices,
        0,
        this.maxDepth,
        this.minSamplesLeaf
      );
      this.trees.push(tree);

      for (let i = 0; i < n; i++) {
        currentPreds[i] += this.learningRate * predictTree(tree, X[i]);
      }
    }

    return this;
  }

  public predictOne(row: number[]): number {
    let pred = this.initPrediction;
    for (let i = 0; i < this.trees.length; i++) {
      pred += this.learningRate * predictTree(this.trees[i], row);
    }
    // Crash multipliers cannot be below 1.00x
    return Math.max(1.0, Math.round(pred * 100) / 100);
  }

  public predict(X: number[][]): number[] {
    return X.map((row) => this.predictOne(row));
  }

  public serialize(trainedOnCount: number): SerializedGBDT {
    return {
      version: 1,
      windowSize: this.windowSize,
      learningRate: this.learningRate,
      initPrediction: this.initPrediction,
      trees: this.trees,
      trainedAt: new Date().toISOString(),
      trainedOnCount,
    };
  }

  public static deserialize(data: SerializedGBDT): GradientBoostingRegressor {
    const model = new GradientBoostingRegressor({
      nEstimators: data.trees.length,
      learningRate: data.learningRate,
    });
    model.windowSize = data.windowSize;
    model.initPrediction = data.initPrediction;
    model.trees = data.trees;
    return model;
  }
}

export function buildSlidingWindowDataset(
  values: number[],
  windowSize: number
): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = windowSize; i < values.length; i++) {
    X.push(values.slice(i - windowSize, i));
    y.push(values[i]);
  }
  return { X, y };
}

export function trainCrashModel(
  values: number[],
  windowSize = 10
): SerializedGBDT | null {
  if (values.length <= windowSize + 10) {
    return null;
  }
  const { X, y } = buildSlidingWindowDataset(values, windowSize);
  const model = new GradientBoostingRegressor({
    nEstimators: 60,
    learningRate: 0.08,
    maxDepth: 3,
    minSamplesLeaf: 5,
  }).fit(X, y);
  return model.serialize(values.length);
}

/**
 * Replicates Section 7 ("analyse.py"): 70% train / 30% unseen test backtest,
 * comparing GBDT model against mean baseline, median baseline, and majority-class baseline.
 */
export function runWalkForwardBacktest(
  values: number[],
  options: {
    windowSize?: number;
    targetMultiplier?: number;
    betSize?: number;
    trainRatio?: number;
  } = {}
): BacktestResult {
  const windowSize = Math.max(2, Math.floor(options.windowSize ?? 10));
  const targetMultiplier = options.targetMultiplier ?? 2.0;
  const betSize = options.betSize ?? 1.0;
  const trainRatio = options.trainRatio ?? 0.7;

  const minBacktestRounds = windowSize + 20;
  if (values.length < minBacktestRounds) {
    return {
      ready: false,
      sampleWarning: true,
      totalRounds: values.length,
      windowSize,
      trainCount: 0,
      testCount: 0,
      targetMultiplier,
      betSize,
      maeModel: 0,
      maeMeanBaseline: 0,
      maeMedianBaseline: 0,
      directionalAccuracy: 0,
      lazyBaselineAccuracy: 0,
      playedRounds: 0,
      modelVirtualProfit: 0,
      modelAvgProfitPerPlayed: 0,
      beatsBaselines: false,
      verdict: `Minimum ${minBacktestRounds} tours requis pour lancer le backtest hors-échantillon (actuellement ${values.length}).`,
      testSeries: [],
    };
  }

  const { X, y } = buildSlidingWindowDataset(values, windowSize);
  const splitIndex = Math.max(10, Math.floor(X.length * trainRatio));

  const XTrain = X.slice(0, splitIndex);
  const yTrain = y.slice(0, splitIndex);
  const XTest = X.slice(splitIndex);
  const yTest = y.slice(splitIndex);

  const model = new GradientBoostingRegressor({
    nEstimators: 60,
    learningRate: 0.08,
    maxDepth: 3,
    minSamplesLeaf: 5,
  }).fit(XTrain, yTrain);

  const preds = model.predict(XTest);
  const trainMean = computeMean(yTrain);
  const trainMedian = computeMedian(yTrain);

  let sumAbsModel = 0;
  let sumAbsMean = 0;
  let sumAbsMedian = 0;
  let correctDirection = 0;
  let realHitCount = 0;
  let playedRounds = 0;
  let modelVirtualProfit = 0;

  const series: BacktestPoint[] = [];

  for (let i = 0; i < yTest.length; i++) {
    const actual = yTest[i];
    const predicted = preds[i];

    sumAbsModel += Math.abs(predicted - actual);
    sumAbsMean += Math.abs(trainMean - actual);
    sumAbsMedian += Math.abs(trainMedian - actual);

    const predOk = predicted >= targetMultiplier;
    const realOk = actual >= targetMultiplier;
    if (realOk) realHitCount += 1;
    if (predOk === realOk) correctDirection += 1;

    if (predOk) {
      playedRounds += 1;
      modelVirtualProfit += realOk ? betSize * (targetMultiplier - 1) : -betSize;
    }

    series.push({
      index: splitIndex + windowSize + i + 1,
      actual,
      predicted,
      medianBaseline: Math.round(trainMedian * 100) / 100,
    });
  }

  const testCount = yTest.length;
  const maeModel = sumAbsModel / testCount;
  const maeMeanBaseline = sumAbsMean / testCount;
  const maeMedianBaseline = sumAbsMedian / testCount;
  const directionalAccuracy = correctDirection / testCount;

  const realHitRate = realHitCount / testCount;
  const lazyBaselineAccuracy = Math.max(realHitRate, 1 - realHitRate);
  const beatsBaselines = maeModel < maeMeanBaseline && maeModel < maeMedianBaseline;
  const sampleWarning = values.length < windowSize + 100;

  const verdict = beatsBaselines
    ? sampleWarning
      ? 'Le modèle bat légèrement les témoins sur cet échantillon réduit. Collecte plusieurs milliers de tours pour écarter le hasard.'
      : 'Le modèle obtient une erreur inférieure aux témoins sur données jamais vues — vérifie la stabilité sur un historique plus long avant de conclure.'
    : 'Le modèle ne bat pas les témoins (moyenne / médiane) : le jeu se comporte comme un vrai hasard.';

  return {
    ready: true,
    sampleWarning,
    totalRounds: values.length,
    windowSize,
    trainCount: XTrain.length,
    testCount,
    targetMultiplier,
    betSize,
    maeModel,
    maeMeanBaseline,
    maeMedianBaseline,
    directionalAccuracy,
    lazyBaselineAccuracy,
    playedRounds,
    modelVirtualProfit: Math.round(modelVirtualProfit * 100) / 100,
    modelAvgProfitPerPlayed: playedRounds > 0 ? modelVirtualProfit / playedRounds : 0,
    beatsBaselines,
    verdict,
    testSeries: series.slice(-140),
  };
}
