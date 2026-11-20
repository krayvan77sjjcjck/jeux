/**
 * Converts a cropped region of an HTMLCanvasElement or HTMLVideoElement into
 * an upscaled (2x), grayscale, Otsu-binarized canvas for crisp OCR reading,
 * mirroring the OpenCV preprocessing pipeline from the specification.
 */
export function preprocessRegionForOcr(
  source: CanvasImageSource,
  region: { left: number; top: number; width: number; height: number },
  targetCanvas: HTMLCanvasElement
): void {
  const w = Math.max(20, Math.round(region.width));
  const h = Math.max(20, Math.round(region.height));
  const scale = 2;
  const outW = w * scale;
  const outH = h * scale;

  targetCanvas.width = outW;
  targetCanvas.height = outH;
  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, region.left, region.top, w, h, 0, 0, outW, outH);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const data = imgData.data;
  const pixelCount = outW * outH;
  const gray = new Uint8Array(pixelCount);
  const histogram = new Uint32Array(256);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
    gray[i] = lum;
    histogram[lum] += 1;
  }

  // Otsu's threshold
  let sumAll = 0;
  for (let t = 0; t < 256; t++) {
    sumAll += t * histogram[t];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = pixelCount - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBg = sumBackground / weightBackground;
    const meanFg = (sumAll - sumBackground) / weightForeground;
    const betweenVar =
      weightBackground * weightForeground * (meanBg - meanFg) * (meanBg - meanFg);

    if (betweenVar > maxVariance) {
      maxVariance = betweenVar;
      threshold = t;
    }
  }

  // Count dark vs light pixels to normalize dark text on white background for Tesseract
  let darkCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (gray[i] <= threshold) darkCount += 1;
  }
  const invertForDarkBg = darkCount > pixelCount * 0.5;

  for (let i = 0; i < pixelCount; i++) {
    const isForeground = gray[i] > threshold;
    const val = invertForDarkBg ? (isForeground ? 0 : 255) : isForeground ? 255 : 0;
    const idx = i * 4;
    data[idx] = val;
    data[idx + 1] = val;
    data[idx + 2] = val;
    data[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Generates a synthetic calibration image ("zone_test") with a crisp multiplier
 * so users can verify OCR & Otsu thresholding offline or before sharing a screen.
 */
export function renderSyntheticZoneSample(
  canvas: HTMLCanvasElement,
  multiplierText = '2.74x'
): void {
  canvas.width = 300;
  canvas.height = 100;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 300, 100);

  ctx.fillStyle = '#38BDF8';
  ctx.font = 'bold 46px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(multiplierText, 150, 52);
}
