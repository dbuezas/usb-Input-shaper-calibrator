import {
  type InputShaperType,
  type CorneringSettings,
  type ShaperParams,
  type ShaperScoreMode,
  isEiFamily,
  computeDelayCentroidSeconds,
} from '@/screens/ShaperScreen/input-shaper';
import {
  OPTIMIZER_UPDATE_EVERY_MS,
  SEARCH_F_STEP_HZ,
  SEARCH_VTOL_STEP,
  SEARCH_ZETA_STEP,
  SHAPER_F0_RANGE_HZ,
  SHAPER_VTOL_RANGE,
  SHAPER_ZETA_RANGE,
} from '@/constants';

import { suggestedMaxAccel } from './shaper-scores/klipper';
import { scoreCandidate } from './shaper-scores';

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

const bruteForce = (msg: WorkerStartMessage) => {
  const { magnitudes, scoreMode, scoreRangeHz } = msg;
  const types = (msg.candidateTypes?.length ? msg.candidateTypes : SEARCH_TYPES).filter(
    (t): t is InputShaperType => SEARCH_TYPES.includes(t)
  );

  const candidates: ShaperParams[] = [];
  for (const type of types) {
    for (let fHz = SHAPER_F0_RANGE_HZ[0]; fHz <= SHAPER_F0_RANGE_HZ[1]; fHz += SEARCH_F_STEP_HZ) {
      for (
        let zeta = SHAPER_ZETA_RANGE[0];
        zeta <= SHAPER_ZETA_RANGE[1];
        zeta += SEARCH_ZETA_STEP
      ) {
        for (
          let vtol = SHAPER_VTOL_RANGE[0];
          vtol <= SHAPER_VTOL_RANGE[1];
          vtol += SEARCH_VTOL_STEP
        ) {
          candidates.push({ type, fHz, zeta, vtol });
          if (!isEiFamily(type)) break;
        }
      }
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
  candidates.sort(() => Math.random() - 0.5);

  // Evaluate in that order
  for (const params of candidates) {
    iterationsDone++;

    const current = {
      params,
      delay: computeDelayCentroidSeconds(params),
      maxAccel: suggestedMaxAccel(params, msg.cornering, 0.12),
      score: scoreCandidate(magnitudes, params, scoreMode, msg.cornering, scoreRangeHz),
    };

    const frontier = (frontierByType[params.type] ??= []);
    insertIntoFrontier(frontier, current, msg.frontierMode);

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
