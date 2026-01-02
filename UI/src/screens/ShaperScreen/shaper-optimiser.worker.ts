import {
  computeMarlinShaperTaps,
  type InputShaperType,
  type CorneringSettings,
  type ShaperParams,
  type ShaperScoreMode,
  klipperScoreFromMagnitudeSpectrum,
} from '@/screens/ShaperScreen/input-shaper';
import {
  FIXED_SAMPLE_RATE,
  SHAPER_F0_MAX_HZ,
  SHAPER_F0_MIN_HZ,
  SHAPER_VTOL_MAX,
  SHAPER_VTOL_MIN,
  SHAPER_ZETA_MAX,
  SHAPER_ZETA_MIN,
} from '@/constants';

export type WorkerCorneringSettings =
  | { model: 'scv'; scv: number }
  | { model: 'jerk'; jerk: number }
  | { model: 'junction_deviation'; junctionDeviation: number };

const toCorneringSettings = (v?: WorkerCorneringSettings): CorneringSettings => {
  if (!v) return { model: 'scv', scv: 5 };
  switch (v.model) {
    case 'scv':
      return { model: 'scv', scv: v.scv };
    case 'jerk':
      return { model: 'jerk', jerk: v.jerk };
    case 'junction_deviation':
      return { model: 'junction_deviation', junctionDeviation: v.junctionDeviation };
  }
};

export type OptimisationResult = { params: ShaperParams; score: number };
export type BestByType = Partial<Record<InputShaperType, OptimisationResult>>;

export type WorkerStartMessage = {
  type: 'start';
  magnitudes: Float32Array;
  peakHz: number;
  scoreRangeHz: [number, number];
  uiUpdateEveryMs: number;
  scoreMode: ShaperScoreMode;
  cornering?: WorkerCorneringSettings;
  candidateTypes?: InputShaperType[];
  /** If true, stop after the coarse grid search and skip the final gradient-descent refinement. */
  skipFine?: boolean;
};

export type WorkerRefineMessage = {
  type: 'refine';
  magnitudes: Float32Array;
  peakHz: number;
  scoreRangeHz: [number, number];
  uiUpdateEveryMs: number;
  scoreMode: ShaperScoreMode;
  cornering?: WorkerCorneringSettings;
  startParams: ShaperParams;
  steps?: number;
};

export type WorkerMessage = WorkerStartMessage | WorkerRefineMessage;

export type WorkerProgressMessage = {
  type: 'progress';
  percent: number;
  iterationsDone: number;
  iterationsTotal: number;
  current?: OptimisationResult;
  best?: OptimisationResult;
  bestByType?: BestByType;
};

export type WorkerDoneMessage = {
  type: 'done';
  best?: OptimisationResult;
  bestByType?: BestByType;
};

export type WorkerOutMessage = WorkerProgressMessage | WorkerDoneMessage;

// Optimiser search space (kept local to the worker).
export const SEARCH_TYPES: InputShaperType[] = [
  'zv',
  'zvd',
  'zvdd',
  'zvddd',
  'mzv',
  'ei',
  '2hei',
  '3hei',
];
const SEARCH_F_STEP_HZ = 1;
const SEARCH_ZETAS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
const SEARCH_VTOLS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
const SEARCH_F_MIN_ABS_HZ = SHAPER_F0_MIN_HZ;
const SEARCH_F_MAX_ABS_HZ = SHAPER_F0_MAX_HZ;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isEiFamily = (t: InputShaperType) => t === 'ei' || t === '2hei' || t === '3hei';

const shaperMagnitudeAtHzFromTaps = (a: number[], t: number[], freqHz: number) => {
  const w = 2 * Math.PI * freqHz;
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    const phase = -w * (t[i] ?? 0);
    re += (a[i] ?? 0) * Math.cos(phase);
    im += (a[i] ?? 0) * Math.sin(phase);
  }
  return Math.sqrt(re * re + im * im);
};

