import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { WEB_WORKER_THREADS } from '@/constants';
import type { InputShaperType } from './input-shaper';
import ShaperOptimiserWorker from './shaper-optimiser.worker?worker';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import type {
  BestByType,
  OptimisationResult,
  WorkerCorneringSettings,
  WorkerOutMessage,
  WorkerProgressMessage,
  WorkerRefineMessage,
  WorkerStartMessage,
} from './shaper-optimiser.worker';
import {
  shaperTypeAtom,
  shaperF0Atom,
  shaperZetaAtom,
  shaperVtolAtom,
  shaperScoreModeAtom,
  corneringModelAtom,
  corneringScvAtom,
  corneringJerkAtom,
  corneringJdAtom,
  analysisRangeAtom,
  optimisationHistoryAtom,
  type OptimisationHistoryEntry,
} from './atoms';

const ALL_SHAPER_TYPES: InputShaperType[] = [
  'zv',
  'zvd',
  'zvdd',
  'zvddd',
  'mzv',
  'ei',
  '2hei',
  '3hei',
];

const chunkRoundRobin = <T>(items: T[], chunks: number): T[][] => {
  const n = Math.max(1, Math.floor(chunks));
  const out: T[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < items.length; i++) out[i % n].push(items[i]);
  return out.filter((c) => c.length);
};

