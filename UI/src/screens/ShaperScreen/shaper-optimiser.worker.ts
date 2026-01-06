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
import { klipperScoreFromMagnitudeSpectrum } from './shaper-scores/klipper';

export type OptimisationResult = { params: ShaperParams; score: number; delay: number };
export type WorkerStartMessage = {
  type: 'start';
  magnitudes: Float32Array;
  scoreRangeHz: [number, number];
  scoreMode: ShaperScoreMode;
  cornering: CorneringSettings;
  candidateTypes?: InputShaperType[];
};

export type WorkerMessage = WorkerStartMessage;

export type WorkerUpdateMessage = {
  type: 'update';
  iterationsDone: number;
  iterationsTotal: number;
  current: OptimisationResult;
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

const insertIntoFrontier = (frontier: OptimisationResult[], next: OptimisationResult) => {
  for (const existing of frontier) {
    if (existing.delay <= next.delay && existing.score <= next.score) return false;
  }

  let write = 0;
  for (let i = 0; i < frontier.length; i++) {
    const existing = frontier[i];
    if (existing.delay >= next.delay && existing.score >= next.score) continue;
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

  let current: OptimisationResult | undefined;

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
      current: current ?? history[0],
      history,
    };
    self.postMessage(msg);
  };

  // Phase 1: coarse grid search (in-order)
  for (const candidateType of types) {
    const vtolCandidates = isEiFamily(candidateType) ? vtols : [0.1];
    if (!zetas.length || !vtolCandidates.length) continue;

    for (const vtol of vtolCandidates) {
      for (const zeta of zetas) {
        for (let fHz = fMin; fHz <= fMax; fHz += fStep) {
          iterationsDone++;

          const params: ShaperParams = { type: candidateType, fHz, zeta, vtol };
          const score = scoreCandidate(magnitudes, params, scoreMode, msg.cornering, scoreRangeHz);
          const delay = computeDelayCentroidSeconds(params);
          current = { params, score, delay };

          const frontier = (frontierByType[candidateType] ??= []);
          insertIntoFrontier(frontier, current);

          emitUpdate(false);
        }
      }
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