const flatnessScoreFromMagnitudeSpectrumFast = (
  magnitudes: Float32Array,
  params: ShaperParams,
  freqRangeHz: [number, number]
) => {
  if (!magnitudes.length) return Number.POSITIVE_INFINITY;

  const freqStepHz = FIXED_SAMPLE_RATE / (2 * (magnitudes.length - 1));
  const fMinHz = Math.min(freqRangeHz[0], freqRangeHz[1]);
  const fMaxHz = Math.max(freqRangeHz[0], freqRangeHz[1]);
  const start = Math.max(0, Math.floor(fMinHz / freqStepHz));
  const end = Math.min(magnitudes.length - 1, Math.floor(fMaxHz / freqStepHz));
  if (end <= start) return Number.POSITIVE_INFINITY;
  const count = end - start + 1;

  const taps = computeMarlinShaperTaps(params);
  const a = taps.a;
  const t = taps.t;
  if (!a.length || !t.length) return Number.POSITIVE_INFINITY;

  // Two-pass: mean then SSE, but no allocations and taps computed once.
  let sum = 0;
  for (let i = start; i <= end; i++) {
    const h = shaperMagnitudeAtHzFromTaps(a, t, i * freqStepHz);
    sum += (magnitudes[i] ?? 0) * h;
  }
  const mean = sum / count;
  if (!Number.isFinite(mean) || mean <= 0) return Number.POSITIVE_INFINITY;

  let sse = 0;
  for (let i = start; i <= end; i++) {
    const h = shaperMagnitudeAtHzFromTaps(a, t, i * freqStepHz);
    const d = (magnitudes[i] ?? 0) * h - mean;
    sse += d * d;
  }

  const denom = mean * mean * count;
  return denom > 0 ? sse / denom : Number.POSITIVE_INFINITY;
};

const variationScoreFromMagnitudeSpectrumFast = (
  magnitudes: Float32Array,
  params: ShaperParams,
  freqRangeHz: [number, number]
) => {
  if (!magnitudes.length) return Number.POSITIVE_INFINITY;

  const freqStepHz = FIXED_SAMPLE_RATE / (2 * (magnitudes.length - 1));
  const fMinHz = Math.min(freqRangeHz[0], freqRangeHz[1]);
  const fMaxHz = Math.max(freqRangeHz[0], freqRangeHz[1]);
  const start = Math.max(0, Math.floor(fMinHz / freqStepHz));
  const end = Math.min(magnitudes.length - 1, Math.floor(fMaxHz / freqStepHz));
  if (end <= start) return Number.POSITIVE_INFINITY;

  const taps = computeMarlinShaperTaps(params);
  const a = taps.a;
  const t = taps.t;
  if (!a.length || !t.length) return Number.POSITIVE_INFINITY;

  // Total variation of the shaped spectrum: Σ |y[i] - y[i-1]|.
  let prev = magnitudes[start] * shaperMagnitudeAtHzFromTaps(a, t, start * freqStepHz);
  let tv = 0;
  for (let i = start + 1; i <= end; i++) {
    const h = shaperMagnitudeAtHzFromTaps(a, t, i * freqStepHz);
    const next = magnitudes[i] * h;
    tv += Math.abs(next - prev);
    prev = next;
  }
  return Number.isFinite(tv) ? tv : Number.POSITIVE_INFINITY;
};

const scoreCandidate = (
  magnitudes: Float32Array,
  params: ShaperParams,
  peakHz: number,
  scoreMode: ShaperScoreMode,
  cornering: CorneringSettings,
  scoreRangeHz: [number, number]
) => {
  const { a, t } = computeMarlinShaperTaps(params);
  const hPeak = shaperMagnitudeAtHzFromTaps(a, t, peakHz);
  if (!Number.isFinite(hPeak) || hPeak > 2.5) return Number.POSITIVE_INFINITY;

  const total =
    scoreMode === 'flatness'
      ? flatnessScoreFromMagnitudeSpectrumFast(magnitudes, params, scoreRangeHz)
      : scoreMode === 'variation'
        ? variationScoreFromMagnitudeSpectrumFast(magnitudes, params, scoreRangeHz)
        : klipperScoreFromMagnitudeSpectrum(magnitudes, params, cornering, 5000, scoreRangeHz);
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
};

