import { useEffect, useRef, useState } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import {
  FIXED_SAMPLE_RATE,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
  WEB_WORKER_THREADS,
} from '@/constants';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ExplainTooltip } from '@/components/ExplainTooltip';
import { cn } from '@/lib/utils';
import {
  applyShaperToMagnitudeSpectrum,
  computeMarlinShaperTaps,
  flatnessScoreFromMagnitudeSpectrum,
  klipperScoreFromMagnitudeSpectrum,
  klipperSuggestedMaxAccel,
  type InputShaperType,
  type ShaperParams,
  type ShaperScoreMode,
} from './input-shaper';
import ShaperOptimiserWorker from './shaper-optimiser.worker?worker';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';

type OptimisationResult = { params: ShaperParams; score: number };
type BestByType = Partial<Record<InputShaperType, OptimisationResult>>;

type OptimiserWorkerProgress = {
  type: 'progress';
  percent: number;
  iterationsDone: number;
  iterationsTotal: number;
  current?: OptimisationResult;
  best?: OptimisationResult;
  bestByType?: BestByType;
};

type OptimiserWorkerDone = { type: 'done'; best?: OptimisationResult; bestByType?: BestByType };
type OptimiserWorkerError = { type: 'error'; message: string };

type OptimiserWorkerOut = OptimiserWorkerProgress | OptimiserWorkerDone | OptimiserWorkerError;

type OptimisationProgress = {
  percent: number;
  iterationsDone: number;
  iterationsTotal: number;
  current?: OptimisationResult;
  best?: OptimisationResult;
};

const binToHz = (bin: number, bins: number) => bin * (FIXED_SAMPLE_RATE / (2 * (bins - 1)));

const estimatePeakHz = (magnitudes: number[]) => {
  if (!magnitudes.length) return 55;
  let peakIdx = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    if ((magnitudes[i] ?? 0) > (magnitudes[peakIdx] ?? 0)) peakIdx = i;
  }
  return binToHz(peakIdx, magnitudes.length);
};

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

const chunkRoundRobin = <T,>(items: T[], chunks: number): T[][] => {
  const n = Math.max(1, Math.floor(chunks));
  const out: T[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < items.length; i++) out[i % n]!.push(items[i]!);
  return out.filter((c) => c.length);
};

const shaperTypeAtom = atom<InputShaperType>('zvd');
const shaperF0Atom = atom(55);
const shaperZetaAtom = atom(0.1);
const shaperVtolAtom = atom(0.1);
const shaperScoreModeAtom = atom<ShaperScoreMode>('klipper');

const shaperParamsAtom = atom<ShaperParams>((get) => ({
  type: get(shaperTypeAtom),
  fHz: get(shaperF0Atom),
  zeta: get(shaperZetaAtom),
  vtol: get(shaperVtolAtom),
}));

const shapedSpectrumAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base?.length) return [];
  return applyShaperToMagnitudeSpectrum(get(shaperParamsAtom), base);
});

const currentScoreAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base?.length) return undefined;
  const scoreMode = get(shaperScoreModeAtom);
  const params = get(shaperParamsAtom);
  const score =
    scoreMode === 'flatness'
      ? flatnessScoreFromMagnitudeSpectrum(base, params)
      : klipperScoreFromMagnitudeSpectrum(base, params);
  return Number.isFinite(score) ? score : undefined;
});

const currentMaxAccelAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base?.length) return undefined;
  const maxAccel = klipperSuggestedMaxAccel(get(shaperParamsAtom), 5, 0.12);
  return Number.isFinite(maxAccel) ? maxAccel : undefined;
});

const delayCentroidSecondsAtom = atom((get) => {
  const { a, t } = computeMarlinShaperTaps(get(shaperParamsAtom));
  const sumA = a.reduce((s, v) => s + v, 0);
  if (!Number.isFinite(sumA) || sumA === 0) return undefined;
  let centroid = 0;
  for (let i = 0; i < a.length; i++) centroid += (a[i] ?? 0) * (t[i] ?? 0);
  centroid /= sumA;
  return Number.isFinite(centroid) ? centroid : undefined;
});

