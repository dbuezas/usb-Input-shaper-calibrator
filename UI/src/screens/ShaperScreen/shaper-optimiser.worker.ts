import {
  type InputShaperType,
  type CorneringSettings,
  type ShaperParams,
  isEiFamily,
  peakFromSeries,
  computeMarlinShaperTaps,
  shaperMagnitudeAtHzFromTaps,
  computeDelayCentroidSecondsFromTaps,
} from '@/screens/ShaperScreen/input-shaper';
import {
  FREQUENCY_SLIDER_RANGE_HZ,
  MIN_RESONANCE_REDUCTION_AT_SPECTROGRAM_PEAK,
  OPTIMIZER_UPDATE_EVERY_MS,
  SEARCH_F_STEP_HZ,
  SEARCH_VTOL_STEP,
  SEARCH_ZETA_STEP,
  SHAPER_F0_RANGE_HZ,
  SHAPER_VTOL_RANGE,
  SHAPER_ZETA_RANGE,
} from '@/constants';

import { suggestedMaxAccelFromTaps } from './shaper-scores/klipper';
import { scoreCandidateFromTaps, type ShaperScoreMode } from './shaper-scores';

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

function shuffle<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
}

const bruteForce = (msg: WorkerStartMessage) => {
  const { magnitudes, scoreMode, scoreRangeHz } = msg;
  const types = (msg.candidateTypes?.length ? msg.candidateTypes : SEARCH_TYPES).filter(
    (t): t is InputShaperType => SEARCH_TYPES.includes(t)
  );
  const candidates: ShaperParams[] = [];
  for (const type of types) {
    const isEi = isEiFamily(type);
    for (let fHz = SHAPER_F0_RANGE_HZ[0]; ; fHz += SEARCH_F_STEP_HZ) {
      fHz = Math.min(fHz, SHAPER_F0_RANGE_HZ[1]);
      for (let zeta = SHAPER_ZETA_RANGE[0]; ; zeta += SEARCH_ZETA_STEP) {
        zeta = Math.min(zeta, SHAPER_ZETA_RANGE[1]);
        for (let vtol = SHAPER_VTOL_RANGE[0]; ; vtol += SEARCH_VTOL_STEP) {
          vtol = Math.min(vtol, SHAPER_VTOL_RANGE[1]);
          candidates.push({ type, fHz, zeta, vtol });
          if (!isEi) break;
          if (vtol === SHAPER_VTOL_RANGE[1]) break;
        }
        if (zeta === SHAPER_ZETA_RANGE[1]) break;
      }
      if (fHz === SHAPER_F0_RANGE_HZ[1]) break;
    }
  }

  const iterationsTotal = candidates.length;
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

  shuffle(candidates);
  const peakHz = peakFromSeries(magnitudes, FREQUENCY_SLIDER_RANGE_HZ);

  // Evaluate in that order
  for (const params of candidates) {
    iterationsDone++;
    const taps = computeMarlinShaperTaps(params);
    const peakResponse = shaperMagnitudeAtHzFromTaps(taps.a, taps.t, peakHz);
    if (peakResponse < MIN_RESONANCE_REDUCTION_AT_SPECTROGRAM_PEAK) {
      const current = {
        params,
        delay: computeDelayCentroidSecondsFromTaps(taps),
        maxAccel: suggestedMaxAccelFromTaps(taps, msg.cornering, 0.12),
        score: scoreCandidateFromTaps(magnitudes, taps, scoreMode, msg.cornering, scoreRangeHz),
      };

      const frontier = (frontierByType[params.type] ??= []);
      insertIntoFrontier(frontier, current, msg.frontierMode);
    }
    emitUpdate(false);
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