type FineState = {
  type: InputShaperType;
  params: ShaperParams;
  score: number;
  done: boolean;
  stepFHz: number;
  stepZeta: number;
  stepVtol: number;
};

type CoarseState = {
  type: InputShaperType;
  fHzCandidates: number[];
  zetaCandidates: number[];
  vtolCandidates: number[];
  fIndex: number;
  zIndex: number;
  vIndex: number;
  bestScore: number;
};

const coarseNext = (
  state: CoarseState
): { params: ShaperParams; next: CoarseState } | undefined => {
  if (state.fIndex >= state.fHzCandidates.length) return undefined;
  const fHz = state.fHzCandidates[state.fIndex] ?? 0;
  const zeta = state.zetaCandidates[state.zIndex] ?? 0;
  const vtol = state.vtolCandidates[state.vIndex] ?? 0;
  const params: ShaperParams = { type: state.type, fHz, zeta, vtol };

  // Advance (vtol -> zeta -> fHz)
  let { fIndex, zIndex, vIndex } = state;
  vIndex++;
  if (vIndex >= state.vtolCandidates.length) {
    vIndex = 0;
    zIndex++;
    if (zIndex >= state.zetaCandidates.length) {
      zIndex = 0;
      fIndex++;
    }
  }

  return {
    params,
    next: { ...state, fIndex, zIndex, vIndex },
  };
};

const frequencyCandidatesFarToNear = (
  fMin: number,
  fMax: number,
  fStep: number,
  peakHz: number
) => {
  const asc: number[] = [];
  for (let f = fMin; f <= fMax; f += fStep) asc.push(f);
  if (!asc.length) return asc;

  // Start at extremes and walk inward, always choosing the side farther from peakHz.
  let lo = 0;
  let hi = asc.length - 1;
  let takeLoOnTie = true;
  const out: number[] = [];
  while (lo <= hi) {
    const fLo = asc[lo] ?? 0;
    const fHi = asc[hi] ?? 0;
    const dLo = Math.abs(fLo - peakHz);
    const dHi = Math.abs(fHi - peakHz);

    if (dLo > dHi) {
      out.push(fLo);
      lo++;
      continue;
    }
    if (dHi > dLo) {
      out.push(fHi);
      hi--;
      continue;
    }

    // Tie: alternate between low and high.
    if (takeLoOnTie) {
      out.push(fLo);
      lo++;
    } else {
      out.push(fHi);
      hi--;
    }
    takeLoOnTie = !takeLoOnTie;
  }

  return out;
};

class MaxHeap<T> {
  private data: T[] = [];
  private readonly scoreFn: (v: T) => number;
  constructor(scoreFn: (v: T) => number) {
    this.scoreFn = scoreFn;
  }
  get size() {
    return this.data.length;
  }
  push(v: T) {
    this.data.push(v);
    this.siftUp(this.data.length - 1);
  }
  pop(): T | undefined {
    if (!this.data.length) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length && last) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }
  private siftUp(i: number) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.scoreFn(this.data[i]) <= this.scoreFn(this.data[p])) break;
      [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
      i = p;
    }
  }
  private siftDown(i: number) {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = i;
      if (l < this.data.length && this.scoreFn(this.data[l]) > this.scoreFn(this.data[best])) {
        best = l;
      }
      if (r < this.data.length && this.scoreFn(this.data[r]) > this.scoreFn(this.data[best])) {
        best = r;
      }
      if (best === i) break;
      [this.data[i], this.data[best]] = [this.data[best], this.data[i]];
      i = best;
    }
  }
}

