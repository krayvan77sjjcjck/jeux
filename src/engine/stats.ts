import type {
  AutocorrelationLag,
  CorrelationResult,
  DescriptiveStats,
  DistributionBucket,
} from './types';

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}

export function computeDescriptiveStats(
  values: number[],
  targetMultiplier = 2.0,
  betSize = 1.0
): DescriptiveStats {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      warningLowSample: true,
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      under2xRate: 0,
      hitTargetRate: 0,
      totalVirtualProfit: 0,
      avgProfitPerRound: 0,
      equityCurve: [],
    };
  }

  const mean = computeMean(values);
  const median = computeMedian(values);

  let min = values[0];
  let max = values[0];
  let sqDiffSum = 0;
  let under2xCount = 0;
  let hitTargetCount = 0;
  let cumulativeProfit = 0;

  const equityCurve: { round: number; cumulativeProfit: number; multiplier: number }[] = [];
  const sampleStep = count > 400 ? Math.ceil(count / 400) : 1;

  for (let i = 0; i < count; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sqDiffSum += (v - mean) * (v - mean);
    if (v < 2.0) under2xCount += 1;

    const won = v >= targetMultiplier;
    if (won) {
      hitTargetCount += 1;
      cumulativeProfit += betSize * (targetMultiplier - 1);
    } else {
      cumulativeProfit -= betSize;
    }

    if (i % sampleStep === 0 || i === count - 1) {
      equityCurve.push({
        round: i + 1,
        cumulativeProfit: Math.round(cumulativeProfit * 1000) / 1000,
        multiplier: v,
      });
    }
  }

  const stdDev = Math.sqrt(sqDiffSum / count);
  const totalVirtualProfit = Math.round(cumulativeProfit * 100) / 100;
  const avgProfitPerRound = cumulativeProfit / count;

  return {
    count,
    warningLowSample: count < 300,
    mean,
    median,
    min,
    max,
    stdDev,
    under2xRate: under2xCount / count,
    hitTargetRate: hitTargetCount / count,
    totalVirtualProfit,
    avgProfitPerRound,
    equityCurve,
  };
}

// Log-gamma via Lanczos approximation for accurate beta / Student-t p-values
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zz = z - 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (zz + i);
  }
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-10;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Exact Pearson correlation r and two-tailed p-value using Student's t distribution.
 */
export function pearsonCorrelation(x: number[], y: number[]): CorrelationResult {
  const n = Math.min(x.length, y.length);
  if (n < 3) {
    return {
      r: 0,
      pValue: 1,
      n,
      significant: false,
      interpretation: 'Échantillon insuffisant (minimum 3 paires requises).',
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (den === 0) {
    return {
      r: 0,
      pValue: 1,
      n,
      significant: false,
      interpretation: 'Variance nulle : aucune corrélation calculable.',
    };
  }

  const r = Math.max(-1, Math.min(1, num / den));
  const df = n - 2;

  let pValue = 1;
  if (Math.abs(r) >= 1 - 1e-12) {
    pValue = 0;
  } else {
    const t2 = (df * r * r) / (1 - r * r);
    const xBeta = df / (df + t2);
    pValue = Math.max(0, Math.min(1, regularizedIncompleteBeta(df / 2, 0.5, xBeta)));
  }

  const significant = pValue <= 0.05;
  const interpretation = significant
    ? 'p ≤ 0.05 : une corrélation linéaire statistiquement significative apparaît dans ces données (vérifie la taille de l’échantillon et la qualité de la collecte avant de conclure).'
    : 'p > 0.05 : aucun lien détectable, le tour précédent ne prédit pas le suivant.';

  return { r, pValue, n, significant, interpretation };
}

export function computeAutocorrelations(values: number[], maxLag = 10): AutocorrelationLag[] {
  const lags: AutocorrelationLag[] = [];
  for (let lag = 1; lag <= maxLag; lag++) {
    if (values.length - lag < 3) break;
    const x = values.slice(0, values.length - lag);
    const y = values.slice(lag);
    const res = pearsonCorrelation(x, y);
    lags.push({
      lag,
      r: res.r,
      pValue: res.pValue,
      significant: res.significant,
    });
  }
  return lags;
}

export function computeDistributionBuckets(values: number[]): DistributionBucket[] {
  const ranges: { label: string; min: number; max: number | null }[] = [
    { label: '1.00–1.19x', min: 0, max: 1.2 },
    { label: '1.20–1.49x', min: 1.2, max: 1.5 },
    { label: '1.50–1.99x', min: 1.5, max: 2.0 },
    { label: '2.00–2.99x', min: 2.0, max: 3.0 },
    { label: '3.00–4.99x', min: 3.0, max: 5.0 },
    { label: '5.00–9.99x', min: 5.0, max: 10.0 },
    { label: '10.00x+', min: 10.0, max: null },
  ];

  const total = values.length || 1;
  return ranges.map((r) => {
    const count = values.filter((v) =>
      r.max === null ? v >= r.min : v >= r.min && v < r.max
    ).length;
    return {
      ...r,
      count,
      percentage: (count / total) * 100,
    };
  });
}
