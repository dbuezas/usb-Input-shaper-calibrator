import {
  type InputShaperType,
  type CorneringSettings,
  type ShaperParams,
  type ShaperScoreMode,
} from '@/screens/ShaperScreen/input-shaper';
import { SHAPER_F0_RANGE_HZ, SHAPER_VTOL_RANGE, SHAPER_ZETA_RANGE } from '@/constants';

import { variationScoreFromMagnitudeSpectrum } from '@/screens/ShaperScreen/shaper-scores/variation';
import { flatnessScoreFromMagnitudeSpectrum } from './shaper-scores/flatness';
import { klipperScoreFromMagnitudeSpectrum } from './shaper-scores/klipper';

export type OptimisationResult = { params: ShaperParams; score: number };
export type BestByType = Partial<Record<InputShaperType, OptimisationResult>>;

export type WorkerStartMessage = {
  type: 'start';
  magnitudes: Float32Array;
  scoreRangeHz: [number, number];
  scoreMode: ShaperScoreMode;
  cornering: CorneringSettings;
  candidateTypes?: InputShaperType[];
  /** If true, stop after the coarse grid search and skip the final gradient-descent refinement. */
  skipFine?: boolean;
};

export type WorkerRefineMessage = {
  type: 'refine';
  magnitudes: Float32Array;
  scoreRangeHz: [number, number];
  scoreMode: ShaperScoreMode;
  cornering: CorneringSettings;
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isEiFamily = (t: InputShaperType) => t === 'ei' || t === '2hei' || t === '3hei';

const scoreCandidate = (
  magnitudes: Float32Array,
  params: ShaperParams,
  scoreMode: ShaperScoreMode,
  cornering: CorneringSettings,
  scoreRangeHz: [number, number]
) => {
  switch (scoreMode) {
    case 'flatness':
      return flatnessScoreFromMagnitudeSpectrum(magnitudes, params, scoreRangeHz);
    case 'klipper':
      return klipperScoreFromMagnitudeSpectrum(magnitudes, params, cornering, 5000, scoreRangeHz);
    case 'variation':
      return variationScoreFromMagnitudeSpectrum(magnitudes, params, scoreRangeHz);
  }
};

type FineState = {
  params: ShaperParams;
  score: number;
  done: boolean;
  stepFHz: number;
  stepZeta: number;
  stepVtol: number;
};

const runRefinementLoop = (opts: {
  magnitudes: Float32Array;
  initialState: FineState;
  scoreMode: ShaperScoreMode;
  cornering: CorneringSettings;
  scoreRangeHz: [number, number];
  bounds: { fMin: number; fMax: number };
  maxSteps: number;
  onStep?: (state: FineState, stepIndex: number) => void;
}): { state: FineState; stepsUsed: number } => {
  let state = opts.initialState;
  let stepsUsed = 0;

  // Derivative-free coordinate descent with per-parameter adaptive step sizes.
  // Robust across non-smooth objectives.
  const minStepFHz = 0.01;
  const minStepZeta = 0.001;
  const minStepVtol = 0.001;

  const tryMove = (next: ShaperParams): number =>
    scoreCandidate(opts.magnitudes, next, opts.scoreMode, opts.cornering, opts.scoreRangeHz);

  for (let i = 0; i < opts.maxSteps; i++) {
    if (!state.done) {
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
          if (axis === 'fHz') return clamp(v, opts.bounds.fMin, opts.bounds.fMax);
          if (axis === 'zeta') return clamp(v, ...SHAPER_ZETA_RANGE);
          return clamp(v, ...SHAPER_VTOL_RANGE);
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

      state = {
        ...state,
        params: bestParams,
        score: bestScore,
        done,
        stepFHz,
        stepZeta,
        stepVtol,
      };
    }

    stepsUsed = i + 1;
    opts.onStep?.(state, i);
    if (state.done) break;
  }

  return { state, stepsUsed };
};

const refine = (msg: WorkerRefineMessage) => {
  const { magnitudes, scoreRangeHz } = msg;
  const safetyCapSteps = msg.steps ?? 20_000;
  const start = msg.startParams;
  const bounds = { fMin: SHAPER_F0_RANGE_HZ[0], fMax: SHAPER_F0_RANGE_HZ[1] };
  const initialScore = scoreCandidate(
    magnitudes,
    start,
    msg.scoreMode,
    msg.cornering,
    scoreRangeHz
  );
  let best: OptimisationResult | undefined;
  if (Number.isFinite(initialScore)) best = { params: start, score: initialScore };

  const initialState: FineState = {
    params: start,
    score: initialScore,
    done: false,
    stepFHz: 1,
    stepZeta: 0.02,
    stepVtol: 0.02,
  };

  const { state, stepsUsed } = runRefinementLoop({
    magnitudes,
    initialState,
    scoreMode: msg.scoreMode,
    cornering: msg.cornering,
    scoreRangeHz,
    bounds,
    maxSteps: safetyCapSteps,
    onStep: (s, i) => {
      if (Number.isFinite(s.score) && (!best || s.score < best.score)) {
        best = { params: s.params, score: s.score };
      }

      self.postMessage({
        type: 'progress',
        percent: (100 * (i + 1)) / Math.max(1, safetyCapSteps),
        iterationsDone: i + 1,
        iterationsTotal: safetyCapSteps,
        current: { params: s.params, score: s.score },
        best,
        bestByType: best ? ({ [start.type]: best } satisfies BestByType) : undefined,
      } satisfies WorkerOutMessage);
    },
  });

  // Ensure the UI gets a final progress update reflecting the actual number of iterations.
  self.postMessage({
    type: 'progress',
    percent: safetyCapSteps ? (100 * stepsUsed) / safetyCapSteps : 0,
    iterationsDone: stepsUsed,
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
  const { magnitudes, scoreMode, scoreRangeHz } = msg;
  const types = (msg.candidateTypes?.length ? msg.candidateTypes : SEARCH_TYPES).filter(
    (t): t is InputShaperType => SEARCH_TYPES.includes(t)
  );
  const skipFine = !!msg.skipFine;
  const fStep = SEARCH_F_STEP_HZ;
  const zetas = SEARCH_ZETAS;
  const vtols = SEARCH_VTOLS;

  const fMin = SHAPER_F0_RANGE_HZ[0];
  const fMax = SHAPER_F0_RANGE_HZ[1];

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

  // Phase 1: coarse grid search (in-order)
  for (const candidateType of types) {
    const vtolCandidates = isEiFamily(candidateType) ? vtols : [0.1];
    if (!zetas.length || !vtolCandidates.length) continue;

    for (let fHz = fMin; fHz <= fMax; fHz += fStep) {
      for (const zeta of zetas) {
        for (const vtol of vtolCandidates) {
          iterationsDone++;

          const params: ShaperParams = { type: candidateType, fHz, zeta, vtol };
          const score = scoreCandidate(magnitudes, params, scoreMode, msg.cornering, scoreRangeHz);
          const current: OptimisationResult = { params, score };

          if (Number.isFinite(score)) {
            const prevByType = bestByType[candidateType];
            if (!prevByType || score < prevByType.score) bestByType[candidateType] = current;
            if (!best || score < best.score) best = current;
          }

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
    }
  }

  if (skipFine) {
    const out: WorkerDoneMessage = { type: 'done', best, bestByType };
    self.postMessage(out satisfies WorkerOutMessage);
    return;
  }

  // Phase 2: fine local optimisation from per-type coarse best (in-order)
  const bounds = { fMin, fMax };
  for (const candidateType of types) {
    const start = bestByType[candidateType];
    if (!start) {
      iterationsDone += fineStepsPerType;
      continue;
    }

    const initialState: FineState = {
      params: start.params,
      score: start.score,
      done: false,
      stepFHz: 0.5,
      stepZeta: 0.01,
      stepVtol: 0.01,
    };

    const { stepsUsed } = runRefinementLoop({
      magnitudes,
      initialState,
      scoreMode,
      cornering: msg.cornering,
      scoreRangeHz,
      bounds,
      maxSteps: fineStepsPerType,
      onStep: (s) => {
        iterationsDone++;

        const current: OptimisationResult = { params: s.params, score: s.score };
        const prevByType = bestByType[candidateType];
        if (!prevByType || current.score < prevByType.score) bestByType[candidateType] = current;
        if (!best || current.score < best.score) best = current;

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
      },
    });

    // Preserve iteration accounting for consistent progress, but stop evaluating.
    iterationsDone += fineStepsPerType - stepsUsed;
  }

  const out: WorkerDoneMessage = { type: 'done', best, bestByType };
  self.postMessage(out satisfies WorkerOutMessage);
};

self.onmessage = (evt: MessageEvent<WorkerMessage>) => {
  const msg = evt.data;

  switch (msg.type) {
    case 'refine':
      return refine(msg);
    case 'start':
      return bruteForce(msg);
  }
};