export default function ShaperScreen() {
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const [type, setType] = useAtom(shaperTypeAtom);
  const [f0, setF0] = useAtom(shaperF0Atom);
  const [zeta, setZeta] = useAtom(shaperZetaAtom);
  const [vtol, setVtol] = useAtom(shaperVtolAtom);
  const [scoreMode, setScoreMode] = useAtom(shaperScoreModeAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);
  const delayCentroidSeconds = useAtomValue(delayCentroidSecondsAtom);

  const [isOptimising, setIsOptimising] = useState(false);
  const [optimiseProgress, setOptimiseProgress] = useState<OptimisationProgress | null>(null);
  const [bestByType, setBestByType] = useState<BestByType>({});
  const [optimisePreviewMode, setOptimisePreviewMode] = useState<'best' | 'current'>('best');
  const optimisePreviewModeRef = useRef<'best' | 'current'>('best');
  const optimiserWorkersRef = useRef<Worker[]>([]);
  const cancelRef = useRef(false);

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

  const runAutoOptimise = async () => {
    if (!maxHoldSpectrum.length) return;
    setIsOptimising(true);
    cancelRef.current = false;

    const magnitudes = maxHoldSpectrum;
    const peakHz = estimatePeakHz(magnitudes);

    for (const w of optimiserWorkersRef.current) w.terminate();
    optimiserWorkersRef.current = [];

    const workerCount = Math.max(1, Math.min(WEB_WORKER_THREADS, ALL_SHAPER_TYPES.length));
    const typeChunks = chunkRoundRobin(ALL_SHAPER_TYPES, workerCount);
    const workers = typeChunks.map(() => new ShaperOptimiserWorker());
    optimiserWorkersRef.current = workers;

    try {
      const perWorkerProgress = new Map<Worker, OptimiserWorkerProgress>();
      const perWorkerBestByType = new Map<Worker, BestByType>();

      const computeAggregateProgress = (): OptimisationProgress | null => {
        if (!perWorkerProgress.size) return null;
        let iterationsDone = 0;
        let iterationsTotal = 0;
        let best: OptimisationResult | undefined;
        let current: OptimisationResult | undefined;

        for (const p of perWorkerProgress.values()) {
          iterationsDone += p.iterationsDone;
          iterationsTotal += p.iterationsTotal;
          if (p.best && (!best || p.best.score < best.score)) best = p.best;
        }

        // "current" is inherently ambiguous across workers; take the most recent sender's current.
        const last = Array.from(perWorkerProgress.values()).at(-1);
        current = last?.current;

        const percent = iterationsTotal ? (100 * iterationsDone) / iterationsTotal : 0;
        return { percent, iterationsDone, iterationsTotal, current, best };
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
          const worker = workers[idx]!;
          const candidateTypes = typeChunks[idx]!;

          const handleMessage = (evt: MessageEvent<OptimiserWorkerOut>) => {
            const msg = evt.data;
            if (msg.type === 'progress') {
              perWorkerProgress.set(worker, msg);
              if (msg.bestByType) perWorkerBestByType.set(worker, msg.bestByType);

              const aggregate = computeAggregateProgress();
              if (aggregate) setOptimiseProgress(aggregate);
              setBestByType(mergeBestByType());

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

            if (msg.type === 'error') {
              // eslint-disable-next-line no-console
              console.error('[shaper-optimiser.worker] error:', msg.message);
              settle();
              return;
            }

            if (msg.type === 'done') {
              doneCount++;
              if (msg.bestByType) perWorkerBestByType.set(worker, msg.bestByType);
              setBestByType(mergeBestByType());
              if (msg.best && (!finalBest || msg.best.score < finalBest.score)) {
                finalBest = msg.best;
              }
              if (doneCount >= workers.length) settle();
            }
          };

          worker.addEventListener('message', handleMessage);
          cleanups.push(() => worker.removeEventListener('message', handleMessage));

          worker.postMessage({
            type: 'start',
            magnitudes,
            peakHz,
            uiUpdateEveryMs: 75,
            scoreMode,
            candidateTypes,
          });
        }

        const cancelPoll = window.setInterval(() => {
          if (!cancelRef.current) return;
          for (const w of workers) w.postMessage({ type: 'cancel' });
          window.clearInterval(cancelPoll);
        }, 100);
        cleanups.push(() => window.clearInterval(cancelPoll));
      });

      await new Promise((r) => setTimeout(r, 0));
      await completion;
    } finally {
      if (cancelRef.current) {
        for (const w of workers) w.postMessage({ type: 'cancel' });
      }
      for (const w of workers) w.terminate();
      if (optimiserWorkersRef.current === workers) optimiserWorkersRef.current = [];
      setIsOptimising(false);
      setOptimiseProgress(null);
    }
  };

  const runRefineCurrent = async () => {
    if (!maxHoldSpectrum.length) return;
    setIsOptimising(true);
    cancelRef.current = false;

    const magnitudes = maxHoldSpectrum;
    const peakHz = estimatePeakHz(magnitudes);

    for (const w of optimiserWorkersRef.current) w.terminate();
    optimiserWorkersRef.current = [];

    const worker = new ShaperOptimiserWorker();
    optimiserWorkersRef.current = [worker];

    try {
      let cleanup: (() => void) | undefined;

      const completion = new Promise<void>((resolve) => {
        const handleMessage = (evt: MessageEvent<OptimiserWorkerOut>) => {
          const msg = evt.data;
          if (msg.type === 'progress') {
            setOptimiseProgress(msg);
            if (msg.bestByType) setBestByType(msg.bestByType);

            const previewParams =
              optimisePreviewModeRef.current === 'current' ? msg.current?.params : msg.best?.params;
            if (previewParams) {
              setType(previewParams.type);
              setF0(previewParams.fHz);
              setZeta(previewParams.zeta);
              setVtol(previewParams.vtol);
            }
            return;
          }

          if (msg.type === 'error') {
            // eslint-disable-next-line no-console
            console.error('[shaper-optimiser.worker] error:', msg.message);
            cleanup?.();
            resolve();
            return;
          }

          if (msg.type === 'done') {
            if (msg.best) {
              setType(msg.best.params.type);
              setF0(msg.best.params.fHz);
              setZeta(msg.best.params.zeta);
              setVtol(msg.best.params.vtol);
            }
            if (msg.bestByType) setBestByType(msg.bestByType);
            cleanup?.();
            resolve();
          }
        };

        worker.addEventListener('message', handleMessage);
        worker.postMessage({
          type: 'refine',
          magnitudes,
          peakHz,
          uiUpdateEveryMs: 75,
          scoreMode,
          startParams: { type, fHz: f0, zeta, vtol },
        });

        const cancelPoll = window.setInterval(() => {
          if (!cancelRef.current) return;
          worker.postMessage({ type: 'cancel' });
          window.clearInterval(cancelPoll);
        }, 100);

        cleanup = () => {
          window.clearInterval(cancelPoll);
          worker.removeEventListener('message', handleMessage);
        };
      });

      await new Promise((r) => setTimeout(r, 0));
      await completion;
    } finally {
      cancelRef.current && worker.postMessage({ type: 'cancel' });
      worker.terminate();
      if (optimiserWorkersRef.current[0] === worker) optimiserWorkersRef.current = [];
      setIsOptimising(false);
      setOptimiseProgress(null);
    }
  };

  const scoreTooltip = (
    <>
      One number that trades off <i>ringing left</i> vs <i>motion blur</i>. <b>Lower is better.</b>
      <div className="mt-2 font-mono">score = smoothing × (vibrs^1.5 + vibrs×0.2 + 0.01)</div>
      <div className="mt-2">
        <b>vibrs</b>
        <div className="mt-1">
          remaining/total vibration (after ignoring PSD below{' '}
          <span className="font-mono">max(PSD)/20</span>), worst-case over damping ratios{' '}
          <span className="font-mono">[0.075, 0.1, 0.15]</span>.
        </div>
      </div>
      <div className="mt-2">
        <b>smoothing</b>
        <div className="mt-1">
          time-spread from the shaper taps using Klipper’s cornering model (
          <span className="font-mono">accel=5000</span>, <span className="font-mono">scv=5</span>).
          Bigger smoothing rounds corners more.
        </div>
      </div>
    </>
  );

  const flatnessScoreTooltip = (
    <>
      Measures how “flat” the <b>shaped</b> spectrum is (lower is better).
      <div className="text-muted-foreground mt-2">
        Computed as normalized squared error from the mean over 0–200 Hz.
      </div>
    </>
  );

  const scoreModeTooltip = {
    title: 'Score mode',
    accurate: (
      <>
        Choose what <b>Auto optimise</b> tries to minimize.
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>Klipper</b>: tradeoff between remaining vibration and smoothing (good general
            default).
          </li>
          <li>
            <b>Flatness</b>: minimize variation from a horizontal line in the shaped spectrum.
          </li>
        </ul>
      </>
    ),
    intuition: (
      <>
        Use <b>Flatness</b> when you want the shaper to “even out” the spectrum; use <b>Klipper</b>{' '}
        when you want a more standard ringing-vs-smoothing compromise.
      </>
    ),
  };

  const maxAccelAccurate = (
    <>
      A projection of the highest acceleration where Klipper’s smoothing model stays under a fixed
      threshold: <code className="font-mono">smoothing(taps, accel, scv=5) ≤ 0.12</code>. It’s found
      via bisection search.
      <div className="mt-2">
        <h4 className="text-sm font-semibold">SCV</h4>
        <div className="mt-1">
          <code className="font-mono">scv</code> (square corner velocity) is the speed the planner
          tries to maintain through sharp corners. Higher <code className="font-mono">scv</code>{' '}
          means less slowing down at corners → the model predicts more smoothing.
        </div>
      </div>
    </>
  );

  const shaperFamily = {
    title: 'Shaper type',
    accurate: (
      <>
        Selects the input shaper impulse train (tap pattern). More taps generally reduce ringing
        more broadly, but increase smoothing and can require lower accel.
      </>
    ),
    intuition: (
      <>
        It’s like choosing a “filter”: stronger filters can quiet more vibration, but they smear the
        command more.
      </>
    ),
  };

  const shaperTypeButton = {
    title: 'Shaper type',
    accurate: (
      <>
        Selects the impulse pattern (tap weights and spacing) used to cancel ringing near{' '}
        <code className="font-mono">f0</code>.
      </>
    ),
    intuition: (
      <>
        More aggressive shapers usually reduce ringing more, but increase time-spread (more corner
        rounding / lower usable accel).
      </>
    ),
  };

  const autoOptimise = {
    title: 'Auto optimise',
    accurate: (
      <>
        Brute-force searches shaper type + frequency + damping (+ tolerance for EI/HEI) to minimize
        the score, using your Measure <b>max-hold</b> spectrum as input.
      </>
    ),
    intuition: <>It also runs a gradient refinment at the end.</>,
  };

  const refineCurrent = {
    title: 'Refine current',
    accurate: (
      <>
        Runs a local gradient-based refinement starting from the current shaper settings, to try to
        reduce the selected score mode.
      </>
    ),
    intuition: <>Use this when you’re already close and want a last small improvement.</>,
  };

  const scoreModeKlipper = {
    title: 'Klipper score mode',
    accurate: (
      <>
        Minimizes a Klipper-like tradeoff between remaining vibration and smoothing (corner
        rounding). Lower is better.
      </>
    ),
    intuition: <>Good default for general “less ringing without too much blur”.</>,
  };

  const scoreModeFlatness = {
    title: 'Flatness score mode',
    accurate: (
      <>
        Minimizes how much the <b>shaped</b> spectrum varies from a flat line over 0–200 Hz. Lower
        is better.
      </>
    ),
    intuition: (
      <>
        Use this when you want the least ringing at the cost of lower acceleration (or slightly more
        corner rounding).
      </>
    ),
  };

  const previewMode = {
    title: 'Preview',
    accurate: (
      <>
        During optimisation, chooses whether the UI controls reflect the current candidate or the
        best-so-far candidate.
      </>
    ),
    intuition: (
      <>
        <b>Current</b> lets you watch the search explore; <b>Best</b> keeps the UI stable on the
        best result found so far.
      </>
    ),
  };

  const f0Info = {
    title: 'Resonance f0',
    accurate: (
      <>
        Center frequency (Hz) the shaper is tuned for. It controls the tap spacing so the shaper
        cancels motion near that resonance frequency.
      </>
    ),
    intuition: (
      <>
        Aim this near your main peak. Too low/high and the shaper misses the ringing you’re trying
        to cancel.
      </>
    ),
  };

  const zetaInfo = {
    title: 'Damping (ζ)',
    accurate: (
      <>
        Assumed damping ratio of the resonance used to compute the tap weights. Higher ζ means the
        resonance dies out faster.
      </>
    ),
    intuition: (
      <>
        If the system is more “bouncy” (rings longer), use a smaller ζ; if it settles quickly, a
        larger ζ can work.
      </>
    ),
  };

  const vtolInfo = {
    title: 'Tolerance (vtol)',
    accurate: (
      <>
        Only used by EI/HEI shapers. It widens how forgiving the shaper is to frequency mismatch by
        trading extra smoothing for robustness.
      </>
    ),
    intuition: (
      <>
        If your resonance shifts with temperature or belt tension, higher vtol can keep prints
        consistent (but may blur a bit more).
      </>
    ),
  };

  const taps = computeMarlinShaperTaps({ type, fHz: f0, zeta, vtol });
  const tapCoefficientsText = taps.a.map((v) => v.toFixed(6)).join(', ');
  const tapTimingsMsText = taps.t.map((t) => (t * 1000).toFixed(2)).join(', ');
  const tapPhasePercent = taps.t.map((t) => t * f0 * 100);
  const tapPhaseText = tapPhasePercent.map((v) => v.toFixed(1)).join(', ');

  const delayCentroidTooltip = (
    <div className="max-w-90 leading-snug">
      <h3 className="text-sm font-semibold">Delay centroid</h3>
      <div className="mt-2">
        A rough “center of mass” of the shaper taps in time:{' '}
        <span className="font-mono">Σ(aᵢ·tᵢ) / Σ(aᵢ)</span>.
      </div>
      <div className="text-muted-foreground mt-2">
        This matters because a shaper spreads a single motion command over time. At a 90° corner
        (finish X, then start Y), the delayed tail of X can overlap with the start of Y. That
        overlap is one reason corners look rounded: you’re effectively moving in X and Y at the same
        time for a short moment.
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-7.5rem)] md:w-80 md:overflow-auto">
        <div className="text-left">
          <h3 className="text-lg font-semibold">Input Shaper Simulator</h3>
          <div className="text-muted-foreground text-sm">Works from Measure max-hold data.</div>
        </div>

        <div className="mt-5">
          <ExplainTooltip
            title={shaperFamily.title}
            accurate={shaperFamily.accurate}
            intuition={shaperFamily.intuition}
          >
            <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Shaper
            </div>
          </ExplainTooltip>
          <div className="border-border mt-2 grid w-full grid-cols-4 gap-1 rounded-md border p-1">
            {(
              [
                { value: 'zv', label: 'ZV' },
                { value: 'zvd', label: 'ZVD' },
                { value: 'zvdd', label: 'ZVDD' },
                { value: 'zvddd', label: 'ZVDDD' },
                { value: 'mzv', label: 'MZV' },
                { value: 'ei', label: 'EI' },
                { value: '2hei', label: '2HEI' },
                { value: '3hei', label: '3HEI' },
              ] as const
            ).map((opt) => (
              <ExplainTooltip
                key={opt.value}
                title={shaperTypeButton.title}
                accurate={shaperTypeButton.accurate}
                intuition={shaperTypeButton.intuition}
              >
                <Button
                  type="button"
                  size="sm"
                  variant={type === opt.value ? 'secondary' : 'ghost'}
                  className="h-8 w-full"
                  aria-pressed={type === opt.value}
                  onClick={() => {
                    setType(opt.value);
                    const best = bestByType[opt.value];
                    if (best) {
                      setF0(best.params.fHz);
                      setZeta(best.params.zeta);
                      setVtol(best.params.vtol);
                    }
                  }}
                >
                  {opt.label}
                </Button>
              </ExplainTooltip>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2">
            <ExplainTooltip
              title={scoreModeTooltip.title}
              accurate={scoreModeTooltip.accurate}
              intuition={scoreModeTooltip.intuition}
              side="right"
              sideOffset={8}
            >
              <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Score mode
              </div>
            </ExplainTooltip>
          </div>
          <div className="border-border grid w-full grid-cols-2 gap-1 rounded-md border p-1">
            <ExplainTooltip
              title={scoreModeKlipper.title}
              accurate={scoreModeKlipper.accurate}
              intuition={scoreModeKlipper.intuition}
            >
              <Button
                type="button"
                size="sm"
                variant={scoreMode === 'klipper' ? 'secondary' : 'ghost'}
                className="h-8 w-full"
                aria-pressed={scoreMode === 'klipper'}
                onClick={() => setScoreMode('klipper')}
              >
                Klipper
              </Button>
            </ExplainTooltip>
            <ExplainTooltip
              title={scoreModeFlatness.title}
              accurate={scoreModeFlatness.accurate}
              intuition={scoreModeFlatness.intuition}
            >
              <Button
                type="button"
                size="sm"
                variant={scoreMode === 'flatness' ? 'secondary' : 'ghost'}
                className="h-8 w-full"
                aria-pressed={scoreMode === 'flatness'}
                onClick={() => setScoreMode('flatness')}
              >
                Flatness
              </Button>
            </ExplainTooltip>
          </div>
        </div>

        <div className="mt-5">
          <ExplainTooltip
            title={autoOptimise.title}
            accurate={autoOptimise.accurate}
            intuition={autoOptimise.intuition}
          >
            <Button
              type="button"
              className="w-full"
              onClick={() => void runAutoOptimise()}
              disabled={!maxHoldSpectrum.length || isOptimising}
            >
              {isOptimising ? 'Optimising…' : 'Auto optimise'}
            </Button>
          </ExplainTooltip>
          <ExplainTooltip
            title={refineCurrent.title}
            accurate={refineCurrent.accurate}
            intuition={refineCurrent.intuition}
          >
            <Button
              type="button"
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => void runRefineCurrent()}
              disabled={!maxHoldSpectrum.length || isOptimising}
            >
              {isOptimising ? 'Refining…' : 'Refine current'}
            </Button>
          </ExplainTooltip>
          {!isOptimising && (
            <div className="text-muted-foreground mt-2 text-xs">
              Current score:{' '}
              <ExplainTooltip
                title="Score"
                accurate={scoreMode === 'flatness' ? flatnessScoreTooltip : scoreTooltip}
                intuition={<>Used by the optimiser and for quick comparisons.</>}
              >
                <span className="font-medium underline decoration-dotted underline-offset-2">
                  {currentScore != null ? currentScore.toFixed(9) : '—'}
                </span>
              </ExplainTooltip>
            </div>
          )}
          {!isOptimising && (
            <div className="text-muted-foreground mt-1 text-xs">
              Suggested max accel:{' '}
              <ExplainTooltip
                title="Suggested max accel"
                accurate={maxAccelAccurate}
                intuition={
                  <>
                    If you push accel above this, the shaper tends to “round off” corners more (it’s
                    trading sharpness for reduced ringing).
                  </>
                }
              >
                <span className="font-medium underline decoration-dotted underline-offset-2">
                  {currentMaxAccel != null ? Math.round(currentMaxAccel / 100) * 100 : '—'}
                </span>
              </ExplainTooltip>{' '}
              mm/s²
            </div>
          )}
          {optimiseProgress && (
            <div className="mt-3 rounded-md border border-dashed p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <ExplainTooltip
                  title={previewMode.title}
                  accurate={previewMode.accurate}
                  intuition={previewMode.intuition}
                >
                  <div className="text-muted-foreground text-xs underline decoration-dotted underline-offset-2">
                    Preview
                  </div>
                </ExplainTooltip>
                <div className="border-border inline-flex gap-1 rounded-md border p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={optimisePreviewMode === 'best' ? 'secondary' : 'ghost'}
                    className="h-7 px-2"
                    aria-pressed={optimisePreviewMode === 'best'}
                    onClick={() => setOptimisePreviewMode('best')}
                  >
                    Best
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={optimisePreviewMode === 'current' ? 'secondary' : 'ghost'}
                    className="h-7 px-2"
                    aria-pressed={optimisePreviewMode === 'current'}
                    onClick={() => setOptimisePreviewMode('current')}
                  >
                    Current
                  </Button>
                </div>
              </div>
              <div className="text-muted-foreground text-xs">
                {optimiseProgress.percent.toFixed(0)}% ({optimiseProgress.iterationsDone}/
                {optimiseProgress.iterationsTotal})
              </div>
              <div className="bg-muted mt-2 h-2 w-full rounded">
                <div
                  className="bg-primary h-2 rounded"
                  style={{ width: `${Math.max(0, Math.min(100, optimiseProgress.percent))}%` }}
                />
              </div>
              <div className="text-muted-foreground mt-2 text-xs">
                Current score:{' '}
                <ExplainTooltip
                  title="Score"
                  accurate={scoreMode === 'flatness' ? flatnessScoreTooltip : scoreTooltip}
                  intuition={
                    <>Shows the optimiser’s current candidate for the selected score mode.</>
                  }
                >
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {optimiseProgress.current ? optimiseProgress.current.score.toFixed(9) : '—'}
                  </span>
                </ExplainTooltip>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                Best score:{' '}
                <ExplainTooltip
                  title="Score"
                  accurate={scoreMode === 'flatness' ? flatnessScoreTooltip : scoreTooltip}
                  intuition={<>Best score found so far for the selected score mode.</>}
                >
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {optimiseProgress.best ? optimiseProgress.best.score.toFixed(9) : '—'}
                  </span>
                </ExplainTooltip>
              </div>
            </div>
          )}
          {!maxHoldSpectrum.length && (
            <div className="text-muted-foreground mt-2 text-xs">
              Collect max-hold data in Measure first.
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-4">
          <div>
            <ExplainTooltip
              title={f0Info.title}
              accurate={f0Info.accurate}
              intuition={f0Info.intuition}
            >
              <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Resonance f0: {f0.toFixed(1)} Hz
              </label>
            </ExplainTooltip>
            <div className="mt-3">
              <Slider
                min={10}
                max={200}
                step={0.5}
                value={[f0]}
                onValueChange={(v) => setF0(v[0] ?? 55)}
                className="w-full"
              />
            </div>
          </div>

          <div>
            <ExplainTooltip
              title={zetaInfo.title}
              accurate={zetaInfo.accurate}
              intuition={zetaInfo.intuition}
            >
              <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Damping (ζ): {zeta.toFixed(3)}
              </label>
            </ExplainTooltip>
            <div className="mt-3">
              <Slider
                min={0}
                max={0.4}
                step={0.005}
                value={[zeta]}
                onValueChange={(v) => setZeta(v[0] ?? 0.1)}
                className="w-full"
              />
            </div>
          </div>

          <div
            className={cn(
              type === 'zv' ||
                type === 'zvd' ||
                type === 'zvdd' ||
                type === 'zvddd' ||
                type === 'mzv'
                ? 'opacity-60'
                : ''
            )}
          >
            <ExplainTooltip
              title={vtolInfo.title}
              accurate={vtolInfo.accurate}
              intuition={vtolInfo.intuition}
            >
              <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Tolerance (vtol): {vtol.toFixed(3)}
              </label>
            </ExplainTooltip>
            <div className="mt-3">
              <Slider
                min={0}
                max={0.5}
                step={0.005}
                value={[vtol]}
                onValueChange={(v) => setVtol(v[0] ?? 0.1)}
                className="w-full"
                disabled={
                  type === 'zv' ||
                  type === 'zvd' ||
                  type === 'zvdd' ||
                  type === 'zvddd' ||
                  type === 'mzv'
                }
              />
            </div>
          </div>
        </div>

        <div className="text-muted-foreground mt-6 text-xs leading-relaxed">
          Uses Marlin FT_MOTION coefficients. Shaped plots apply |H(f)| to magnitude.
        </div>

        <div className="border-border mt-4 rounded-lg border p-3">
          <div className="text-muted-foreground text-sm">Taps</div>
          <div className="mt-2 text-xs">
            Shaper: <span className="font-mono">{type.toUpperCase()}</span>
          </div>
          <div className="mt-1 text-xs">
            Count: <span className="font-mono">{taps.t.length}</span>
          </div>
          <div className="mt-1 text-xs">
            Coefficients (<span className="font-mono">a</span>):{' '}
            <span className="font-mono">[{tapCoefficientsText}]</span>
          </div>
          <div className="mt-1 text-xs">
            Timings (<span className="font-mono">t</span>, ms):{' '}
            <span className="font-mono">[{tapTimingsMsText}]</span>
          </div>
          <div className="mt-1 text-xs">
            Phases (% of one cycle at <span className="font-mono">f0</span>):{' '}
            <span className="font-mono">[{tapPhaseText}]</span>
          </div>
          <div className="text-muted-foreground mt-2 text-xs">
            Delay centroid:{' '}
            <ExplainTooltip title="Delay centroid" accurate={delayCentroidTooltip} intuition={null}>
              <span className="font-medium underline decoration-dotted underline-offset-2">
                {delayCentroidSeconds != null
                  ? `${(delayCentroidSeconds * 1000).toFixed(2)} ms`
                  : '—'}
              </span>
            </ExplainTooltip>
          </div>
          <div className="text-muted-foreground mt-2 text-xs">
            Phase = <span className="font-mono">t·f0</span>. Showing phases makes the tap pattern
            comparable across frequencies.
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="flex flex-col gap-6">
          <div>
            <h4 className="mb-2 font-semibold">Spectrum Max-Hold → Shaped</h4>
            <SpectrumPlot
              traces={[
                {
                  dataAtom: spectrogramMaxHoldAtom,
                  mode: 'line',
                  color: 'rgba(0, 220, 255, 0.55)',
                },
                {
                  dataAtom: shapedSpectrumAtom,
                  mode: 'line',
                  color: 'rgba(0, 255, 120, 0.9)',
                },
              ]}
              height={height}
              width={width}
              freqRange={[0, 200]}
              scaleMax={maxHoldSpectrum.length ? Math.max(...maxHoldSpectrum) : undefined}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
