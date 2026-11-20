import express from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { runWalkForwardBacktest } from './src/engine/gbdt';
import {
  computeAutocorrelations,
  computeDescriptiveStats,
  computeDistributionBuckets,
  pearsonCorrelation,
} from './src/engine/stats';
import type { RoundSource } from './src/engine/types';
import { CrashDatabase } from './src/server/db';

const ALLOWED_SOURCES = new Set<RoundSource>([
  'ocr',
  'dom',
  'manual',
  'import',
  'sim',
  'bookmarklet',
]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true; // 127.0.0.0/8
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local / metadata
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      return isPrivateIp(lower.slice(7));
    }
  }
  return false;
}

async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Seuls les protocoles http:// et https:// sont autorisés.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Les adresses locales ou internes ne sont pas autorisées.');
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('Les adresses IP privées ne sont pas autorisées.');
  }
  const resolved = await dns.lookup(hostname, { all: true });
  if (resolved.length === 0 || resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('Résolution DNS refusée (adresse privée ou inaccessible).');
  }
  return parsed;
}

async function startServer() {
  const app = express();
  const db = new CrashDatabase();

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/state', (_req, res) => {
    const config = db.getConfig();
    const livePrediction = db.getLivePredictionState();
    const recentTours = db.getTours({ limit: 30, offset: 0 });
    const recentPredictions = db.getPredictions({ limit: 30, offset: 0 });
    res.json({
      config,
      livePrediction,
      recentTours,
      recentPredictions,
    });
  });

  app.get('/api/tours', (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const min = req.query.min !== undefined && req.query.min !== '' ? Number(req.query.min) : undefined;
    const max = req.query.max !== undefined && req.query.max !== '' ? Number(req.query.max) : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;

    const result = db.getTours({ limit, offset, min, max, source });
    res.json(result);
  });

  app.get('/api/predictions', (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    res.json(db.getPredictions({ limit, offset }));
  });

  app.post('/api/rounds', (req, res) => {
    try {
      const multiplicateur = Number(req.body?.multiplicateur);
      const rawSource = String(req.body?.source ?? 'manual') as RoundSource;
      const source: RoundSource = ALLOWED_SOURCES.has(rawSource) ? rawSource : 'manual';

      const result = db.recordRound(multiplicateur, source);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Erreur lors de l’enregistrement du tour.',
      });
    }
  });

  app.post('/api/rounds/batch', (req, res) => {
    try {
      const values = req.body?.values;
      if (!Array.isArray(values) || values.length === 0) {
        res.status(400).json({ error: 'Tableau de multiplicateurs requis.' });
        return;
      }
      if (values.length > 2500) {
        res.status(400).json({ error: 'Maximum 2500 tours par import.' });
        return;
      }
      const numeric = values.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 1.0 && v <= 1_000_000);
      if (numeric.length === 0) {
        res.status(400).json({ error: 'Aucun multiplicateur valide (>= 1.00x) détecté.' });
        return;
      }
      const rawSource = String(req.body?.source ?? 'import') as RoundSource;
      const source: RoundSource = ALLOWED_SOURCES.has(rawSource) ? rawSource : 'import';

      const summary = db.insertBatchWithWalkForward(numeric, source);
      res.status(201).json({
        ...summary,
        livePrediction: db.getLivePredictionState(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Erreur lors de l’import par lot.',
      });
    }
  });

  app.delete('/api/tours/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Identifiant de tour invalide.' });
      return;
    }
    const deleted = db.deleteTour(id);
    if (!deleted) {
      res.status(404).json({ error: 'Tour introuvable.' });
      return;
    }
    res.json({ deleted: true, livePrediction: db.getLivePredictionState() });
  });

  app.delete('/api/tours', (_req, res) => {
    db.clearAll();
    res.json({ cleared: true, livePrediction: db.getLivePredictionState() });
  });

  app.put('/api/config', (req, res) => {
    try {
      const current = db.getConfig();
      const body = req.body ?? {};
      const next = db.saveConfig({
        ...current,
        ...body,
        zone: {
          ...current.zone,
          ...(body.zone ?? {}),
        },
      });
      res.json({ config: next, livePrediction: db.getLivePredictionState() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Configuration invalide.',
      });
    }
  });

  app.post('/api/model/retrain', (_req, res) => {
    const model = db.retrainNow();
    if (!model) {
      res.status(400).json({
        error: 'Pas assez de tours enregistrés pour entraîner le modèle (minimum fenêtre + 11 tours).',
      });
      return;
    }
    res.json({
      retrained: true,
      trainedOnCount: model.trainedOnCount,
      trainedAt: model.trainedAt,
      livePrediction: db.getLivePredictionState(),
    });
  });

  app.get('/api/analysis', (req, res) => {
    const config = db.getConfig();
    const target = req.query.cible !== undefined ? Number(req.query.cible) : config.cible;
    const bet = req.query.mise !== undefined ? Number(req.query.mise) : config.mise;
    const windowSize = req.query.fenetre !== undefined ? Number(req.query.fenetre) : config.fenetre;

    const safeTarget = Number.isFinite(target) && target >= 1.01 ? target : config.cible;
    const safeBet = Number.isFinite(bet) && bet > 0 ? bet : config.mise;
    const safeWindow =
      Number.isInteger(windowSize) && windowSize >= 2 && windowSize <= 50 ? windowSize : config.fenetre;

    const values = db.getAllMultipliers();
    const descriptive = computeDescriptiveStats(values, safeTarget, safeBet);
    const lag1 =
      values.length >= 4
        ? pearsonCorrelation(values.slice(0, -1), values.slice(1))
        : {
            r: 0,
            pValue: 1,
            n: 0,
            significant: false,
            interpretation: 'Au moins 4 tours requis pour calculer la corrélation N / N+1.',
          };
    const autocorrelations = computeAutocorrelations(values, 10);
    const distribution = computeDistributionBuckets(values);
    const backtest = runWalkForwardBacktest(values, {
      windowSize: safeWindow,
      targetMultiplier: safeTarget,
      betSize: safeBet,
      trainRatio: 0.7,
    });

    res.json({
      descriptive,
      lag1,
      autocorrelations,
      distribution,
      backtest,
      params: {
        cible: safeTarget,
        mise: safeBet,
        fenetre: safeWindow,
      },
    });
  });

  app.get('/api/export/csv', (_req, res) => {
    const { rows } = db.getTours({ limit: 50000, offset: 0 });
    const header = 'id,horodatage,multiplicateur,source';
    const lines = rows
      .slice()
      .reverse()
      .map((r) => `${r.id},${r.horodatage},${r.multiplicateur.toFixed(2)},${r.source}`);
    const csv = [header, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tours.csv"');
    res.send(csv);
  });

  app.post('/api/collector/probe-url', async (req, res) => {
    const urlStr = String(req.body?.url ?? '').trim();
    const selector = String(req.body?.selector ?? '.multiplicateur').trim();
    if (!urlStr) {
      res.status(400).json({ error: 'URL requise.' });
      return;
    }

    try {
      const validUrl = await validatePublicHttpUrl(urlStr);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(validUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'CrashLab-Observer/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'manual',
      });
      clearTimeout(timer);

      const html = (await response.text()).slice(0, 200_000);
      const hasStaticMatch =
        selector.startsWith('.') || selector.startsWith('#')
          ? html.includes(selector.slice(1))
          : html.includes(selector);

      res.json({
        reachable: response.ok,
        status: response.status,
        hasSelectorInInitialHtml: hasStaticMatch,
        note: hasStaticMatch
          ? `La page répond (HTTP ${response.status}) et contient le sélecteur "${selector}" dans le HTML initial. Si la cote est mise à jour en JavaScript/Canvas, utilise le Pont Bookmarklet ou la Capture OCR directe.`
          : `La page répond (HTTP ${response.status}), mais le sélecteur "${selector}" n’est pas présent dans le HTML statique (rendu SPA/Canvas ou authentification requise). Utilise la Capture OCR navigateur ou le Pont Bookmarklet.`,
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Impossible de joindre cette URL depuis le serveur.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`CrashLab server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CrashLab server:', err);
  process.exit(1);
});