const fineStep = (
  magnitudes: Float32Array,
  state: FineState,
  peakHz: number,
  scoreMode: ShaperScoreMode,
  cornering: CorneringSettings,
  scoreRangeHz: [number, number],
  bounds: { fMin: number; fMax: number }
) => {
  if (state.done) return state;

  // Derivative-free coordinate descent with per-parameter adaptive step sizes.
  // Robust across non-smooth objectives.
  const minStepFHz = 0.01;
  const minStepZeta = 0.001;
  const minStepVtol = 0.001;

  const tryMove = (next: ShaperParams): number =>
    scoreCandidate(magnitudes, next, peakHz, scoreMode, cornering, scoreRangeHz);

  let bestParams = state.params;
  let bestScore = state.score;
  let stepFHz = state.stepFHz;
  let stepZeta = state.stepZeta;
  let stepVtol = state.stepVtol;

  const applyAxisSearch = (
    axis: 'fHz' | 'zeta' | 'vtol',
    step: number
  ): { step: number; improved: boolean } => {
    if (step <= 0) return { step, improved: false };

    const base = bestParams[axis];
    const candidates: Array<{ params: ShaperParams; score: number }> = [];

    const clampAxis = (v: number) => {
      if (axis === 'fHz') return clamp(v, bounds.fMin, bounds.fMax);
      if (axis === 'zeta') return clamp(v, SHAPER_ZETA_MIN, SHAPER_ZETA_MAX);
      return clamp(v, SHAPER_VTOL_MIN, SHAPER_VTOL_MAX);
    };

    const plus = clampAxis(base + step);
    if (plus !== base) {
      const p = { ...bestParams, [axis]: plus } as ShaperParams;
      candidates.push({ params: p, score: tryMove(p) });
    }

    const minus = clampAxis(base - step);
    if (minus !== base) {
      const p = { ...bestParams, [axis]: minus } as ShaperParams;
      candidates.push({ params: p, score: tryMove(p) });
    }

    let improved = false;
    for (const c of candidates) {
      if (Number.isFinite(c.score) && c.score + 1e-12 < bestScore) {
        bestScore = c.score;
        bestParams = c.params;
        improved = true;
      }
    }

    return { step: improved ? step * 1.15 : step * 0.5, improved };
  };

  let anyImproved = false;
  for (let sweep = 0; sweep < 4; sweep++) {
    const f = applyAxisSearch('fHz', stepFHz);
    stepFHz = f.step;
    anyImproved ||= f.improved;

    const z = applyAxisSearch('zeta', stepZeta);
    stepZeta = z.step;
    anyImproved ||= z.improved;

    if (isEiFamily(bestParams.type)) {
      const v = applyAxisSearch('vtol', stepVtol);
      stepVtol = v.step;
      anyImproved ||= v.improved;
    }

    if (!anyImproved) break;
  }

  const done =
    !anyImproved &&
    stepFHz <= minStepFHz &&
    stepZeta <= minStepZeta &&
    (!isEiFamily(bestParams.type) || stepVtol <= minStepVtol);

  return {
    ...state,
    params: bestParams,
    score: bestScore,
    done,
    stepFHz,
    stepZeta,
    stepVtol,
  };
};

