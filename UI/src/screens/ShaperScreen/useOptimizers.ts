import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { WEB_WORKER_THREADS } from '@/constants';
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

const safeFirst = <T>(items: readonly T[]): T | undefined => {
  return items.length ? items[0] : undefined;
};

const mergeBestByType = (chunks: Iterable<BestByType>): BestByType => {
  const out: BestByType = {};
  for (const chunk of chunks) {
    for (const [type, next] of Object.entries(chunk) as Array<
      [keyof BestByType, BestByType[keyof BestByType]]
    >) {
      if (!next) continue;
      const prev = out[type];
      if (!prev || next.score < prev.score) out[type] = next;
    }
  }
  return out;
};

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
    const perWorkerBestByType = new Map<Worker, BestByType>();
    const perWorkerHistory = new Map<Worker, OptimisationResult[]>();
    const perWorkerBestOverall = new Map<Worker, OptimisationResult | undefined>();

    const completion = new Promise<void>((resolve) => {
      let idx = 0;
      let finalBest: OptimisationResult | undefined;
      for (const worker of workersRef.current) {
        const candidateTypes = typeChunks[idx++];

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'progress': {
              // Legacy worker message type; keep minimal work here.
              perWorkerProgress.set(worker, msg);
              setOptimiseProgress(msg);
              return;
            }

            case 'update': {
              perWorkerBestByType.set(worker, msg.bestByType);
              perWorkerHistory.set(worker, msg.history);
              perWorkerBestOverall.set(worker, msg.bestOverall);

              const workerCurrent = msg.bestOverall ?? safeFirst(msg.history) ?? finalBest;
              if (workerCurrent) {
                perWorkerProgress.set(worker, {
                  type: 'progress',
                  iterationsDone: msg.iterationsDone,
                  iterationsTotal: msg.iterationsTotal,
                  current: workerCurrent,
                });
              }

              let iterationsDone = 0;
              let iterationsTotal = 0;
              for (const p of perWorkerProgress.values()) {
                iterationsDone += p.iterationsDone;
                iterationsTotal += p.iterationsTotal;
              }

              const mergedBestByType = mergeBestByType(perWorkerBestByType.values());
              const mergedHistory: OptimisationResult[] = [];
              for (const h of perWorkerHistory.values()) mergedHistory.push(...h);

              let bestOverall: OptimisationResult | undefined;
              for (const b of perWorkerBestOverall.values()) {
                if (!b) continue;
                if (!bestOverall || b.score < bestOverall.score) bestOverall = b;
              }

              const current = bestOverall ?? safeFirst(mergedHistory);
              if (!current) return;

              setOptimiseProgress({
                type: 'progress',
                iterationsDone,
                iterationsTotal,
                current,
              });
              setBestByType(mergedBestByType);
              setOptimisationHistory(mergedHistory);
              if (!finalBest || current.score < finalBest.score) {
                finalBest = current;
              }
              setShaperParams(current.params);
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
