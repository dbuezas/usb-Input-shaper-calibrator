import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { OPTIMIZER_UPDATE_EVERY_MS, WEB_WORKER_THREADS } from '@/constants';
import type { CorneringSettings, InputShaperType } from './input-shaper';
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
  corneringModelAtom,
  corneringScvAtom,
  corneringJerkAtom,
  corneringJdAtom,
  analysisRangeAtom,
  optimisationHistoryAtom,
  type OptimisationHistoryEntry,
  shaperParamsAtom,
} from './atoms';

const ALL_SHAPER_TYPES: InputShaperType[] = [
  '3hei',
  'zvddd',
  '2hei',
  'zvdd',
  'ei',
  'zvd',
  'mzv',
  'zv',
];

const chunkRoundRobin = <T>(items: T[], chunks: number): T[][] => {
  const n = Math.max(1, Math.floor(chunks));
  const out: T[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < items.length; i++) out[i % n].push(items[i]);
  return out.filter((c) => c.length);
};

export default function useOptimisers() {
  const setShaperParams = useSetAtom(shaperParamsAtom);
  const scoreMode = useAtomValue(shaperScoreModeAtom);
  const corneringModel = useAtomValue(corneringModelAtom);
  const corneringScv = useAtomValue(corneringScvAtom);
  const corneringJerk = useAtomValue(corneringJerkAtom);
  const corneringJd = useAtomValue(corneringJdAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const scoreRangeHz = useAtomValue(analysisRangeAtom);

  const [optimiseProgress, setOptimiseProgress] = useState<WorkerProgressMessage | null>(null);
  const [bestByType, setBestByType] = useState<BestByType>({});
  const setOptimisationHistory = useSetAtom(optimisationHistoryAtom);
  const optimiserWorkersRef = useRef<Worker[]>([]);
  const lastBestByTypeRef = useRef<BestByType>({});
  const seenHistoryKeysRef = useRef<Set<string>>(new Set());

  const recordBestByType = (next: BestByType) => {
    const now = performance.now();
    const prev = lastBestByTypeRef.current;

    const newEntries: OptimisationHistoryEntry[] = [];
    for (const [typeKey, result] of Object.entries(next) as [
      InputShaperType,
      OptimisationResult,
    ][]) {
      const prevResult = prev[typeKey];
      if (prevResult && prevResult.score === result.score) continue;

      const p = result.params;
      const key = `${p.type}:${p.fHz.toFixed(4)}:${p.zeta.toFixed(6)}:${p.vtol.toFixed(6)}:${result.score.toFixed(12)}`;
      if (seenHistoryKeysRef.current.has(key)) continue;
      seenHistoryKeysRef.current.add(key);
      newEntries.push({ params: p, score: result.score, recordedAtMs: now });
    }

    if (newEntries.length) {
      setOptimisationHistory((existing) => [...existing, ...newEntries]);
    }
    lastBestByTypeRef.current = next;
  };

  useEffect(() => {
    return () => {
      for (const w of optimiserWorkersRef.current) w.terminate();
      optimiserWorkersRef.current = [];
    };
  }, []);
  const corneringToWorker = (): CorneringSettings => {
    switch (corneringModel) {
      case 'scv':
        return { model: 'scv', scv: corneringScv };
      case 'jerk':
        return { model: 'jerk', jerk: corneringJerk };
      case 'junction_deviation':
        return { model: 'junction_deviation', junctionDeviation: corneringJd };
    }
  };
  const runAutoOptimise = async () => {
    if (!maxHoldSpectrum.length) return;
    setOptimisationHistory([]);
    lastBestByTypeRef.current = {};
    seenHistoryKeysRef.current = new Set();

    const magnitudes = maxHoldSpectrum;

    for (const w of optimiserWorkersRef.current) w.terminate();
    optimiserWorkersRef.current = [];

    const workerCount = Math.max(1, Math.min(WEB_WORKER_THREADS, ALL_SHAPER_TYPES.length));
    const typeChunks = chunkRoundRobin(ALL_SHAPER_TYPES, workerCount);
    const workers = typeChunks.map(() => new ShaperOptimiserWorker());
    optimiserWorkersRef.current = workers;

    const perWorkerProgress = new Map<Worker, WorkerProgressMessage>();
    const perWorkerBestByType = new Map<Worker, BestByType>();
    let lastUpdateTime = 0;
    const computeAggregateProgress = (): WorkerProgressMessage | null => {
      if (!perWorkerProgress.size) return null;
      let iterationsDone = 0;
      let iterationsTotal = 0;
      let best: OptimisationResult | undefined;
      // "current" is inherently ambiguous across workers; take the most recent sender's current.
      const last = Array.from(perWorkerProgress.values()).at(-1);
      const current = last?.current;
      for (const p of perWorkerProgress.values()) {
        iterationsDone += p.iterationsDone;
        iterationsTotal += p.iterationsTotal;
        if (p.best && (!best || p.best.score < best.score)) best = p.best;
      }

      const percent = iterationsTotal ? (100 * iterationsDone) / iterationsTotal : 0;
      return { percent, iterationsDone, iterationsTotal, current, best, type: 'progress' };
    };

    const mergeBestByType = (): BestByType => {
      const merged: BestByType = {};
      for (const map of perWorkerBestByType.values()) {
        for (const [typeKey, result] of Object.entries(map) as [
          InputShaperType,
          OptimisationResult,
        ][]) {
          const prev = merged[typeKey];
          if (!prev || result.score < prev.score) merged[typeKey] = result;
        }
      }
      return merged;
    };

    const completion = new Promise<void>((resolve) => {
      let doneCount = 0;
      for (let idx = 0; idx < workers.length; idx++) {
        const worker = workers[idx];
        const candidateTypes = typeChunks[idx];

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'progress': {
              perWorkerProgress.set(worker, msg);
              if (msg.bestByType) perWorkerBestByType.set(worker, msg.bestByType);

              const aggregate = computeAggregateProgress();
              if (aggregate) setOptimiseProgress(aggregate);
              const merged = mergeBestByType();
              setBestByType(merged);
              recordBestByType(merged);

              const previewParams = msg.current?.params;
              const now = performance.now();
              if (previewParams && now - lastUpdateTime > OPTIMIZER_UPDATE_EVERY_MS) {
                lastUpdateTime = now;
                setShaperParams(previewParams);
              }
              return;
            }

            case 'done': {
              worker.terminate();

              doneCount++;
              if (doneCount == workers.length) {
                let finalBest: OptimisationResult | undefined = undefined;
                for (const [, bestByType] of perWorkerBestByType) {
                  for (const result of Object.values(bestByType)) {
                    if (result.score < (finalBest?.score ?? Number.POSITIVE_INFINITY)) {
                      finalBest = result;
                    }
                  }
                }
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
          magnitudes,
          scoreRangeHz,
          scoreMode,
          cornering: corneringToWorker(),
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
