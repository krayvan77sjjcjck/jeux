import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Code2,
  Copy,
  Globe,
  Monitor,
  Play,
  Square,
  Upload,
} from 'lucide-react';
import { createWorker, type Worker } from 'tesseract.js';
import { extractMultiplierFromText, RoundStabilityTracker } from '../engine/ocrParser';
import type { CollectorConfig } from '../engine/types';
import { postRound, postRoundBatch, probeGameUrl, updateConfig } from '../services/api';
import { preprocessRegionForOcr, renderSyntheticZoneSample } from '../utils/imagePreprocess';

interface CollectorViewProps {
  config: CollectorConfig;
  onConfigSaved: (next: CollectorConfig) => void;
  onRoundRecorded: () => Promise<void>;
}

type CollectorMode = 'ocr' | 'web' | 'import';

export const CollectorView: React.FC<CollectorViewProps> = ({
  config,
  onConfigSaved,
  onRoundRecorded,
}) => {
  const [mode, setMode] = useState<CollectorMode>('ocr');

  // Shared config state
  const [zone, setZone] = useState(config.zone);
  const [intervalSec, setIntervalSec] = useState(String(config.intervalle_secondes));
  const [stableReq, setStableReq] = useState(String(config.stable_requis));
  const [urlJeu, setUrlJeu] = useState(config.url_jeu);
  const [selector, setSelector] = useState(config.selecteur_multiplicateur);
  const [predireTousLes, setPredireTousLes] = useState(String(config.predire_tous_les));
  const [savingConfig, setSavingConfig] = useState(false);
  const [configStatus, setConfigStatus] = useState<string | null>(null);

  // OCR / Screen Capture state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const trackerRef = useRef<RoundStabilityTracker>(new RoundStabilityTracker(config.stable_requis));
  const ocrTimerRef = useRef<number | null>(null);

  const [screenActive, setScreenActive] = useState(false);
  const [videoDims, setVideoDims] = useState<{ width: number; height: number } | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [rawOcrText, setRawOcrText] = useState<string>('—');
  const [parsedOcrValue, setParsedOcrValue] = useState<number | null>(null);
  const [ocrStableCount, setOcrStableCount] = useState<number>(0);
  const [ocrLog, setOcrLog] = useState<string[]>([]);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [testingOcr, setTestingOcr] = useState(false);

  // Web Selector / Probe state
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [domTestInput, setDomTestInput] = useState('2.45x');

  // CSV / File Import state
  const [batchText, setBatchText] = useState('');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => {
    setZone(config.zone);
    setIntervalSec(String(config.intervalle_secondes));
    setStableReq(String(config.stable_requis));
    setUrlJeu(config.url_jeu);
    setSelector(config.selecteur_multiplicateur);
    setPredireTousLes(String(config.predire_tous_les));
    trackerRef.current = new RoundStabilityTracker(config.stable_requis);
  }, [config]);

  useEffect(() => {
    return () => {
      if (ocrTimerRef.current !== null) window.clearInterval(ocrTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (workerRef.current) {
        void workerRef.current.terminate();
      }
    };
  }, []);

  async function ensureOcrWorker(): Promise<Worker> {
    if (workerRef.current) return workerRef.current;
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.x,',
    });
    workerRef.current = worker;
    return worker;
  }

  async function handleSaveConfig(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingConfig(true);
    setConfigStatus(null);
    try {
      const res = await updateConfig({
        zone,
        intervalle_secondes: Number.parseFloat(intervalSec) || 0.2,
        stable_requis: Number.parseInt(stableReq, 10) || 5,
        url_jeu: urlJeu,
        selecteur_multiplicateur: selector,
        predire_tous_les: Number.parseInt(predireTousLes, 10) || 50,
      });
      onConfigSaved(res.config);
      setConfigStatus('Configuration enregistrée dans SQLite.');
    } catch (err) {
      setConfigStatus(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleStartScreenShare() {
    setOcrError(null);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setOcrError('La capture d’écran navigateur (getDisplayMedia) n’est pas disponible sur cet appareil.');
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
          setVideoDims({
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
          });
        }
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopOcrLoop();
        setScreenActive(false);
        setVideoDims(null);
      });
      setScreenActive(true);
    } catch (err) {
      setOcrError(
        err instanceof Error
          ? `Capture annulée ou refusée : ${err.message}`
          : 'Impossible de démarrer la capture d’écran.'
      );
    }
  }

  function handleStopScreenShare() {
    stopOcrLoop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScreenActive(false);
  }

  async function runSingleOcrFrame(sourceEl: CanvasImageSource, useFullSource = false) {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const reg = useFullSource
      ? {
          left: 0,
          top: 0,
          width: (sourceEl as HTMLCanvasElement).width || 300,
          height: (sourceEl as HTMLCanvasElement).height || 100,
        }
      : zone;

    preprocessRegionForOcr(sourceEl, reg, canvas);
    const worker = await ensureOcrWorker();
    const {
      data: { text },
    } = await worker.recognize(canvas);

    const trimmed = text.trim() || '—';
    const parsed = extractMultiplierFromText(trimmed);
    setRawOcrText(trimmed);
    setParsedOcrValue(parsed);
    return parsed;
  }

  async function handleCalibrateTest() {
    setTestingOcr(true);
    setOcrError(null);
    try {
      if (screenActive && videoRef.current && videoRef.current.readyState >= 2) {
        await runSingleOcrFrame(videoRef.current, false);
      } else {
        // Synthetic zone_test fallback so calibration can always be verified
        const tmp = document.createElement('canvas');
        const sampleVal = (1.5 + Math.random() * 4.5).toFixed(2) + 'x';
        renderSyntheticZoneSample(tmp, sampleVal);
        await runSingleOcrFrame(tmp, true);
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Erreur pendant le test OCR.');
    } finally {
      setTestingOcr(false);
    }
  }

  async function handleImageFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTestingOcr(true);
    setOcrError(null);
    try {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image illisible.'));
        img.src = objUrl;
      });
      URL.revokeObjectURL(objUrl);

      const tmp = document.createElement('canvas');
      tmp.width = img.width;
      tmp.height = img.height;
      const ctx = tmp.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      await runSingleOcrFrame(tmp, true);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Impossible de lire l’image.');
    } finally {
      setTestingOcr(false);
    }
  }

  function startOcrLoop() {
    if (!screenActive || !videoRef.current) {
      setOcrError('Partage d’abord ton écran ou l’onglet du jeu avant de démarrer la collecte.');
      return;
    }
    setOcrError(null);
    trackerRef.current = new RoundStabilityTracker(Number.parseInt(stableReq, 10) || 5);
    setOcrRunning(true);

    const ms = Math.max(150, Math.round((Number.parseFloat(intervalSec) || 0.2) * 1000));
    let busy = false;

    ocrTimerRef.current = window.setInterval(async () => {
      if (busy || !videoRef.current || videoRef.current.readyState < 2) return;
      busy = true;
      try {
        const val = await runSingleOcrFrame(videoRef.current, false);
        const obs = trackerRef.current.observe(val ?? null);
        setOcrStableCount(obs.stableCount);
        if (obs.completedRound !== null) {
          await postRound(obs.completedRound, 'ocr');
          setOcrLog((prev) => [
            `Tour enregistré : ${obs.completedRound!.toFixed(2)}x (${new Date().toLocaleTimeString('fr-FR')})`,
            ...prev.slice(0, 14),
          ]);
          await onRoundRecorded();
        }
      } catch {
        // Skip noisy frame and continue
      } finally {
        busy = false;
      }
    }, ms);
  }

  function stopOcrLoop() {
    if (ocrTimerRef.current !== null) {
      window.clearInterval(ocrTimerRef.current);
      ocrTimerRef.current = null;
    }
    setOcrRunning(false);
  }

  async function handleProbeUrl() {
    setProbing(true);
    setProbeResult(null);
    setProbeError(null);
    try {
      const res = await probeGameUrl(urlJeu, selector);
      setProbeResult(res.note);
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Échec du test URL.');
    } finally {
      setProbing(false);
    }
  }

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const bookmarkletScript = `// Colle ce script dans la console DevTools de l'onglet du jeu
(() => {
  const SELECTOR = ${JSON.stringify(selector || '.multiplicateur')};
  const ENDPOINT = ${JSON.stringify(`${originUrl}/api/rounds`)};
  const STABLE_REQUIS = ${Number.parseInt(stableReq, 10) || 5};
  let last = null, stable = 0, sent = false;
  setInterval(async () => {
    const el = document.querySelector(SELECTOR);
    if (!el) return;
    const m = (el.innerText || '').match(/(\\d+(?:[.,]\\d+)?)/);
    const val = m ? parseFloat(m[1].replace(',', '.')) : null;
    if (!val || val < 1) return;
    if (val === last) stable++; else { last = val; stable = 0; sent = false; }
    if (stable === STABLE_REQUIS && !sent) {
      sent = true;
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ multiplicateur: val, source: 'dom' })
      });
      console.log('[CrashLab] Tour enregistré :', val + 'x');
    }
  }, ${Math.max(150, Math.round((Number.parseFloat(intervalSec) || 0.2) * 1000))});
})();`;

  function handleCopySnippet() {
    void navigator.clipboard?.writeText(bookmarkletScript);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 1800);
  }

  async function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchMessage(null);
    const text = await file.text();
    setBatchText(text);
  }

  async function handleImportText(e: React.FormEvent) {
    e.preventDefault();
    setBatchMessage(null);
    const tokens = batchText.split(/[\s,;\n\r]+/).filter(Boolean);
    const parsed = tokens
      .map((t) => extractMultiplierFromText(t))
      .filter((v): v is number => v !== null);

    if (parsed.length === 0) {
      setBatchMessage('Aucun multiplicateur valide (>= 1.00x) détecté dans le texte saisi.');
      return;
    }

    setBatchBusy(true);
    try {
      const res = await postRoundBatch(parsed, 'import');
      setBatchText('');
      setBatchMessage(
        `${res.inserted} tours importés dans SQLite (${res.retrainedCount} ré-entraînement(s)).`
      );
      await onRoundRecorded();
    } catch (err) {
      setBatchMessage(err instanceof Error ? err.message : 'Erreur lors de l’import.');
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setMode('ocr')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'ocr'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Capture d’écran & OCR
          </button>

          <button
            type="button"
            onClick={() => setMode('web')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'web'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Sélecteur Web & Bookmarklet
          </button>

          <button
            type="button"
            onClick={() => setMode('import')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'import'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV / Historique
          </button>
        </div>

        {configStatus && (
          <span className="text-xs font-medium text-emerald-700">{configStatus}</span>
        )}
      </div>

      {/* MODE 1: Screen Capture + Calibration + Tesseract OCR */}
      {mode === 'ocr' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Calibration Form (replaces config.py + calibrer.py) */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Calibration de la zone OCR
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Définis les coordonnées en pixels autour du multiplicateur puis teste l’aperçu binarisé (équivalent zone_test).
              </p>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="zone-left" className="block text-xs font-medium text-slate-600 mb-1">
                    Gauche (left px)
                  </label>
                  <input
                    id="zone-left"
                    type="number"
                    min="0"
                    value={zone.left}
                    onChange={(e) => setZone({ ...zone, left: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="zone-top" className="block text-xs font-medium text-slate-600 mb-1">
                    Haut (top px)
                  </label>
                  <input
                    id="zone-top"
                    type="number"
                    min="0"
                    value={zone.top}
                    onChange={(e) => setZone({ ...zone, top: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="zone-width" className="block text-xs font-medium text-slate-600 mb-1">
                    Largeur (width px)
                  </label>
                  <input
                    id="zone-width"
                    type="number"
                    min="20"
                    value={zone.width}
                    onChange={(e) => setZone({ ...zone, width: Number(e.target.value) || 20 })}
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="zone-height" className="block text-xs font-medium text-slate-600 mb-1">
                    Hauteur (height px)
                  </label>
                  <input
                    id="zone-height"
                    type="number"
                    min="20"
                    value={zone.height}
                    onChange={(e) => setZone({ ...zone, height: Number(e.target.value) || 20 })}
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="interval-sec" className="block text-xs font-medium text-slate-600 mb-1">
                    Intervalle (secondes)
                  </label>
                  <input
                    id="interval-sec"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={intervalSec}
                    onChange={(e) => setIntervalSec(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="stable-req" className="block text-xs font-medium text-slate-600 mb-1">
                    Lectures stables fin tour
                  </label>
                  <input
                    id="stable-req"
                    type="number"
                    min="2"
                    max="20"
                    value={stableReq}
                    onChange={(e) => setStableReq(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {savingConfig ? 'Sauvegarde…' : 'Enregistrer réglages'}
                </button>
                <button
                  type="button"
                  onClick={handleCalibrateTest}
                  disabled={testingOcr}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {testingOcr ? 'Lecture OCR…' : 'Tester calibration (zone_test)'}
                </button>
              </div>
            </form>

            {/* Upload test image */}
            <div className="pt-4 border-t border-slate-100">
              <label
                htmlFor="ocr-image-upload"
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 cursor-pointer transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Tester l’OCR sur une capture d’image locale
              </label>
              <input
                id="ocr-image-upload"
                type="file"
                accept="image/*"
                onChange={handleImageFileUpload}
                className="sr-only"
              />
            </div>
          </section>

          {/* Right Live Screen Stream + Otsu Binarized Preview + Stability State */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Capture directe & lecture Tesseract
                </h3>
                <p className="text-xs text-slate-500">
                  Fonctionne sur n’importe quel site ou jeu dessiné en Canvas sans installer Tesseract localement.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!screenActive ? (
                  <button
                    type="button"
                    onClick={handleStartScreenShare}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    Partager l’onglet du jeu
                  </button>
                ) : (
                  <>
                    {!ocrRunning ? (
                      <button
                        type="button"
                        onClick={startOcrLoop}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Démarrer la collecte OCR
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopOcrLoop}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Square className="w-3.5 h-3.5" />
                        Arrêter la collecte
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleStopScreenShare}
                      className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                      Couper partage
                    </button>
                  </>
                )}
              </div>
            </div>

            {ocrError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {ocrError}
              </div>
            )}

            {/* Video Feed Container with Live Zone Overlay */}
            <div className="relative bg-slate-900 rounded-lg overflow-hidden border border-slate-200 aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                muted
                playsInline
                onLoadedMetadata={() => {
                  if (videoRef.current?.videoWidth && videoRef.current?.videoHeight) {
                    setVideoDims({
                      width: videoRef.current.videoWidth,
                      height: videoRef.current.videoHeight,
                    });
                  }
                }}
                className={`w-full h-full object-contain ${screenActive ? 'block' : 'hidden'}`}
              />
              {screenActive && videoDims && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/15"
                  style={{
                    left: `${Math.min(98, (zone.left / videoDims.width) * 100)}%`,
                    top: `${Math.min(98, (zone.top / videoDims.height) * 100)}%`,
                    width: `${Math.min(100, (zone.width / videoDims.width) * 100)}%`,
                    height: `${Math.min(100, (zone.height / videoDims.height) * 100)}%`,
                  }}
                />
              )}
              {screenActive && videoDims && (
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-slate-900/80 text-[11px] font-mono-tabular text-slate-200 rounded">
                  Flux : {videoDims.width} × {videoDims.height} px
                </div>
              )}
              {!screenActive && (
                <div className="text-center p-6 space-y-2">
                  <Monitor className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-sm text-slate-300">Aucun flux vidéo actif</p>
                  <p className="text-xs text-slate-400">
                    Clique sur « Partager l’onglet du jeu » ou utilise « Tester calibration » pour vérifier le pipeline Otsu + Tesseract.
                  </p>
                </div>
              )}
            </div>

            {/* Binarized Otsu Preview + Live Parsed Values */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center p-4 bg-slate-50 border border-slate-200 rounded-lg">
              <div>
                <div className="text-xs font-medium text-slate-600 mb-2">
                  Aperçu binarisé Otsu (zone_test 2x)
                </div>
                <canvas
                  ref={previewCanvasRef}
                  data-testid="ocr-preview-canvas"
                  className="w-full max-w-[280px] h-20 object-contain bg-white border border-slate-300 rounded"
                />
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Texte OCR brut</span>
                  <span className="font-mono-tabular font-medium text-slate-900">{rawOcrText}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Multiplicateur extrait</span>
                  <span
                    data-testid="ocr-parsed-value"
                    className="font-mono-tabular font-bold text-sky-700"
                  >
                    {parsedOcrValue !== null ? `${parsedOcrValue.toFixed(2)}x` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Stabilité fin de tour</span>
                  <span className="font-mono-tabular text-slate-800">
                    {ocrStableCount} / {stableReq}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* MODE 2: Web Collector / CSS Selector & Bookmarklet */}
      {mode === 'web' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              Configuration du collecteur Web (Partie 2)
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Renseigne l’URL de la page du jeu, le sélecteur CSS du multiplicateur (ex: <code className="font-mono">.payout</code>) et la fréquence de ré-entraînement automatique.
            </p>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label htmlFor="url-jeu" className="block text-xs font-medium text-slate-600 mb-1">
                  URL du jeu
                </label>
                <input
                  id="url-jeu"
                  type="url"
                  placeholder="https://..."
                  value={urlJeu}
                  onChange={(e) => setUrlJeu(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="selecteur-css" className="block text-xs font-medium text-slate-600 mb-1">
                  Sélecteur CSS du multiplicateur
                </label>
                <input
                  id="selecteur-css"
                  type="text"
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="predire-tous-les" className="block text-xs font-medium text-slate-600 mb-1">
                  Ré-entraîner le modèle tous les N tours
                </label>
                <input
                  id="predire-tous-les"
                  type="number"
                  min="10"
                  max="500"
                  value={predireTousLes}
                  onChange={(e) => setPredireTousLes(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  {savingConfig ? 'Sauvegarde…' : 'Enregistrer'}
                </button>
                <button
                  type="button"
                  onClick={handleProbeUrl}
                  disabled={probing}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  {probing ? 'Test en cours…' : 'Tester l’URL côté serveur'}
                </button>
              </div>
            </form>

            {probeResult && (
              <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-950 leading-relaxed">
                {probeResult}
              </div>
            )}
            {probeError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {probeError}
              </div>
            )}
          </section>

          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-sky-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  Pont DOM navigateur (Console / Bookmarklet)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCopySnippet}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {copiedSnippet ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Copié
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copier le script
                  </>
                )}
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Si le site cible nécessite une session connectée ou bloque les navigateurs automatisés, ouvre le jeu dans ton navigateur habituel, inspecte le multiplicateur pour confirmer le sélecteur (<code className="font-mono">{selector}</code>), puis exécute ce script qui envoie chaque tour figé vers CrashLab.
            </p>

            <pre className="p-4 bg-slate-900 text-slate-100 text-xs font-mono rounded-lg overflow-x-auto leading-relaxed">
              {bookmarkletScript}
            </pre>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs">
              <label htmlFor="dom-regex-test" className="font-medium text-slate-700">
                Test rapide d’extraction texte :
              </label>
              <input
                id="dom-regex-test"
                type="text"
                value={domTestInput}
                onChange={(e) => setDomTestInput(e.target.value)}
                className="px-2.5 py-1 font-mono-tabular border border-slate-300 rounded w-36"
              />
              <span className="font-mono-tabular text-slate-700">
                Résultat :{' '}
                <strong>
                  {extractMultiplierFromText(domTestInput) !== null
                    ? `${extractMultiplierFromText(domTestInput)!.toFixed(2)}x`
                    : 'Invalide'}
                </strong>
              </span>
            </div>
          </section>
        </div>
      )}

      {/* MODE 3: User CSV / File Import */}
      {mode === 'import' && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 max-w-3xl">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Importer ton historique (CSV / TXT / Copier-coller)
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Importe uniquement tes propres relevés de multiplicateurs (séparés par des virgules, espaces ou retours à la ligne). Chaque tour est évalué chronologiquement sans fuite avant d’entrer dans SQLite.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="csv-file-upload"
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 cursor-pointer transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Charger un fichier .csv ou .txt
            </label>
            <input
              id="csv-file-upload"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={handleCsvFileUpload}
              className="sr-only"
            />
          </div>

          <form onSubmit={handleImportText} className="space-y-3">
            <div>
              <label htmlFor="batch-import-text" className="block text-xs font-medium text-slate-700 mb-1">
                Valeurs observées à importer
              </label>
              <textarea
                id="batch-import-text"
                rows={7}
                placeholder="Colle ici tes multiplicateurs observés (ex : 1.45, 2.10, 3.80...)"
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                className="w-full p-3 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={batchBusy || !batchText.trim()}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors"
              >
                {batchBusy ? 'Import en cours…' : 'Importer et évaluer les tours'}
              </button>
              {batchMessage && (
                <span className="text-xs font-medium text-emerald-700">{batchMessage}</span>
              )}
            </div>
          </form>
        </section>
      )}

      {/* Collector Event Log */}
      {ocrLog.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
            Journal de collecte récent
          </h3>
          <ul className="space-y-1.5 text-xs font-mono-tabular text-slate-700">
            {ocrLog.map((entry, idx) => (
              <li key={idx}>{entry}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
