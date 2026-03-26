// Statistical functions for A/B test analysis

// Standard normal CDF using Horner's method approximation
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

// Inverse normal CDF (quantile function) using rational approximation
function normalInv(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2,
    -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2,
    -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1,
    -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996, 3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

export interface ABTestResult {
  // Raw data
  visitorsA: number;
  conversionsA: number;
  visitorsB: number;
  conversionsB: number;
  rateA: number;
  rateB: number;
  relativeUplift: number;

  // Test statistics
  zScore: number;
  pValue: number;
  confidenceLevel: number;
  significant: boolean;

  // Confidence intervals
  ciA: [number, number];
  ciB: [number, number];
  ciDiff: [number, number];

  // Effect size
  absoluteDiff: number;
  relativeEffect: number;

  // Power & sample size
  observedPower: number;
  sampleSizeNeeded: number | null; // null if already significant
  additionalSamplesNeeded: number | null;

  // Winner
  winner: 'A' | 'B' | 'none';
}

export function runABTest(
  visitorsA: number,
  conversionsA: number,
  visitorsB: number,
  conversionsB: number,
  alpha = 0.05
): ABTestResult {
  const rateA = conversionsA / visitorsA;
  const rateB = conversionsB / visitorsB;

  // Two-proportion z-test (pooled)
  const pPool = (conversionsA + conversionsB) / (visitorsA + visitorsB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / visitorsA + 1 / visitorsB));
  const zScore = (rateB - rateA) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));

  const significant = pValue < alpha;
  const confidenceLevel = 1 - alpha;
  const zCrit = normalInv(1 - alpha / 2);

  // Confidence intervals for each rate
  const seA = Math.sqrt((rateA * (1 - rateA)) / visitorsA);
  const seB = Math.sqrt((rateB * (1 - rateB)) / visitorsB);
  const ciA: [number, number] = [rateA - zCrit * seA, rateA + zCrit * seA];
  const ciB: [number, number] = [rateB - zCrit * seB, rateB + zCrit * seB];

  // CI for difference
  const diff = rateB - rateA;
  const seDiff = Math.sqrt(
    (rateA * (1 - rateA)) / visitorsA + (rateB * (1 - rateB)) / visitorsB
  );
  const ciDiff: [number, number] = [diff - zCrit * seDiff, diff + zCrit * seDiff];

  // Relative uplift
  const relativeUplift = rateA > 0 ? (rateB - rateA) / rateA : 0;

  // Observed power
  const nAvg = (visitorsA + visitorsB) / 2;
  const effectSize = Math.abs(rateB - rateA) / Math.sqrt(pPool * (1 - pPool));
  const lambda = effectSize * Math.sqrt(nAvg);
  const power = 1 - normalCDF(zCrit - lambda) + normalCDF(-zCrit - lambda);
  const observedPower = Math.min(Math.max(power, 0), 1);

  // Minimum sample size for 80% power (if test not yet significant)
  let sampleSizeNeeded: number | null = null;
  let additionalSamplesNeeded: number | null = null;

  if (!significant && Math.abs(rateB - rateA) > 0) {
    const zPower = normalInv(0.8); // 80% power
    const mde = Math.abs(rateB - rateA);
    const pAvg = (rateA + rateB) / 2;
    const n = Math.ceil(
      (2 * pAvg * (1 - pAvg) * Math.pow(zCrit + zPower, 2)) / Math.pow(mde, 2)
    );
    sampleSizeNeeded = n;
    const currentMin = Math.min(visitorsA, visitorsB);
    additionalSamplesNeeded = Math.max(0, (n - currentMin) * 2);
  }

  return {
    visitorsA,
    conversionsA,
    visitorsB,
    conversionsB,
    rateA,
    rateB,
    relativeUplift,
    zScore,
    pValue,
    confidenceLevel,
    significant,
    ciA,
    ciB,
    ciDiff,
    absoluteDiff: diff,
    relativeEffect: relativeUplift,
    observedPower,
    sampleSizeNeeded,
    additionalSamplesNeeded,
    winner: significant ? (rateB > rateA ? 'B' : 'A') : 'none',
  };
}

export function formatPercent(value: number, decimals = 2): string {
  return (value * 100).toFixed(decimals) + '%';
}

export function formatPValue(p: number): string {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}
