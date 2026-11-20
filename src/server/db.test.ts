import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CrashDatabase } from './db';

test('CrashDatabase starts completely empty and triggers GBDT retraining at 150 rounds without leakage', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crashlab-test-'));
  const dbPath = path.join(tmpDir, 'test.db');

  try {
    const db = new CrashDatabase(dbPath);
    const initialState = db.getLivePredictionState();

    // Must start 100% blank with zero pre-filled rounds or predictions
    assert.equal(initialState.totalTours, 0);
    assert.equal(initialState.totalEvaluated, 0);
    assert.equal(initialState.nextPrediction, null);
    assert.equal(initialState.medianBaseline, null);
    assert.equal(initialState.modelActive, false);
    assert.equal(initialState.modelTrainedAtCount, null);

    // Insert 149 rounds: model shouldn't train until >= 110 AND multiple of 50 (so at 150)
    db.insertBatchWithWalkForward(
      Array.from({ length: 149 }, (_, i) => 1.2 + (i % 5) * 0.4),
      'manual'
    );
    const state149 = db.getLivePredictionState();
    assert.equal(state149.totalTours, 149);
    assert.equal(state149.modelActive, false);

    // Recording round 150 triggers automatic GBDT training!
    const res150 = db.recordRound(2.55, 'manual');
    assert.equal(res150.retrained, true);
    assert.equal(res150.livePrediction.totalTours, 150);
    assert.equal(res150.livePrediction.modelActive, true);
    assert.equal(res150.livePrediction.modelTrainedAtCount, 150);
    assert.equal(res150.livePrediction.nextRetrainAt, 200);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
