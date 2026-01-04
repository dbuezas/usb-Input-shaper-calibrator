import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { OPTIMIZER_UPDATE_EVERY_MS, WEB_WORKER_THREADS } from '@/constants';
import { ALL_SHAPER_TYPES } from './input-shaper';
import ShaperOptimiserWorker from './shaper-optimiser.worker?worker';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import type {
  BestByType,
  OptimisationResult,
  WorkerOutMessage,
  WorkerProgressMessage,
  WorkerStartMessage,
} from './shaper-optimiser.worker';
import {
  shaperScoreModeAtom,
  analysisRangeAtom,
  optimisationHistoryAtom,
  shaperParamsAtom,
  corneringSettingsAtom,
} from './atoms';

const chunkRoundRobin = <T>(items: readonly T[], chunks: number): T[][] => {
  const n = Math.max(1, Math.floor(chunks));
  const out: T[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < items.length; i++) out[i % n].push(items[i]);
  return out.filter((c) => c.length);
};

export default function useOptimisers() {
  const setShaperParams = useSetAtom(shaperParamsAtom);
  const scoreMode = useAtomValue(shaperScoreModeAtom);
  const corneringSettings = useAtomValue(corneringSettingsAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const scoreRangeHz = useAtomValue(analysisRangeAtom);

  const [optimiseProgress, setOptimiseProgress] = useState<WorkerProgressMessage | null>(null);
  const [bestByType, setBestByType] = useState<BestByType>({});
  const setOptimisationHistory = useSetAtom(optimisationHistoryAtom);
  const workersRef = useRef<Set<Worker>>(new Set());

  const workerCount = Math.min(WEB_WORKER_THREADS, ALL_SHAPER_TYPES.length);
  const typeChunks = chunkRoundRobin(ALL_SHAPER_TYPES, workerCount);

  useEffect(() => {
    for (const w of workersRef.current) {
      w.terminate();
      workersRef.current.delete(w);
    }
  }, []);

  const runAutoOptimise = async () => {
    if (!maxHoldSpectrum.length) return;
    for (const w of workersRef.current) w.terminate();
    workersRef.current = new Set(typeChunks.map(() => new ShaperOptimiserWorker()));
    setOptimisationHistory([]);
    const perWorkerProgress = new Map<Worker, WorkerProgressMessage>();
    let lastUpdateTime = 0;
    const computeAggregateProgress = (msg: WorkerProgressMessage): WorkerProgressMessage => {
      let iterationsDone = 0;
      let iterationsTotal = 0;
      let { best } = msg;
      for (const p of perWorkerProgress.values()) {
        iterationsDone += p.iterationsDone;
        iterationsTotal += p.iterationsTotal;
        if (p.best.score < best.score) best = p.best;
      }

      return {
        iterationsDone,
        iterationsTotal,
        current: msg.current,
        best,
        type: 'progress',
      };
    };

    const completion = new Promise<void>((resolve) => {
      let idx = 0;
      let finalBest: OptimisationResult | undefined;
      for (const worker of workersRef.current) {
        const candidateTypes = typeChunks[idx++];

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'progress': {
              perWorkerProgress.set(worker, msg);
              setOptimisationHistory((existing) => [...existing, msg.current]);
              setOptimiseProgress(computeAggregateProgress(msg));
              const oldBestOfType =
                bestByType[msg.current.params.type]?.score ?? Number.POSITIVE_INFINITY;
              if (msg.current.score < oldBestOfType)
                setBestByType((prev) => ({
                  ...prev,
                  [msg.current.params.type]: msg.current.params,
                }));

              if (!finalBest || msg.current.score < finalBest.score) {
                finalBest = msg.current;
              }

              const now = performance.now();
              if (now - lastUpdateTime > OPTIMIZER_UPDATE_EVERY_MS) {
                lastUpdateTime = now;
                setShaperParams(msg.current.params);
              }
              return;
            }

            case 'done': {
              worker.terminate();
              workersRef.current.delete(worker);

              if (workersRef.current.size === 0) {
                // Snap UI to the final best result after optimisation finishes.
                if (finalBest) setShaperParams(finalBest.params);
                resolve();
              }
            }
          }
        };

        worker.addEventListener('message', handleMessage);

        worker.postMessage({
          type: 'start',
          magnitudes: maxHoldSpectrum,
          scoreRangeHz,
          scoreMode,
          cornering: corneringSettings,
          candidateTypes,
        } satisfies WorkerStartMessage);
      }
    });

    await completion;
  };

  return {
    runAutoOptimise,
    optimiseProgress,
    bestByType,
  };
}
