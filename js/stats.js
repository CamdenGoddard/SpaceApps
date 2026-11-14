/* ============================================================
   TrendScope: statistics engine
   Trend detection on annual time series:
     - Ordinary least squares (OLS) linear regression with
       t-distribution p-value
     - Mann-Kendall non-parametric trend test (tie-corrected)
     - Sen's slope (Theil-Sen median slope) + intercept
   These are the standard tools climate scientists use to decide
   whether a trend is "statistically significant".
   ============================================================ */

const TrendStats = (() => {

  /* ---------- special functions ---------- */

  // Error function, Abramowitz & Stegun 7.1.26 (|err| <= 1.5e-7)
  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  // Log-gamma (Lanczos)
  function logGamma(x) {
    const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Continued fraction for incomplete beta (Numerical Recipes betacf)
  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  // Regularized incomplete beta I_x(a, b)
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
      + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // Two-sided p-value for Student's t with df degrees of freedom
  function tTwoSidedP(t, df) {
    if (!isFinite(t) || df <= 0) return NaN;
    return ibeta(df / 2, 0.5, df / (df + t * t));
  }

  function median(arr) {
    if (!arr.length) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /* ---------- OLS linear regression ---------- */

  function ols(x, y) {
    const n = x.length;
    if (n < 3) return null;
    const mx = mean(x), my = mean(y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    // residual sum of squares
    let rss = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - (intercept + slope * x[i]);
      rss += r * r;
    }
    const df = n - 2;
    const se = Math.sqrt(rss / df / sxx);
    const t = se > 0 ? slope / se : (slope === 0 ? 0 : Infinity);
    const p = se > 0 ? tTwoSidedP(t, df) : 0;
    const r2 = syy > 0 ? 1 - rss / syy : 1;
    return { slope, intercept, se, t, p, r2, n };
  }

  /* ---------- Mann-Kendall test (tie-corrected) ---------- */

  function mannKendall(y) {
    const n = y.length;
    if (n < 4) return null;
    let S = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        S += Math.sign(y[j] - y[i]);
      }
    }
    // tie correction
    const counts = new Map();
    for (const v of y) counts.set(v, (counts.get(v) || 0) + 1);
    let tieSum = 0;
    for (const t of counts.values()) {
      if (t > 1) tieSum += t * (t - 1) * (2 * t + 5);
    }
    const variance = (n * (n - 1) * (2 * n + 5) - tieSum) / 18;
    let Z = 0;
    if (variance > 0) {
      if (S > 0) Z = (S - 1) / Math.sqrt(variance);
      else if (S < 0) Z = (S + 1) / Math.sqrt(variance);
    }
    const p = 2 * (1 - normalCdf(Math.abs(Z)));
    return { S, variance, Z, p, n };
  }

  /* ---------- Sen's slope (Theil-Sen estimator) ---------- */

  function sensSlope(x, y) {
    const n = x.length;
    if (n < 3) return null;
    const slopes = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i];
        if (dx !== 0) slopes.push((y[j] - y[i]) / dx);
      }
    }
    const slope = median(slopes);
    const intercept = median(y.map((v, i) => v - slope * x[i]));
    return { slope, intercept };
  }

  /* ---------- full trend analysis ---------- */

  /**
   * analyze(years, values, alpha=0.05)
   * Returns everything the UI needs to answer:
   *   what is changing, how much, and is it significant.
   */
  function analyze(years, values, alpha = 0.05) {
    const x = years, y = values;
    const o = ols(x, y);
    const mk = mannKendall(y);
    const sen = sensSlope(x, y);
    if (!o || !mk || !sen) return null;

    const span = x[x.length - 1] - x[0];
    const meanVal = mean(y);
    const totalChange = sen.slope * span;
    const pctChange = meanVal !== 0 ? (totalChange / Math.abs(meanVal)) * 100 : NaN;
    const significant = mk.p < alpha;
    const direction = !significant ? 'none' : (sen.slope > 0 ? 'up' : 'down');

    return {
      n: y.length,
      startYear: x[0],
      endYear: x[x.length - 1],
      span,
      mean: meanVal,
      ols: o,
      mk,
      sen,
      slopePerDecade: sen.slope * 10,
      totalChange,
      pctChange,
      alpha,
      significant,
      direction
    };
  }

  return { erf, normalCdf, ibeta, tTwoSidedP, ols, mannKendall, sensSlope, analyze, median, mean };
})();

// Node.js export for testing
if (typeof module !== 'undefined' && module.exports) module.exports = TrendStats;
