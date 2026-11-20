// refresh-cohort rates per trophy (recency weight 2^k) drive median growth
// log-log N extrapolation from history horizon to target horizon
// flat-fallback allocates refresh's earned growth by E^3.5 (calibrated on graded rounds 2/3, losses 0.147/0.143)
// backtest-calibrated logit sigma with horizon inflation (flat fallback sigma 0.30)
// pinned trophies (rate >= 99.99) get fixed 99.99 median and sigma 0.05
// quantiles via logit-normal with Z = [-1.645, -0.674, 0, 0.674, 1.645], then isotonic non-decreasing

import * as fs from "fs";
import * as path from "path";

interface Trophy {
  id: number;
  name: string;
  description: string;
}

interface HistoryRead {
  slot?: string;
  at: string;
  players_tracked: number;
  trophies_earned: number;
  rates: (number | null)[];
}

interface CaseInput {
  id: string;
  horizon_minutes: number;
  target: string;
  trophies: Trophy[];
  history: HistoryRead[];
}

const Z = [-1.645, -0.674, 0, 0.674, 1.645];

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function logit(p: number): number {
  const c = clamp(p, 0.01, 99.99);
  return Math.log(c / (100 - c));
}

function invLogit(x: number): number {
  return 100 / (1 + Math.exp(-x));
}

