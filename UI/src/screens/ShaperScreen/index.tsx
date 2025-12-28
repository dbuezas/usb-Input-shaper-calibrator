import { useEffect, useRef, useState } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import {
  FIXED_SAMPLE_RATE,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
} from '@/constants';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  applyShaperToMagnitudeSpectrum,
  applyShaperToWelchPsd,
  klipperScoreFromMagnitudeSpectrum,
  klipperSuggestedMaxAccel,
  type InputShaperType,
  type ShaperParams,
} from './input-shaper';
import ShaperOptimiserWorker from './shaper-optimiser.worker?worker';
import { spectrogramMaxHoldAtom, welchPsdMaxHoldAtom } from '../AnalyzerScreen/atoms';

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

const shaperTypeAtom = atom<InputShaperType>('zvd');
const shaperF0Atom = atom(55);
const shaperZetaAtom = atom(0.1);
const shaperVtolAtom = atom(0.1);

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

const shapedWelchAtom = atom((get) => {
  const base = get(welchPsdMaxHoldAtom);
  if (!base?.length) return [];
  return applyShaperToWelchPsd(get(shaperParamsAtom), base);
});

const currentScoreAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base?.length) return undefined;
  const score = klipperScoreFromMagnitudeSpectrum(base, get(shaperParamsAtom));
  return Number.isFinite(score) ? score : undefined;
});

const currentMaxAccelAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base?.length) return undefined;
  const maxAccel = klipperSuggestedMaxAccel(get(shaperParamsAtom), 5, 0.12);
  return Number.isFinite(maxAccel) ? maxAccel : undefined;
});

