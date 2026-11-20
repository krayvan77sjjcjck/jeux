import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GradientBoostingRegressor, trainCrashModel } from '../engine/gbdt';
import { computeMedian } from '../engine/stats';
import type {
  CollectorConfig,
  LivePredictionState,
  PredictionRecord,
  RoundSource,
  SerializedGBDT,
  TourRecord,
} from '../engine/types';

export const DEFAULT_CONFIG: CollectorConfig = {
  zone: { left: 800, top: 400, width: 300, height: 100 },
  intervalle_secondes: 0.2,
  stable_requis: 5,
  url_jeu: '',
  selecteur_multiplicateur: '.multiplicateur',
  predire_tous_les: 50,
  fenetre: 10,
  cible: 2.0,
  mise: 1.0,
};

export class CrashDatabase {
  private db: DatabaseSync;

  constructor(dbPath = path.resolve(process.cwd(), 'data', 'tours.db')) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    this.seedIfFirstRun();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        horodatage TEXT NOT NULL,
        multiplicateur REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual'
      );
      CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        horodatage TEXT NOT NULL,
        numero_tour INTEGER NOT NULL,
        prediction REAL NOT NULL,
        reel REAL NOT NULL,
        pred_depasse INTEGER NOT NULL,
        reel_depasse INTEGER NOT NULL,
        pred_temoin REAL NOT NULL,
        cible REAL NOT NULL DEFAULT 2.0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private seedIfFirstRun(): void {
    const initialized = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('initialized') as { value: string } | undefined;

    if (initialized) {
      return;
    }

    this.saveConfig(DEFAULT_CONFIG);

    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('initialized', '1');
  }

  public getConfig(): CollectorConfig {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('config') as { value: string } | undefined;
    if (!row) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(row.value) as Partial<CollectorConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        zone: {
          ...DEFAULT_CONFIG.zone,
          ...(parsed.zone ?? {}),
        },
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  public saveConfig(config: CollectorConfig): CollectorConfig {
    const sanitized: CollectorConfig = {
      zone: {
        left: Math.max(0, Math.round(config.zone.left)),
        top: Math.max(0, Math.round(config.zone.top)),
        width: Math.max(20, Math.min(4000, Math.round(config.zone.width))),
        height: Math.max(20, Math.min(4000, Math.round(config.zone.height))),
      },
      intervalle_secondes: Math.max(0.1, Math.min(10, Number(config.intervalle_secondes) || 0.2)),
      stable_requis: Math.max(2, Math.min(20, Math.round(config.stable_requis) || 5)),
      url_jeu: String(config.url_jeu || '').slice(0, 500),
      selecteur_multiplicateur: String(config.selecteur_multiplicateur || '.multiplicateur').slice(
        0,
        200
      ),
      predire_tous_les: Math.max(10, Math.min(500, Math.round(config.predire_tous_les) || 50)),
      fenetre: Math.max(3, Math.min(50, Math.round(config.fenetre) || 10)),
      cible: Math.max(1.01, Math.min(1000, Number(config.cible) || 2.0)),
      mise: Math.max(0.1, Math.min(100000, Number(config.mise) || 1.0)),
    };

    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('config', JSON.stringify(sanitized));
    return sanitized;
  }

  public getSavedModel(): SerializedGBDT | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('trained_model') as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as SerializedGBDT;
    } catch {
      return null;
    }
  }

  private saveModel(model: SerializedGBDT | null): void {
    if (!model) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run('trained_model');
      return;
    }
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('trained_model', JSON.stringify(model));
  }

  public getAllMultipliers(): number[] {
    const rows = this.db
      .prepare('SELECT multiplicateur FROM tours ORDER BY id ASC')
      .all() as { multiplicateur: number }[];
    return rows.map((r) => r.multiplicateur);
  }

  public getTours(options: {
    limit?: number;
    offset?: number;
    min?: number;
    max?: number;
    source?: string;
  } = {}): { rows: TourRecord[]; total: number } {
    const limit = Math.max(1, Math.min(500, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (typeof options.min === 'number' && Number.isFinite(options.min)) {
      conditions.push('multiplicateur >= ?');
      params.push(options.min);
    }
    if (typeof options.max === 'number' && Number.isFinite(options.max)) {
      conditions.push('multiplicateur <= ?');
      params.push(options.max);
    }
    if (options.source && options.source !== 'all') {
      conditions.push('source = ?');
      params.push(options.source);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tours ${where}`)
      .get(...params) as { count: number };

    const rows = this.db
      .prepare(`SELECT id, horodatage, multiplicateur, source FROM tours ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as TourRecord[];

    return { rows, total: countRow.count };
  }

  public getPredictions(options: { limit?: number; offset?: number } = {}): {
    rows: PredictionRecord[];
    total: number;
  } {
    const limit = Math.max(1, Math.min(500, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);

    const countRow = this.db
      .prepare('SELECT COUNT(*) AS count FROM predictions')
      .get() as { count: number };

    const rows = this.db
      .prepare(
        `SELECT id, horodatage, numero_tour, prediction, reel, pred_depasse, reel_depasse, pred_temoin, cible
         FROM predictions ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as unknown as PredictionRecord[];

    return { rows, total: countRow.count };
  }

  public predictNext(
    values: number[],
    config: CollectorConfig,
    savedModel: SerializedGBDT | null
  ): { prediction: number | null; medianBaseline: number | null; modelActive: boolean } {
    if (values.length < config.fenetre) {
      return { prediction: null, medianBaseline: null, modelActive: false };
    }

    const medianBaseline = Math.round(computeMedian(values) * 100) / 100;
    if (!savedModel || savedModel.windowSize !== config.fenetre) {
      return {
        prediction: medianBaseline,
        medianBaseline,
        modelActive: false,
      };
    }

    const regressor = GradientBoostingRegressor.deserialize(savedModel);
    const window = values.slice(-config.fenetre);
    const pred = regressor.predictOne(window);
    return {
      prediction: pred,
      medianBaseline,
      modelActive: true,
    };
  }

  public recordRound(multiplicateur: number, source: RoundSource = 'manual'): {
    tour: TourRecord;
    retrained: boolean;
    livePrediction: LivePredictionState;
  } {
    const rounded = Math.round(multiplicateur * 100) / 100;
    if (!Number.isFinite(rounded) || rounded < 1.0 || rounded > 1_000_000) {
      throw new Error('Multiplicateur invalide (doit être compris entre 1.00x et 1 000 000x).');
    }

    const config = this.getConfig();
    const pastValues = this.getAllMultipliers();
    let savedModel = this.getSavedModel();

    const now = new Date().toISOString();
    const roundNumber = pastValues.length + 1;

    // 1) Evaluate BEFORE inserting the real result (no cheating / zero leakage)
    const { prediction, medianBaseline } = this.predictNext(pastValues, config, savedModel);
    if (prediction !== null && medianBaseline !== null) {
      this.db
        .prepare(
          `INSERT INTO predictions
            (horodatage, numero_tour, prediction, reel, pred_depasse, reel_depasse, pred_temoin, cible)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          now,
          roundNumber,
          prediction,
          rounded,
          prediction >= config.cible ? 1 : 0,
          rounded >= config.cible ? 1 : 0,
          medianBaseline,
          config.cible
        );
    }

    // 2) Insert the observed round into SQLite
    const insertRes = this.db
      .prepare('INSERT INTO tours (horodatage, multiplicateur, source) VALUES (?, ?, ?)')
      .run(now, rounded, source);

    const newTour: TourRecord = {
      id: Number(insertRes.lastInsertRowid),
      horodatage: now,
      multiplicateur: rounded,
      source,
    };

    // 3) Re-train every `predire_tous_les` rounds once >= fenetre + 100
    const allAfter = [...pastValues, rounded];
    let retrained = false;
    if (
      allAfter.length >= config.fenetre + 100 &&
      allAfter.length % config.predire_tous_les === 0
    ) {
      savedModel = trainCrashModel(allAfter, config.fenetre);
      this.saveModel(savedModel);
      retrained = true;
    }

    return {
      tour: newTour,
      retrained,
      livePrediction: this.getLivePredictionState(),
    };
  }

  public insertBatchWithWalkForward(
    values: number[],
    source: RoundSource = 'import'
  ): { inserted: number; retrainedCount: number } {
    const config = this.getConfig();
    const pastValues = this.getAllMultipliers();
    let savedModel = this.getSavedModel();

    const insertTourStmt = this.db.prepare(
      'INSERT INTO tours (horodatage, multiplicateur, source) VALUES (?, ?, ?)'
    );
    const insertPredStmt = this.db.prepare(
      `INSERT INTO predictions
        (horodatage, numero_tour, prediction, reel, pred_depasse, reel_depasse, pred_temoin, cible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    let retrainedCount = 0;
    const baseTime = Date.now() - values.length * 4000;

    this.db.exec('BEGIN');
    try {
      for (let i = 0; i < values.length; i++) {
        const val = Math.round(values[i] * 100) / 100;
        if (!Number.isFinite(val) || val < 1.0 || val > 1_000_000) continue;

        const ts = new Date(baseTime + i * 4000).toISOString();
        const roundNumber = pastValues.length + 1;

        const { prediction, medianBaseline } = this.predictNext(pastValues, config, savedModel);
        if (prediction !== null && medianBaseline !== null) {
          insertPredStmt.run(
            ts,
            roundNumber,
            prediction,
            val,
            prediction >= config.cible ? 1 : 0,
            val >= config.cible ? 1 : 0,
            medianBaseline,
            config.cible
          );
        }

        insertTourStmt.run(ts, val, source);
        pastValues.push(val);
        inserted += 1;

        if (
          pastValues.length >= config.fenetre + 100 &&
          pastValues.length % config.predire_tous_les === 0
        ) {
          savedModel = trainCrashModel(pastValues, config.fenetre);
          retrainedCount += 1;
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    if (retrainedCount > 0) {
      this.saveModel(savedModel);
    }

    return { inserted, retrainedCount };
  }

  public retrainNow(): SerializedGBDT | null {
    const config = this.getConfig();
    const values = this.getAllMultipliers();
    const model = trainCrashModel(values, config.fenetre);
    if (model) {
      this.saveModel(model);
    }
    return model;
  }

  public deleteTour(id: number): boolean {
    const res = this.db.prepare('DELETE FROM tours WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  public clearAll(): void {
    this.db.exec('DELETE FROM tours; DELETE FROM predictions;');
    this.saveModel(null);
  }

  public getLivePredictionState(): LivePredictionState {
    const config = this.getConfig();
    const values = this.getAllMultipliers();
    const savedModel = this.getSavedModel();

    const { prediction, medianBaseline, modelActive } = this.predictNext(
      values,
      config,
      savedModel
    );

    const predRows = this.db
      .prepare('SELECT prediction, reel, pred_depasse, reel_depasse, pred_temoin FROM predictions')
      .all() as {
      prediction: number;
      reel: number;
      pred_depasse: number;
      reel_depasse: number;
      pred_temoin: number;
    }[];

    const evaluatedCount = predRows.length;
    const minRequired = 50;

    let modelMae: number | null = null;
    let baselineMae: number | null = null;
    let directionalAccuracy: number | null = null;
    let modelBeatsBaseline = false;
    let verdict: 'insufficient' | 'slightly_better' | 'no_advantage' = 'insufficient';
    let message = `Fiabilité : pas assez de tours évalués (${evaluatedCount}/${minRequired} minimum) pour juger cette prédiction.`;

    if (evaluatedCount > 0) {
      let sumErrModel = 0;
      let sumErrBaseline = 0;
      let correctDir = 0;
      for (let i = 0; i < evaluatedCount; i++) {
        const r = predRows[i];
        sumErrModel += Math.abs(r.prediction - r.reel);
        sumErrBaseline += Math.abs(r.pred_temoin - r.reel);
        if (r.pred_depasse === r.reel_depasse) correctDir += 1;
      }
      modelMae = sumErrModel / evaluatedCount;
      baselineMae = sumErrBaseline / evaluatedCount;
      directionalAccuracy = correctDir / evaluatedCount;

      if (evaluatedCount >= minRequired) {
        modelBeatsBaseline = modelMae < baselineMae;
        if (modelBeatsBaseline) {
          verdict = 'slightly_better';
          message = `Fiabilité : sur ${evaluatedCount} tours évalués, le modèle fait légèrement mieux que la médiane (${modelMae.toFixed(2)} contre ${baselineMae.toFixed(2)}). Reste prudent, un petit écart peut venir du hasard.`;
        } else {
          verdict = 'no_advantage';
          message = `Fiabilité : sur ${evaluatedCount} tours évalués, le modèle ne fait PAS mieux que la médiane (${modelMae.toFixed(2)} contre ${baselineMae.toFixed(2)}). Cette prédiction n’a pas de valeur réelle.`;
        }
      }
    }

    const totalTours = values.length;
    const minTrainThreshold = config.fenetre + 100;
    let nextRetrainAt = minTrainThreshold;
    if (totalTours >= minTrainThreshold) {
      const rem = totalTours % config.predire_tous_les;
      nextRetrainAt =
        rem === 0 ? totalTours + config.predire_tous_les : totalTours + (config.predire_tous_les - rem);
    }

    return {
      totalTours,
      totalEvaluated: evaluatedCount,
      nextPrediction: prediction,
      medianBaseline,
      modelActive,
      modelTrainedAtCount: savedModel?.trainedOnCount ?? null,
      lastTrainedAt: savedModel?.trainedAt ?? null,
      nextRetrainAt,
      cible: config.cible,
      fenetre: config.fenetre,
      predireTousLes: config.predire_tous_les,
      reliability: {
        ready: evaluatedCount >= minRequired,
        evaluatedCount,
        minRequired,
        modelMae,
        baselineMae,
        modelBeatsBaseline,
        directionalAccuracy,
        verdict,
        message,
      },
    };
  }
}
