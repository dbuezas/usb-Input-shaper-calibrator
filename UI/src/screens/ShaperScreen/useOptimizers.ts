import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { WEB_WORKER_THREADS } from '@/constants';
import { ALL_SHAPER_TYPES } from './input-shaper';
import ShaperOptimiserWorker from './shaper-optimiser.worker?worker';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import type {
  OptimisationResult,
  WorkerOutMessage,
  WorkerStartMessage,
} from './shaper-optimiser.worker';
import {
  shaperScoreModeAtom,
  analysisRangeAtom,
  optimisationHistoryAtom,
  corneringSettingsAtom,
  historyModeAtom,
} from './atoms';

const computeBestByType = (results: readonly OptimisationResult[]) => {
  const out: Partial<Record<string, OptimisationResult>> = {};
  for (const r of results) {
    const key = r.params.type;
    const prev = out[key];
    if (!prev || r.score < prev.score) out[key] = r;
  }
  return out;
};

const chunkRoundRobin = <T>(items: readonly T[], length: number): T[][] => {
  const out: T[][] = Array.from({ length }, () => []);
  for (let i = 0; i < items.length; i++) out[i % length].push(items[i]);
  return out.filter((c) => c.length);
};

export default function useOptimisers() {
  const scoreMode = useAtomValue(shaperScoreModeAtom);
  const corneringSettings = useAtomValue(corneringSettingsAtom);
  const historyMode = useAtomValue(historyModeAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const scoreRangeHz = useAtomValue(analysisRangeAtom);

  const [optimiseProgress, setOptimiseProgress] = useState<{
    iterationsDone: number;
    iterationsTotal: number;
  } | null>(null);
  const [bestByType, setBestByType] = useState(() => computeBestByType([]));
  const setOptimisationHistory = useSetAtom(optimisationHistoryAtom);
  const workersRef = useRef<Set<Worker>>(new Set());

  const workerCount = Math.min(WEB_WORKER_THREADS, ALL_SHAPER_TYPES.length);
  const typeChunks = chunkRoundRobin(ALL_SHAPER_TYPES, workerCount);
  const stop = () => {
    for (const w of workersRef.current) {
      w.terminate();
      workersRef.current.delete(w);
    }
    setOptimiseProgress(null);
  };
  useEffect(() => stop, []);

  const runAutoOptimise = async () => {
    if (!maxHoldSpectrum.length) return;
    for (const w of workersRef.current) w.terminate();
    workersRef.current = new Set(typeChunks.map(() => new ShaperOptimiserWorker()));
    setOptimisationHistory([]);

    const perWorkerProgress = new Map<
      Worker,
      { iterationsDone: number; iterationsTotal: number }
    >();
    const perWorkerHistory = new Map<Worker, OptimisationResult[]>();

    const completion = new Promise<void>((resolve) => {
      let idx = 0;
      for (const worker of workersRef.current) {
        const candidateTypes = typeChunks[idx++];

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'update': {
              perWorkerHistory.set(worker, msg.history);

              perWorkerProgress.set(worker, {
                iterationsDone: msg.iterationsDone,
                iterationsTotal: msg.iterationsTotal,
              });

              let iterationsDone = 0;
              let iterationsTotal = 0;
              for (const p of perWorkerProgress.values()) {
                iterationsDone += p.iterationsDone;
                iterationsTotal += p.iterationsTotal;
              }

              setOptimiseProgress({
                iterationsDone,
                iterationsTotal,
              });
              const finalHistory = Array.from(perWorkerHistory.values()).flat();
              setOptimisationHistory(finalHistory);
              setBestByType(computeBestByType(finalHistory));

              return;
            }

            case 'done': {
              worker.terminate();
              workersRef.current.delete(worker);

              if (workersRef.current.size === 0) {
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
          frontierMode: historyMode === 'centroid_ms' ? 'delay_centroid' : 'suggested_max_accel',
        } satisfies WorkerStartMessage);
      }
    });

    await completion;

    const finalHistory = Array.from(perWorkerHistory.values()).flat();
    setBestByType(computeBestByType(finalHistory));
    setOptimiseProgress(null);
  };

  return {
    runAutoOptimise,
    optimiseProgress,
    bestByType,
    stop,
  };
}
