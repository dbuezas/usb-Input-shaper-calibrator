import {
  type InputShaperType,
  type CorneringSettings,
  type ShaperParams,
  type ShaperScoreMode,
  isEiFamily,
  computeDelayCentroidSeconds,
} from '@/screens/ShaperScreen/input-shaper';
import { OPTIMIZER_UPDATE_EVERY_MS, SHAPER_F0_RANGE_HZ } from '@/constants';

import { variationScoreFromMagnitudeSpectrum } from '@/screens/ShaperScreen/shaper-scores/variation';
import { flatnessScoreFromMagnitudeSpectrum } from './shaper-scores/flatness';
import { klipperScoreFromMagnitudeSpectrum, suggestedMaxAccel } from './shaper-scores/klipper';

export type OptimisationResult = {
  params: ShaperParams;
  score: number;
  delay: number;
  maxAccel: number;
};
export type WorkerStartMessage = {
  type: 'start';
  magnitudes: Float32Array;
  scoreRangeHz: [number, number];
  scoreMode: ShaperScoreMode;
  cornering: CorneringSettings;
  candidateTypes?: InputShaperType[];
  frontierMode?: 'delay_centroid' | 'suggested_max_accel';
};

export type WorkerMessage = WorkerStartMessage;

export type WorkerUpdateMessage = {
  type: 'update';
  iterationsDone: number;
  iterationsTotal: number;
  history: OptimisationResult[];
};

export type WorkerDoneMessage = {
  type: 'done';
};

export type WorkerOutMessage = WorkerUpdateMessage | WorkerDoneMessage;

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
const SEARCH_F_STEP_HZ = 0.5;
// const SEARCH_ZETAS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
// const SEARCH_VTOLS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
const SEARCH_ZETAS = Array.from({ length: 10 }).map(
  (_, i, { length }) => (0.35 * (i + 1)) / length
);
const SEARCH_VTOLS = Array.from({ length: 10 }).map(
  (_, i, { length }) => (0.35 * (i + 1)) / length
);

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

const insertIntoFrontier = (
  frontier: OptimisationResult[],
  next: OptimisationResult,
  frontierMode: WorkerStartMessage['frontierMode']
) => {
  const mode = frontierMode ?? 'delay_centroid';
  for (const existing of frontier) {
    if (mode === 'suggested_max_accel') {
      // Keep a Pareto frontier where we prefer higher maxAccel and lower score.
      // If an existing point is at least as good on both axes, it dominates `next`.
      if (existing.maxAccel >= next.maxAccel && existing.score <= next.score) return false;
    } else {
      // Keep a Pareto frontier where we prefer lower delay and lower score.
      if (existing.delay <= next.delay && existing.score <= next.score) return false;
    }
  }

  let write = 0;
  for (let i = 0; i < frontier.length; i++) {
    const existing = frontier[i];
    if (mode === 'suggested_max_accel') {
      // Drop any points dominated by `next`.
      if (existing.maxAccel <= next.maxAccel && existing.score >= next.score) continue;
    } else {
      // Drop any points dominated by `next`.
      if (existing.delay >= next.delay && existing.score >= next.score) continue;
    }
    frontier[write++] = existing;
  }
  frontier.length = write;
  frontier.push(next);
  return true;
};

const bruteForce = (msg: WorkerStartMessage) => {
  const { magnitudes, scoreMode, scoreRangeHz } = msg;
  const types = (msg.candidateTypes?.length ? msg.candidateTypes : SEARCH_TYPES).filter(
    (t): t is InputShaperType => SEARCH_TYPES.includes(t)
  );
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

  const iterationsTotal = coarseTotal;
  let iterationsDone = 0;

  const frontierByType: Partial<Record<InputShaperType, OptimisationResult[]>> = {};

  let lastEmitTime = 0;
  const emitUpdate = (force: boolean) => {
    const now = performance.now();
    if (!force && now - lastEmitTime < OPTIMIZER_UPDATE_EVERY_MS) return;
    lastEmitTime = now;

    const history: OptimisationResult[] = [];
    for (const t of types) {
      const frontier = frontierByType[t];
      if (!frontier?.length) continue;
      history.push(...frontier);
    }

    const msg: WorkerUpdateMessage = {
      type: 'update',
      iterationsDone,
      iterationsTotal,
      history,
    };
    self.postMessage(msg);
  };

  type CandidateEval = {
    params: ShaperParams;
    delay: number;
    maxAccel: number;
  };

  for (const type of types) {
    const vtolCandidates = isEiFamily(type) ? vtols : [0.1];
    if (!zetas.length || !vtolCandidates.length) continue;

    // Build + cache delays first
    const candidates: CandidateEval[] = [];
    for (let fHz = fMin; fHz <= fMax; fHz += fStep) {
      for (const zeta of zetas) {
        for (const vtol of vtolCandidates) {
          const params: ShaperParams = { type, fHz, zeta, vtol };
          const delay = computeDelayCentroidSeconds(params);
          const maxAccel = suggestedMaxAccel(params, msg.cornering, 0.12);

          candidates.push({ params, delay, maxAccel });
        }
      }
    }
    switch (msg.frontierMode) {
      case 'delay_centroid':
        candidates.sort((a, b) => a.delay - b.delay);
        break;
      case 'suggested_max_accel':
        candidates.sort((b, a) => a.maxAccel - b.maxAccel);
        break;
    }
    // candidates.sort(() => Math.random() - 0.5);

    // Evaluate in that order
    for (const c of candidates) {
      iterationsDone++;

      const current = {
        ...c,
        score: scoreCandidate(magnitudes, c.params, scoreMode, msg.cornering, scoreRangeHz),
      };

      const frontier = (frontierByType[type] ??= []);
      insertIntoFrontier(frontier, current, msg.frontierMode);

      emitUpdate(false);
    }
  }

  emitUpdate(true);
  const done: WorkerDoneMessage = { type: 'done' };
  self.postMessage(done);
};

self.onmessage = (evt: MessageEvent<WorkerMessage>) => {
  const msg = evt.data;

  switch (msg.type as string) {
    case 'start':
      return bruteForce(msg);
  }
};
