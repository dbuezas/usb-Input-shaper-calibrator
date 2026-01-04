import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { OPTIMIZER_UPDATE_EVERY_MS, WEB_WORKER_THREADS } from '@/constants';
import { ALL_SHAPER_TYPES, type InputShaperType } from './input-shaper';
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
  type OptimisationHistoryEntry,
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
  const lastBestByTypeRef = useRef<BestByType>({});
  const seenHistoryKeysRef = useRef<Set<string>>(new Set());

  const workerCount = Math.min(WEB_WORKER_THREADS, ALL_SHAPER_TYPES.length);
  const typeChunks = chunkRoundRobin(ALL_SHAPER_TYPES, workerCount);

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
    lastBestByTypeRef.current = {};
    seenHistoryKeysRef.current = new Set();

    const magnitudes = maxHoldSpectrum;

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
      let idx = 0;
      for (const worker of workersRef.current) {
        const candidateTypes = typeChunks[idx++];

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'progress': {
              perWorkerProgress.set(worker, msg);
              if (msg.bestByType) perWorkerBestByType.set(worker, msg.bestByType);
              setOptimiseProgress(computeAggregateProgress());
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
              workersRef.current.delete(worker);

              if (workersRef.current.size === 0) {
                let finalBest: OptimisationResult | { score: number } = {
                  score: Number.POSITIVE_INFINITY,
                };
                for (const [, bestByType] of perWorkerBestByType) {
                  for (const result of Object.values(bestByType)) {
                    if (result.score < finalBest.score) {
                      finalBest = result;
                    }
                  }
                }
                // Snap UI to the final best result after optimisation finishes.
                if ('params' in finalBest) setShaperParams(finalBest.params);
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