const refine = (msg: WorkerRefineMessage) => {
  const { magnitudes, peakHz, uiUpdateEveryMs, scoreRangeHz } = msg;
  const safetyCapSteps = msg.steps ?? 20_000;
  const start = msg.startParams;
  const cornering = toCorneringSettings(msg.cornering);

  const bounds = { fMin: SEARCH_F_MIN_ABS_HZ, fMax: SEARCH_F_MAX_ABS_HZ };

  let state: FineState = {
    type: start.type,
    params: {
      type: start.type,
      fHz: start.fHz,
      zeta: start.zeta,
      vtol: start.vtol,
    },
    score: scoreCandidate(magnitudes, start, peakHz, msg.scoreMode, cornering, scoreRangeHz),
    done: false,
    stepFHz: 1,
    stepZeta: 0.02,
    stepVtol: 0.02,
  };

  let best: OptimisationResult | undefined;
  if (Number.isFinite(state.score)) best = { params: state.params, score: state.score };

  let lastUiUpdate = performance.now();

  let iterationsDone = 0;
  for (let i = 0; i < safetyCapSteps; i++) {
    state = fineStep(magnitudes, state, peakHz, msg.scoreMode, cornering, scoreRangeHz, bounds);
    if (!best || state.score < best.score) best = { params: state.params, score: state.score };

    iterationsDone = i + 1;

    const now = performance.now();
    if (now - lastUiUpdate > uiUpdateEveryMs) {
      lastUiUpdate = now;
      const out: WorkerProgressMessage = {
        type: 'progress',
        percent: (100 * (i + 1)) / Math.max(1, safetyCapSteps),
        iterationsDone: i + 1,
        iterationsTotal: safetyCapSteps,
        current: { params: state.params, score: state.score },
        best,
        bestByType: { [start.type]: best } satisfies BestByType,
      };
      self.postMessage(out satisfies WorkerOutMessage);
    }
    if (state.done) break;
  }

  // Ensure the UI gets a final progress update reflecting the actual number of iterations.
  self.postMessage({
    type: 'progress',
    percent: safetyCapSteps ? (100 * iterationsDone) / safetyCapSteps : 0,
    iterationsDone,
    iterationsTotal: safetyCapSteps,
    current: { params: state.params, score: state.score },
    best,
    bestByType: best ? ({ [start.type]: best } satisfies BestByType) : undefined,
  } satisfies WorkerOutMessage);

  self.postMessage({
    type: 'done',
    best,
    bestByType: best ? ({ [start.type]: best } satisfies BestByType) : undefined,
  } satisfies WorkerOutMessage);
  return;
};

