import {
  type InputShaperType,
  type ShaperParams,
  klipperScoreFromMagnitudeSpectrum,
  shaperMagnitudeAtHz,
} from '@/screens/ShaperScreen/input-shaper';

type OptimisationResult = { params: ShaperParams; score: number };
type BestByType = Partial<Record<InputShaperType, OptimisationResult>>;

type WorkerStartMessage = {
  type: 'start';
  magnitudes: number[];
  fMin: number;
  fMax: number;
  fStep: number;
  types: InputShaperType[];
  zetas: number[];
  vtols: number[];
  peakHz: number;
  uiUpdateEveryMs: number;
};

type WorkerCancelMessage = { type: 'cancel' };

type WorkerMessage = WorkerStartMessage | WorkerCancelMessage;

type WorkerProgressMessage = {
  type: 'progress';
  percent: number;
  iterationsDone: number;
  iterationsTotal: number;
  current?: OptimisationResult;
  best?: OptimisationResult;
  bestByType?: BestByType;
};

type WorkerDoneMessage = { type: 'done'; best?: OptimisationResult; bestByType?: BestByType };
type WorkerErrorMessage = { type: 'error'; message: string };

type WorkerOutMessage = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage;

let cancelled = false;

self.onmessage = (evt: MessageEvent<WorkerMessage>) => {
  const msg = evt.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type !== 'start') return;

  cancelled = false;

  try {
    const { magnitudes, fMin, fMax, fStep, types, zetas, vtols, peakHz, uiUpdateEveryMs } = msg;

    let iterationsTotal = 0;
    for (const t of types) {
      const vtolCount = t === 'ei' || t === '2hei' || t === '3hei' ? vtols.length : 1;
      const fCount = Math.floor((fMax - fMin) / fStep) + 1;
      iterationsTotal += fCount * zetas.length * vtolCount;
    }

    let iterationsDone = 0;
    let best: OptimisationResult | undefined;
    const bestByType: BestByType = {};
    let lastUiUpdate = performance.now();

    for (const candidateType of types) {
      for (let f = fMin; f <= fMax; f += fStep) {
        for (const zeta of zetas) {
          const vtolCandidates =
            candidateType === 'ei' || candidateType === '2hei' || candidateType === '3hei'
              ? vtols
              : [0.1];
          for (const vtol of vtolCandidates) {
            if (cancelled) {
              const out: WorkerDoneMessage = { type: 'done', best };
              self.postMessage(out satisfies WorkerOutMessage);
              return;
            }

            iterationsDone++;
            const params: ShaperParams = { type: candidateType, fHz: f, zeta, vtol };

            const hPeak = shaperMagnitudeAtHz(params, peakHz);
            if (!Number.isFinite(hPeak) || hPeak > 2.5) continue;

            const total = klipperScoreFromMagnitudeSpectrum(magnitudes, params);
            if (!Number.isFinite(total)) continue;

            const current: OptimisationResult = { params, score: total };
            if (!best || total < best.score) best = current;
            const typeBest = bestByType[candidateType];
            if (!typeBest || total < typeBest.score) bestByType[candidateType] = current;

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
        }
      }
    }

    const out: WorkerDoneMessage = { type: 'done', best, bestByType };
    self.postMessage(out satisfies WorkerOutMessage);
  } catch (e) {
    const out: WorkerErrorMessage = {
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(out satisfies WorkerOutMessage);
  }
};