function sameRates(a: (number | null)[], b: (number | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function leastSquares(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  if (n === 0) return { a: 0, b: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    return { a: ys[0] ?? 0, b: 0 };
  }
  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 3600000;
}

function forecastOne(c: CaseInput): { id: number; q: number[] }[] {
  const states: HistoryRead[] = [];
  for (const h of c.history) {
    if (states.length === 0) {
      states.push(h);
    } else {
      const last = states[states.length - 1];
      if (last.players_tracked !== h.players_tracked || !sameRates(last.rates, h.rates)) {
        states.push(h);
      }
    }
  }

  const finalIdx = states.length - 1;
  const lastState = states[finalIdx];
  const N_last = lastState.players_tracked;

  const lastRates: number[] = [];
  for (let i = 0; i < 55; i++) {
    let rate = 0;
    for (let k = states.length - 1; k >= 0; k--) {
      const r = states[k].rates[i];
      if (r !== null) {
        rate = r;
        break;
      }
    }
    lastRates[i] = rate;
  }

  const E: number[] = lastRates.map(r => (r / 100) * N_last);

  let totalLast = lastState.trophies_earned;
  if (totalLast <= 0) {
    totalLast = E.reduce((a, b) => a + b, 0);
  }

  interface Refresh {
    before: HistoryRead;
    after: HistoryRead;
  }
  const refreshes: Refresh[] = [];
  for (let k = 1; k < states.length; k++) {
    if (states[k].players_tracked > states[k - 1].players_tracked * 1.001) {
      refreshes.push({ before: states[k - 1], after: states[k] });
    }
  }

  const s: number[] = new Array(55).fill(0);
  if (refreshes.length > 0) {
    for (let i = 0; i < 55; i++) {
      let weightedSum = 0;
      let weightSum = 0;
      for (let k = 0; k < refreshes.length; k++) {
        const r = refreshes[k];
        const N_before = r.before.players_tracked;
        const N_after = r.after.players_tracked;
        const dN = N_after - N_before;
        if (dN <= 0) continue;
        const rateBefore = r.before.rates[i] ?? 0;
        const rateAfter = r.after.rates[i] ?? 0;
        const E_before = (rateBefore / 100) * N_before;
        const E_after = (rateAfter / 100) * N_after;
        const cohortRate = clamp(((E_after - E_before) / dN) * 100, 0, 100);
        const w = Math.pow(2, k);
        weightedSum += cohortRate * w;
        weightSum += w;
      }
      s[i] = weightSum > 0 ? weightedSum / weightSum : 0;
    }
  }

  const baseTime = "2026-11-19T00:00:00Z";
  const uniqueN = new Set(states.map(s => s.players_tracked));
  let Ntarget: number;
  if (uniqueN.size >= 2) {
    const xs = states.map(st => Math.log(1 + hoursBetween(baseTime, st.at)));
    const ys = states.map(st => Math.log(st.players_tracked));
    const fit = leastSquares(xs, ys);
    const hTarget = hoursBetween(baseTime, c.target);
    const xTarget = Math.log(1 + hTarget);
    const predicted = Math.exp(fit.a + fit.b * xTarget);
    Ntarget = clamp(predicted, N_last, 50 * N_last);
  } else {
    Ntarget = N_last * 6.06;
  }

  const pinned: boolean[] = lastRates.map(r => r >= 99.99);
  const medians: number[] = new Array(55).fill(0);
  const sigmas: number[] = new Array(55).fill(0);

  if (refreshes.length > 0) {
    const dN_total = Ntarget - N_last;
    for (let i = 0; i < 55; i++) {
      if (pinned[i]) {
        const Etarget = E[i] + dN_total;
        medians[i] = 99.99;
        sigmas[i] = 0.05;
      } else {
        const Etarget = E[i] + (s[i] / 100) * Math.max(0, dN_total);
        medians[i] = clamp(100 * Etarget / Ntarget, 0.01, 99.99);
      }
    }

    const logitErrors: number[] = [];
    for (let r = 1; r < refreshes.length; r++) {
      const cohortEst: number[] = new Array(55).fill(0);
      for (let i = 0; i < 55; i++) {
        let weightedSum = 0;
        let weightSum = 0;
        for (let k = 0; k < r; k++) {
          const rf = refreshes[k];
          const N_before = rf.before.players_tracked;
          const N_after = rf.after.players_tracked;
          const dN = N_after - N_before;
          if (dN <= 0) continue;
          const rateBefore = rf.before.rates[i] ?? 0;
          const rateAfter = rf.after.rates[i] ?? 0;
          const E_before = (rateBefore / 100) * N_before;
          const E_after = (rateAfter / 100) * N_after;
          const cohortRate = clamp(((E_after - E_before) / dN) * 100, 0, 100);
          const w = Math.pow(2, k);
          weightedSum += cohortRate * w;
          weightSum += w;
        }
        cohortEst[i] = weightSum > 0 ? weightedSum / weightSum : 0;
      }
      const after = refreshes[r].after;
      const N_after = after.players_tracked;
      const dN_r = N_after - refreshes[r].before.players_tracked;
      for (let i = 0; i < 55; i++) {
        if (pinned[i]) continue;
        const E_before = (refreshes[r].before.rates[i] ?? 0) / 100 * refreshes[r].before.players_tracked;
        const predE = E_before + (cohortEst[i] / 100) * dN_r;
        const predRate = clamp(100 * predE / N_after, 0.01, 99.99);
        const actualRate = after.rates[i] ?? 0;
        if (actualRate > 0 && actualRate < 100) {
          logitErrors.push(logit(actualRate) - logit(predRate));
        }
      }
    }

    let sigmaBacktest = 0.6;
    if (logitErrors.length > 0) {
      const sumSq = logitErrors.reduce((a, e) => a + e * e, 0);
      sigmaBacktest = Math.sqrt(sumSq / logitErrors.length);
    }

    const horizonFactor = Math.min(3, Math.log(Ntarget / N_last));
    for (let i = 0; i < 55; i++) {
      if (pinned[i]) {
        sigmas[i] = 0.05;
      } else {
        let sigma = 1.15 * sigmaBacktest + 0.1 * horizonFactor;
        sigma = clamp(sigma, 0.55, 1.6);
        if (lastRates[i] <= 0.05) sigma = Math.max(sigma, 0.9);
        sigmas[i] = sigma;
      }
    }
  } else {
    const totalTarget = totalLast * (4276 / 943);
    const dN = Ntarget - N_last;
    const pinnedCount = pinned.filter(p => p).length;
    const R = Math.max(0, totalTarget - totalLast - pinnedCount * dN);

    let denom = 0;
    for (let j = 0; j < 55; j++) {
      if (!pinned[j]) denom += Math.pow(E[j], 3.5);
    }

    for (let i = 0; i < 55; i++) {
      if (pinned[i]) {
        const Etarget = E[i] + dN;
        medians[i] = 99.99;
        sigmas[i] = 0.05;
      } else {
        const delta = denom > 0 ? R * Math.pow(E[i], 3.5) / denom : R / (55 - pinnedCount);
        const Etarget = E[i] + delta;
        medians[i] = clamp(100 * Etarget / Ntarget, 0.01, 99.99);
        sigmas[i] = 0.30;
      }
    }
  }

  const result: { id: number; q: number[] }[] = [];
  for (let i = 0; i < c.trophies.length; i++) {
    const trophy = c.trophies[i];
    let q: number[];
    if (pinned[i]) {
      q = [99.5, 99.9, 99.99, 99.99, 99.99];
    } else {
      q = Z.map(z => invLogit(logit(medians[i]) + z * sigmas[i]));
      for (let j = 1; j < 5; j++) {
        if (q[j] < q[j - 1]) q[j] = q[j - 1];
      }
      q = q.map(v => Math.round(v * 10000) / 10000);
    }
    result.push({ id: trophy.id, q });
  }
  return result;
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs.readdirSync(inputDir).filter(f => f.endsWith(".in")).sort();
  for (const file of files) {
    const content = fs.readFileSync(path.join(inputDir, file), "utf-8");
    const input = JSON.parse(content) as CaseInput;
    const trophies = forecastOne(input);
    const outPath = path.join(outputDir, file.replace(/\.in$/, ".out"));
    fs.writeFileSync(outPath, JSON.stringify({ trophies }));
  }
}

main();