const bruteForce = (msg: WorkerStartMessage) => {
  const { magnitudes, peakHz, uiUpdateEveryMs, scoreMode, scoreRangeHz } = msg;
  const cornering = toCorneringSettings(msg.cornering);
  const types = (msg.candidateTypes?.length ? msg.candidateTypes : SEARCH_TYPES).filter(
    (t): t is InputShaperType => SEARCH_TYPES.includes(t)
  );
  const skipFine = !!msg.skipFine;
  const fStep = SEARCH_F_STEP_HZ;
  const zetas = SEARCH_ZETAS;
  const vtols = SEARCH_VTOLS;

  const fMin = SEARCH_F_MIN_ABS_HZ;
  const fMax = SEARCH_F_MAX_ABS_HZ;

  // Coarse iteration count
  let coarseTotal = 0;
  for (const t of types) {
    const vtolCount = isEiFamily(t) ? vtols.length : 1;
    const fCount = Math.floor((fMax - fMin) / fStep) + 1;
    coarseTotal += fCount * zetas.length * vtolCount;
  }

  const fineStepsPerType = 2000;
  const iterationsTotal = coarseTotal + fineStepsPerType * types.length;
  let iterationsDone = 0;

  let best: OptimisationResult | undefined;
  const bestByType: BestByType = {};
  let lastUiUpdate = performance.now();

  // Phase 1: coarse grid search (interleaved worst->best across types)
  const fHzCandidates = frequencyCandidatesFarToNear(fMin, fMax, fStep, peakHz);

  const coarseHeap = new MaxHeap<CoarseState>((s) => s.bestScore);
  for (const candidateType of types) {
    const vtolCandidates = isEiFamily(candidateType) ? vtols : [0.1];
    if (!fHzCandidates.length || !zetas.length || !vtolCandidates.length) continue;
    coarseHeap.push({
      type: candidateType,
      fHzCandidates,
      zetaCandidates: zetas,
      vtolCandidates,
      fIndex: 0,
      zIndex: 0,
      vIndex: 0,
      bestScore: Number.POSITIVE_INFINITY,
    });
  }

  for (let i = 0; i < coarseTotal; i++) {
    const state = coarseHeap.pop();
    if (!state) {
      // No candidates left to evaluate; still advance progress.
      iterationsDone++;
      continue;
    }

    const next = coarseNext(state);
    if (!next) {
      iterationsDone++;
      continue;
    }

    iterationsDone++;
    const params = next.params;
    const score = scoreCandidate(magnitudes, params, peakHz, scoreMode, cornering, scoreRangeHz);
    const current: OptimisationResult = { params, score };

    if (Number.isFinite(score)) {
      const prevByType = bestByType[state.type];
      if (!prevByType || score < prevByType.score) bestByType[state.type] = current;
      if (!best || score < best.score) best = current;
      next.next.bestScore = Math.min(next.next.bestScore, score);
    }

    // Reinsert if there is more work for this type.
    if (next.next.fIndex < next.next.fHzCandidates.length) {
      coarseHeap.push(next.next);
    }

    const now = performance.now();
    if (now - lastUiUpdate > uiUpdateEveryMs) {
      lastUiUpdate = now;
      const out: WorkerProgressMessage = {
        type: 'progress',
        percent: (100 * iterationsDone) / Math.max(1, iterationsTotal),
        iterationsDone,
        iterationsTotal,
        current,
        best,
        bestByType,
      };
      self.postMessage(out satisfies WorkerOutMessage);
    }
  }

  if (skipFine) {
    const out: WorkerDoneMessage = { type: 'done', best, bestByType };
    self.postMessage(out satisfies WorkerOutMessage);
    return;
  }

  // Phase 2: fine local optimisation (gradient descent) from per-type coarse best
  const heap = new MaxHeap<FineState>((s) => s.score);
  const remainingByType = new Map<InputShaperType, number>();
  for (const candidateType of types) {
    remainingByType.set(candidateType, fineStepsPerType);
    const start = bestByType[candidateType];
    if (!start) continue;
    heap.push({
      type: candidateType,
      params: start.params,
      score: start.score,
      done: false,
      stepFHz: 0.5,
      stepZeta: 0.01,
      stepVtol: 0.01,
    });
  }

  // Interleave refinement across types: always refine the currently-worst candidate next.
  const bounds = { fMin, fMax };
  const fineBudget = fineStepsPerType * types.length;
  for (let i = 0; i < fineBudget; i++) {
    const state = heap.pop();
    if (!state) {
      break;
    }

    const left = remainingByType.get(state.type) ?? 0;
    if (left <= 0) {
      iterationsDone++;
      continue;
    }
    remainingByType.set(state.type, left - 1);

    const nextState = fineStep(
      magnitudes,
      state,
      peakHz,
      scoreMode,
      cornering,
      scoreRangeHz,
      bounds
    );
    iterationsDone++;

    const current: OptimisationResult = { params: nextState.params, score: nextState.score };
    const prevByType = bestByType[nextState.type];
    if (!prevByType || current.score < prevByType.score) bestByType[nextState.type] = current;
    if (!best || current.score < best.score) best = current;

    if (!nextState.done && (remainingByType.get(nextState.type) ?? 0) > 0) {
      heap.push(nextState);
    }

    const now = performance.now();
    if (now - lastUiUpdate > uiUpdateEveryMs) {
      lastUiUpdate = now;
      const out: WorkerProgressMessage = {
        type: 'progress',
        percent: (100 * iterationsDone) / Math.max(1, iterationsTotal),
        iterationsDone,
        iterationsTotal,
        current,
        best,
        bestByType,
      };
      self.postMessage(out satisfies WorkerOutMessage);
    }
  }

  const out: WorkerDoneMessage = { type: 'done', best, bestByType };
  self.postMessage(out satisfies WorkerOutMessage);
};

self.onmessage = (evt: MessageEvent<WorkerMessage>) => {
  const msg = evt.data;

  switch (msg.type) {
    case 'refine': {
      return refine(msg);
    }
    case 'start': {
      return bruteForce(msg);
    }
  }
};