export default function ShaperScreen() {
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const [type, setType] = useAtom(shaperTypeAtom);
  const [f0, setF0] = useAtom(shaperF0Atom);
  const [zeta, setZeta] = useAtom(shaperZetaAtom);
  const [vtol, setVtol] = useAtom(shaperVtolAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const maxHoldWelch = useAtomValue(welchPsdMaxHoldAtom);
  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);

  const [isOptimising, setIsOptimising] = useState(false);
  const [optimiseProgress, setOptimiseProgress] = useState<OptimisationProgress | null>(null);
  const [bestByType, setBestByType] = useState<BestByType>({});
  const [optimisePreviewMode, setOptimisePreviewMode] = useState<'best' | 'current'>('best');
  const optimisePreviewModeRef = useRef<'best' | 'current'>('best');
  const optimiserWorkerRef = useRef<Worker | null>(null);
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
      optimiserWorkerRef.current?.terminate();
      optimiserWorkerRef.current = null;
    };
  }, []);

  const runAutoOptimise = async () => {
    if (!maxHoldSpectrum.length) return;
    setIsOptimising(true);
    cancelRef.current = false;

    const magnitudes = maxHoldSpectrum;
    const peakHz = estimatePeakHz(magnitudes);

    const types: InputShaperType[] = ['zv', 'zvd', 'zvdd', 'zvddd', 'mzv', 'ei', '2hei', '3hei'];
    const fStep = 0.2;
    const zetas = [0.03, 0.05, 0.07, 0.1, 0.14, 0.18, 0.22, 0.28, 0.34];
    const vtols = [0.02, 0.05, 0.08, 0.1, 0.14, 0.2, 0.28, 0.38];

    const fMin = Math.max(10, peakHz - 60);
    const fMax = Math.min(150, peakHz + 60);

    optimiserWorkerRef.current?.terminate();
    optimiserWorkerRef.current = new ShaperOptimiserWorker();

    const worker = optimiserWorkerRef.current;

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
          type: 'start',
          magnitudes,
          fMin,
          fMax,
          fStep,
          types,
          zetas,
          vtols,
          peakHz,
          uiUpdateEveryMs: 75,
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
      if (optimiserWorkerRef.current === worker) optimiserWorkerRef.current = null;
      setIsOptimising(false);
      setOptimiseProgress(null);
    }
  };

  const scoreTooltip = (
    <div className="max-w-[340px] leading-snug">
      <h3 className="text-sm font-semibold">Score</h3>
      <div className="mt-1">
        One number that trades off “ringing left” vs “motion blur”. Lower is better.
      </div>
      <div className="mt-2 font-mono">score = smoothing × (vibrs^1.5 + vibrs×0.2 + 0.01)</div>
      <div className="mt-2">
        <h4 className="text-sm font-semibold">vibrs</h4>
        <div className="mt-1">
          remaining/total vibration (after ignoring PSD below{' '}
          <span className="font-mono">max(PSD)/20</span>), worst-case over damping ratios{' '}
          <span className="font-mono">[0.075, 0.1, 0.15]</span>.
        </div>
      </div>
      <div className="mt-2">
        <h4 className="text-sm font-semibold">smoothing</h4>
        <div className="mt-1">
          time-spread from the shaper taps using Klipper’s cornering model (
          <span className="font-mono">accel=5000</span>, <span className="font-mono">scv=5</span>).
          Bigger smoothing rounds corners more.
        </div>
      </div>
    </div>
  );

  const maxAccelTooltip = (
    <div className="max-w-85 leading-snug">
      <h3 className="text-sm font-semibold">Suggested max accel</h3>
      <div className="mt-1">
        A projection of the highest acceleration where Klipper’s smoothing model stays under a fixed
        threshold.
      </div>
      <div className="mt-2">
        We search for the largest <span className="font-mono">accel</span> such that:
      </div>
      <div className="mt-1 font-mono">smoothing(taps, accel, scv=5) ≤ 0.12</div>
      <div className="mt-2">
        It’s found with a bisection search (same approach as Klipper). Higher than this and the
        model predicts noticeably more corner rounding.
      </div>
      <div className="mt-2">
        <h4 className="text-sm font-semibold">What is SCV?</h4>
        <div className="mt-1">
          <span className="font-mono">scv</span> is “square corner velocity” (mm/s): the speed that
          motion planning tries to maintain through sharp corners. Higher{' '}
          <span className="font-mono">scv</span> means less slowing at corners, which makes
          cornering more demanding and increases the smoothing predicted by the model.
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-7.5rem)] md:w-80 md:overflow-auto">
        <div className="text-left">
          <h3 className="text-lg font-semibold">Input Shaper Simulator</h3>
          <div className="text-muted-foreground text-sm">Works from Analyzer max-hold data.</div>
        </div>

        <div className="mt-5">
          <div className="text-muted-foreground text-sm">Shaper</div>
          <div className="border-border mt-2 inline-flex flex-wrap gap-1 rounded-md border p-1">
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
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={type === opt.value ? 'secondary' : 'ghost'}
                className="h-8"
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
            ))}
          </div>
        </div>

        <div className="mt-5">
          <Button
            type="button"
            className="w-full"
            onClick={() => void runAutoOptimise()}
            disabled={!maxHoldSpectrum.length || isOptimising}
          >
            {isOptimising ? 'Optimising…' : 'Auto optimise'}
          </Button>
          {!isOptimising && (
            <div className="text-muted-foreground mt-2 text-xs">
              Current score:{' '}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {currentScore != null ? currentScore.toFixed(9) : '—'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {scoreTooltip}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          {!isOptimising && (
            <div className="text-muted-foreground mt-1 text-xs">
              Suggested max accel:{' '}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {currentMaxAccel != null ? Math.round(currentMaxAccel / 100) * 100 : '—'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {maxAccelTooltip}
                </TooltipContent>
              </Tooltip>{' '}
              mm/s²
            </div>
          )}
          {optimiseProgress && (
            <div className="mt-3 rounded-md border border-dashed p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-muted-foreground text-xs">Preview</div>
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-medium underline decoration-dotted underline-offset-2">
                      {optimiseProgress.current ? optimiseProgress.current.score.toFixed(9) : '—'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    {scoreTooltip}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                Best score:{' '}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-medium underline decoration-dotted underline-offset-2">
                      {optimiseProgress.best ? optimiseProgress.best.score.toFixed(9) : '—'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    {scoreTooltip}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
          {!maxHoldSpectrum.length && (
            <div className="text-muted-foreground mt-2 text-xs">
              Collect max-hold data in Analyzer first.
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-4">
          <div>
            <label className="text-muted-foreground text-sm">Resonance f0: {f0} Hz</label>
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
            <label className="text-muted-foreground text-sm">Damping (ζ): {zeta.toFixed(3)}</label>
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
            <label className="text-muted-foreground text-sm">
              Tolerance (vtol): {vtol.toFixed(3)}
            </label>
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
          Uses Marlin FT_MOTION coefficients. Shaped plots apply |H(f)| to magnitude and |H(f)|² to
          Welch PSD.
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

          <div>
            <h4 className="mb-2 font-semibold">Welch PSD Max-Hold → Shaped</h4>
            <SpectrumPlot
              traces={[
                {
                  dataAtom: welchPsdMaxHoldAtom,
                  mode: 'line',
                  color: 'rgba(255, 80, 80, 0.75)',
                },
                {
                  dataAtom: shapedWelchAtom,
                  mode: 'line',
                  color: 'rgba(0, 255, 120, 0.9)',
                },
              ]}
              height={height}
              width={width}
              freqRange={[0, 200]}
              scaleMax={maxHoldWelch.length ? Math.max(...maxHoldWelch) : undefined}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