export default function useOptimisers() {
  const [type, setType] = useAtom(shaperTypeAtom);
  const [f0, setF0] = useAtom(shaperF0Atom);
  const [zeta, setZeta] = useAtom(shaperZetaAtom);
  const [vtol, setVtol] = useAtom(shaperVtolAtom);
  const scoreMode = useAtomValue(shaperScoreModeAtom);
  const corneringModel = useAtomValue(corneringModelAtom);
  const corneringScv = useAtomValue(corneringScvAtom);
  const corneringJerk = useAtomValue(corneringJerkAtom);
  const corneringJd = useAtomValue(corneringJdAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const scoreRangeHz = useAtomValue(analysisRangeAtom);

  const [isOptimising, setIsOptimising] = useState(false);
  const [optimiseProgress, setOptimiseProgress] = useState<WorkerProgressMessage | null>(null);
  const [bestByType, setBestByType] = useState<BestByType>({});
  const [, setOptimisationHistory] = useAtom(optimisationHistoryAtom);
  const [optimisePreviewMode, setOptimisePreviewMode] = useState<'best' | 'current'>('current');
  const optimisePreviewModeRef = useRef<'best' | 'current'>('best');
  const optimiserWorkersRef = useRef<Worker[]>([]);
  const cancelRef = useRef(false);
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
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  useEffect(() => {
    optimisePreviewModeRef.current = optimisePreviewMode;
  }, [optimisePreviewMode]);

  useEffect(() => {
    return () => {
      for (const w of optimiserWorkersRef.current) w.terminate();
      optimiserWorkersRef.current = [];
    };
  }, []);
  const corneringToWorker = (): WorkerCorneringSettings => {
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
    setIsOptimising(true);
    cancelRef.current = false;
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

    try {
      const perWorkerProgress = new Map<Worker, WorkerProgressMessage>();
      const perWorkerBestByType = new Map<Worker, BestByType>();

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
        let settled = false;
        const cleanups: Array<() => void> = [];

        let finalBest: OptimisationResult | undefined;

        const settle = () => {
          if (settled) return;
          settled = true;
          for (const c of cleanups) c();

          // Snap UI to the final best result after optimisation finishes.
          if (finalBest && !cancelRef.current) {
            setType(finalBest.params.type);
            setF0(finalBest.params.fHz);
            setZeta(finalBest.params.zeta);
            setVtol(finalBest.params.vtol);
          }
          resolve();
        };

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

                const previewParams =
                  optimisePreviewModeRef.current === 'current'
                    ? msg.current?.params
                    : aggregate?.best?.params;
                if (previewParams) {
                  setType(previewParams.type);
                  setF0(previewParams.fHz);
                  setZeta(previewParams.zeta);
                  setVtol(previewParams.vtol);
                }
                return;
              }

              case 'done': {
                doneCount++;
                if (msg.bestByType) perWorkerBestByType.set(worker, msg.bestByType);
                const merged = mergeBestByType();
                setBestByType(merged);
                recordBestByType(merged);
                if (msg.best && (!finalBest || msg.best.score < finalBest.score)) {
                  finalBest = msg.best;
                }
                if (doneCount >= workers.length) settle();
              }
            }
          };

          worker.addEventListener('message', handleMessage);
          cleanups.push(() => worker.removeEventListener('message', handleMessage));

          worker.postMessage({
            type: 'start',
            magnitudes,
            scoreRangeHz,
            uiUpdateEveryMs: 75,
            scoreMode,
            cornering: corneringToWorker(),
            candidateTypes,
          } satisfies WorkerStartMessage);
        }

        const cancelPoll = window.setInterval(() => {
          if (!cancelRef.current) return;
          // Cancelling should not send messages around; just kill worker threads.
          for (const w of workers) w.terminate();
          settle();
        }, 100);
        cleanups.push(() => window.clearInterval(cancelPoll));
      });

      await new Promise((r) => setTimeout(r, 0));
      await completion;
    } finally {
      for (const w of workers) w.terminate();
      if (optimiserWorkersRef.current === workers) optimiserWorkersRef.current = [];
      setIsOptimising(false);
      setOptimiseProgress(null);
    }
  };

  const runCoarseTuneSelected = async () => {
    if (!maxHoldSpectrum.length) return;
    setIsOptimising(true);
    cancelRef.current = false;
    setOptimisationHistory([]);
    lastBestByTypeRef.current = {};
    seenHistoryKeysRef.current = new Set();

    const magnitudes = maxHoldSpectrum;

    for (const w of optimiserWorkersRef.current) w.terminate();
    optimiserWorkersRef.current = [];

    const worker = new ShaperOptimiserWorker();
    optimiserWorkersRef.current = [worker];

    try {
      let cleanup: (() => void) | undefined;

      const completion = new Promise<void>((resolve) => {
        let settled = false;

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'progress': {
              setOptimiseProgress(msg);
              if (msg.bestByType) {
                setBestByType(msg.bestByType);
                recordBestByType(msg.bestByType);
              }

              const previewParams =
                optimisePreviewModeRef.current === 'current'
                  ? msg.current?.params
                  : msg.best?.params;
              if (previewParams) {
                setType(previewParams.type);
                setF0(previewParams.fHz);
                setZeta(previewParams.zeta);
                setVtol(previewParams.vtol);
              }
              return;
            }

            case 'done': {
              if (msg.best) {
                setType(msg.best.params.type);
                setF0(msg.best.params.fHz);
                setZeta(msg.best.params.zeta);
                setVtol(msg.best.params.vtol);
              }
              if (msg.bestByType) {
                const merged = { ...bestByType, ...msg.bestByType };
                setBestByType(merged);
                recordBestByType(merged);
              }
              if (settled) return;
              settled = true;
              cleanup?.();
              resolve();
            }
          }
        };

        worker.addEventListener('message', handleMessage);
        worker.postMessage({
          type: 'start',
          magnitudes,
          scoreRangeHz,
          uiUpdateEveryMs: 75,
          scoreMode,
          cornering: corneringToWorker(),
          candidateTypes: [type],
          skipFine: true,
        } satisfies WorkerStartMessage);

        const cancelPoll = window.setInterval(() => {
          if (!cancelRef.current) return;
          if (settled) return;
          settled = true;
          worker.terminate();
          cleanup?.();
          resolve();
        }, 100);

        cleanup = () => {
          window.clearInterval(cancelPoll);
          worker.removeEventListener('message', handleMessage);
        };
      });

      await new Promise((r) => setTimeout(r, 0));
      await completion;
    } finally {
      worker.terminate();
      if (optimiserWorkersRef.current[0] === worker) optimiserWorkersRef.current = [];
      setIsOptimising(false);
      setOptimiseProgress(null);
    }
  };

  const runRefineCurrent = async () => {
    if (!maxHoldSpectrum.length) return;
    setIsOptimising(true);
    cancelRef.current = false;
    setOptimisationHistory([]);
    lastBestByTypeRef.current = {};
    seenHistoryKeysRef.current = new Set();

    const magnitudes = maxHoldSpectrum;

    for (const w of optimiserWorkersRef.current) w.terminate();
    optimiserWorkersRef.current = [];

    const worker = new ShaperOptimiserWorker();
    optimiserWorkersRef.current = [worker];

    try {
      let cleanup: (() => void) | undefined;

      const completion = new Promise<void>((resolve) => {
        let settled = false;

        const handleMessage = (evt: MessageEvent<WorkerOutMessage>) => {
          const msg = evt.data;
          switch (msg.type) {
            case 'progress': {
              setOptimiseProgress(msg);
              if (msg.bestByType) {
                setBestByType(msg.bestByType);
                recordBestByType(msg.bestByType);
              }

              const previewParams =
                optimisePreviewModeRef.current === 'current'
                  ? msg.current?.params
                  : msg.best?.params;
              if (previewParams) {
                setType(previewParams.type);
                setF0(previewParams.fHz);
                setZeta(previewParams.zeta);
                setVtol(previewParams.vtol);
              }
              return;
            }

            case 'done': {
              if (msg.best) {
                setType(msg.best.params.type);
                setF0(msg.best.params.fHz);
                setZeta(msg.best.params.zeta);
                setVtol(msg.best.params.vtol);
              }
              if (msg.bestByType) {
                const merged = { ...bestByType, ...msg.bestByType };
                setBestByType(merged);
                recordBestByType(merged);
              }
              if (settled) return;
              settled = true;
              cleanup?.();
              resolve();
            }
          }
        };

        worker.addEventListener('message', handleMessage);
        worker.postMessage({
          type: 'refine',
          magnitudes,
          scoreRangeHz,
          uiUpdateEveryMs: 50,
          scoreMode,
          cornering: corneringToWorker(),
          startParams: { type, fHz: f0, zeta, vtol },
        } satisfies WorkerRefineMessage);

        const cancelPoll = window.setInterval(() => {
          if (!cancelRef.current) return;
          if (settled) return;
          settled = true;
          worker.terminate();
          cleanup?.();
          resolve();
        }, 100);

        cleanup = () => {
          window.clearInterval(cancelPoll);
          worker.removeEventListener('message', handleMessage);
        };
      });

      await new Promise((r) => setTimeout(r, 0));
      await completion;
    } finally {
      worker.terminate();
      if (optimiserWorkersRef.current[0] === worker) optimiserWorkersRef.current = [];
      setIsOptimising(false);
      setOptimiseProgress(null);
    }
  };
  return {
    runAutoOptimise,
    runCoarseTuneSelected,
    runRefineCurrent,
    isOptimising,
    optimiseProgress,
    bestByType,
    optimisePreviewMode,
    setOptimisePreviewMode,
  };
}
