import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMultiplierFromText, RoundStabilityTracker } from './ocrParser';
import {
  computeDescriptiveStats,
  computeDistributionBuckets,
  pearsonCorrelation,
} from './stats';
import { GradientBoostingRegressor, runWalkForwardBacktest, trainCrashModel } from './gbdt';
import { generateCrashMultiplier, generateSeedDataset } from './simulator';

test('extractMultiplierFromText parses standard, European comma, and noisy OCR strings', () => {
  assert.equal(extractMultiplierFromText('2.45x'), 2.45);
  assert.equal(extractMultiplierFromText('  1,87 x  '), 1.87);
  assert.equal(extractMultiplierFromText('Cote: 14.20x'), 14.2);
  assert.equal(extractMultiplierFromText('1.00x'), 1.0);
  assert.equal(extractMultiplierFromText('0.45x'), null); // below 1.0x invalid
  assert.equal(extractMultiplierFromText('En attente...'), null);
});

test('RoundStabilityTracker triggers exactly once after N identical frozen readings', () => {
  const tracker = new RoundStabilityTracker(5);

  // Rising multiplier: never completes
  assert.equal(tracker.observe(1.12).completedRound, null);
  assert.equal(tracker.observe(1.45).completedRound, null);
  assert.equal(tracker.observe(1.89).completedRound, null);

  // Frozen at 2.34x: first observation sets stable=0, next 5 equal readings reach stable=5
  assert.equal(tracker.observe(2.34).completedRound, null);
  for (let i = 1; i <= 4; i++) {
    assert.equal(tracker.observe(2.34).completedRound, null);
  }
  // 5th consecutive match triggers completion
  const trigger = tracker.observe(2.34);
  assert.equal(trigger.completedRound, 2.34);
  assert.equal(trigger.stableCount, 5);

  // Subsequent identical readings do NOT duplicate the round
  assert.equal(tracker.observe(2.34).completedRound, null);
  assert.equal(tracker.observe(2.34).completedRound, null);

  // Next round starts climbing again
  assert.equal(tracker.observe(1.05).completedRound, null);
});

test('pearsonCorrelation computes exact positive, negative, and independent p-values', () => {
  const perfect = pearsonCorrelation([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12]);
  assert.ok(Math.abs(perfect.r - 1.0) < 1e-9);
  assert.ok(perfect.pValue < 0.001);
  assert.equal(perfect.significant, true);

  const seedData = generateSeedDataset(500, 999);
  const lag1 = pearsonCorrelation(seedData.slice(0, -1), seedData.slice(1));
  assert.ok(Math.abs(lag1.r) < 0.15);
  assert.ok(lag1.pValue > 0.05);
  assert.equal(lag1.significant, false);
});

test('computeDescriptiveStats & distribution buckets accurately measure house edge', () => {
  const sample = [1.0, 1.5, 2.0, 3.0, 12.5];
  const stats = computeDescriptiveStats(sample, 2.0, 1.0);
  assert.equal(stats.count, 5);
  assert.equal(stats.median, 2.0);
  assert.equal(stats.max, 12.5);
  assert.equal(stats.under2xRate, 0.4);
  assert.equal(stats.hitTargetRate, 0.6);
  // 3 wins (+1 each) and 2 losses (-1 each) => +1.0
  assert.equal(stats.totalVirtualProfit, 1.0);

  const buckets = computeDistributionBuckets(sample);
  const totalBucketed = buckets.reduce((sum, b) => sum + b.count, 0);
  assert.equal(totalBucketed, 5);
});

test('GradientBoostingRegressor learns a deterministic pattern and serializes cleanly', () => {
  const X = Array.from({ length: 80 }, (_, i) => [i % 2 === 0 ? 1.1 : 3.5, 2.0, 1.5]);
  const y = X.map((row) => (row[0] < 2 ? 4.2 : 1.3));

  const model = new GradientBoostingRegressor({ nEstimators: 30, learningRate: 0.15 }).fit(X, y);
  const predLow = model.predictOne([1.1, 2.0, 1.5]);
  const predHigh = model.predictOne([3.5, 2.0, 1.5]);

  assert.ok(predLow > 3.5, `Expected > 3.5, got ${predLow}`);
  assert.ok(predHigh < 2.0, `Expected < 2.0, got ${predHigh}`);

  const serialized = model.serialize(80);
  const restored = GradientBoostingRegressor.deserialize(serialized);
  assert.equal(restored.predictOne([1.1, 2.0, 1.5]), predLow);
});

test('runWalkForwardBacktest evaluates out-of-sample performance without leakage', () => {
  const fairRounds = generateSeedDataset(220, 777);
  const backtest = runWalkForwardBacktest(fairRounds, {
    windowSize: 10,
    targetMultiplier: 2.0,
    betSize: 1.0,
  });

  assert.equal(backtest.ready, true);
  assert.equal(backtest.sampleWarning, false);
  assert.ok(backtest.trainCount > 0 && backtest.testCount > 0);
  assert.ok(backtest.maeModel > 0 && backtest.maeMedianBaseline > 0);

  const trained = trainCrashModel(fairRounds, 10);
  assert.ok(trained !== null);
  assert.equal(trained?.trainedOnCount, 220);

  // Verify biased stream generator actually generates valid >=1.00x multipliers
  const biasedSample = generateCrashMultiplier(() => 0.5, 'biased_pattern', 1.15);
  assert.ok(biasedSample >= 1.65);
});
