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
import { ConfiguredTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  applyShaperToMagnitudeSpectrum,
  applyShaperToWelchPsd,
  computeMarlinShaperTaps,
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

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const maxHoldWelch = useAtomValue(welchPsdMaxHoldAtom);
  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);
  const delayCentroidSeconds = useAtomValue(delayCentroidSecondsAtom);

  const [isOptimising, setIsOptimising] = useState(false);
  const [optimiseProgress, setOptimiseProgress] = useState<OptimisationProgress | null>(null);
  const [bestByType, setBestByType] = useState<BestByType>({});
  const [optimisePreviewMode, setOptimisePreviewMode] = useState<'best' | 'current'>('best');
  const optimisePreviewModeRef = useRef<'best' | 'current'>('best');
  const optimiserWorkerRef = useRef<Worker | null>(null);
  const cancelRef = useRef(false);

  const explain = (title: string, accurate: string, intuition: string) => (
    <div className="max-w-[360px] leading-snug">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2">{accurate}</div>
      <div className="text-muted-foreground mt-2">{intuition}</div>
    </div>
  );

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
    <div className="max-w-[360px] leading-snug">
      {explain(
        'Suggested max accel',
        'A projection of the highest acceleration where Klipper’s smoothing model stays under a fixed threshold: smoothing(taps, accel, scv=5) ≤ 0.12. It’s found via bisection search.',
        'If you push accel above this, the shaper tends to “round off” corners more (it’s trading sharpness for reduced ringing).'
      )}
      <div className="mt-2">
        <h4 className="text-sm font-semibold">SCV</h4>
        <div className="mt-1">
          <span className="font-mono">scv</span> (square corner velocity) is the speed the planner
          tries to maintain through sharp corners. Higher <span className="font-mono">scv</span>{' '}
          means less slowing down at corners → the model predicts more smoothing.
        </div>
      </div>
    </div>
  );

  const shaperFamilyTooltip = explain(
    'Shaper type',
    'Selects the input shaper impulse train (tap pattern). More taps generally reduce ringing more broadly, but increase smoothing and can require lower accel.',
    'It’s like choosing a “filter”: stronger filters can quiet more vibration, but they smear the command more.'
  );

  const autoOptimiseTooltip = explain(
    'Auto optimise',
    'Brute-force searches shaper type + frequency + damping (+ tolerance for EI/HEI) to minimize the Klipper-like score, using your Analyzer max-hold spectrum as input.',
    'It tries lots of reasonable candidates and picks the one that best balances “quiet” vs “sharp”.'
  );

  const previewModeTooltip = explain(
    'Preview',
    'During optimisation, chooses whether the UI controls reflect the current candidate or the best-so-far candidate.',
    '“Current” lets you watch the search explore; “Best” keeps the UI stable on the best result found so far.'
  );

  const f0Tooltip = explain(
    'Resonance f0',
    'Center frequency (Hz) the shaper is tuned for. It controls the tap spacing so the shaper cancels motion near that resonance frequency.',
    'Aim this near your main peak. Too low/high and the shaper misses the ringing you’re trying to cancel.'
  );

  const zetaTooltip = explain(
    'Damping (ζ)',
    'Assumed damping ratio of the resonance used to compute the tap weights. Higher ζ means the resonance dies out faster.',
    'If the system is more “bouncy” (rings longer), use a smaller ζ; if it settles quickly, a larger ζ can work.'
  );

  const vtolTooltip = explain(
    'Tolerance (vtol)',
    'Only used by EI/HEI shapers. It widens how forgiving the shaper is to frequency mismatch by trading extra smoothing for robustness.',
    'If your resonance shifts with temperature or belt tension, higher vtol can keep prints consistent (but may blur a bit more).'
  );

  const shaperTapTooltip = (label: string, shaperType: InputShaperType) => {
    const taps = computeMarlinShaperTaps({ type: shaperType, fHz: f0, zeta, vtol });
    const phasePercent = taps.t.map((t) => t * f0 * 100);
    const phaseText = phasePercent.map((v) => v.toFixed(1)).join(', ');

    return (
      <div className="max-w-[360px] leading-snug">
        <h3 className="text-sm font-semibold">{label}</h3>
        <div className="mt-2">Tap count: {taps.t.length}</div>
        <div className="mt-2">
          Tap phases (% of a cycle): <span className="font-mono">[{phaseText}]</span>
        </div>
        <div className="text-muted-foreground mt-2">
          These are tap times expressed as a fraction of one period at{' '}
          <span className="font-mono">f0</span>, so you can compare shapes without thinking in
          milliseconds.
        </div>
      </div>
    );
  };

  const delayCentroidTooltip = (
    <div className="max-w-[360px] leading-snug">
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
          <div className="text-muted-foreground text-sm">Works from Analyzer max-hold data.</div>
        </div>

        <div className="mt-5">
          <ConfiguredTooltip>
            <TooltipTrigger asChild>
              <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Shaper
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {shaperFamilyTooltip}
            </TooltipContent>
          </ConfiguredTooltip>
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
              <ConfiguredTooltip key={opt.value}>
                <TooltipTrigger asChild>
                  <Button
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
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {shaperTapTooltip(opt.label, opt.value)}
                </TooltipContent>
              </ConfiguredTooltip>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <ConfiguredTooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                className="w-full"
                onClick={() => void runAutoOptimise()}
                disabled={!maxHoldSpectrum.length || isOptimising}
              >
                {isOptimising ? 'Optimising…' : 'Auto optimise'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {autoOptimiseTooltip}
            </TooltipContent>
          </ConfiguredTooltip>
          {!isOptimising && (
            <div className="text-muted-foreground mt-2 text-xs">
              Current score:{' '}
              <ConfiguredTooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {currentScore != null ? currentScore.toFixed(9) : '—'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {scoreTooltip}
                </TooltipContent>
              </ConfiguredTooltip>
            </div>
          )}
          {!isOptimising && (
            <div className="text-muted-foreground mt-1 text-xs">
              Suggested max accel:{' '}
              <ConfiguredTooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {currentMaxAccel != null ? Math.round(currentMaxAccel / 100) * 100 : '—'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {maxAccelTooltip}
                </TooltipContent>
              </ConfiguredTooltip>{' '}
              mm/s²
            </div>
          )}
          {!isOptimising && (
            <div className="text-muted-foreground mt-1 text-xs">
              Delay centroid:{' '}
              <ConfiguredTooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {delayCentroidSeconds != null
                      ? `${(delayCentroidSeconds * 1000).toFixed(2)} ms`
                      : '—'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {delayCentroidTooltip}
                </TooltipContent>
              </ConfiguredTooltip>
            </div>
          )}
          {optimiseProgress && (
            <div className="mt-3 rounded-md border border-dashed p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <ConfiguredTooltip>
                  <TooltipTrigger asChild>
                    <div className="text-muted-foreground text-xs underline decoration-dotted underline-offset-2">
                      Preview
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    {previewModeTooltip}
                  </TooltipContent>
                </ConfiguredTooltip>
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
                <ConfiguredTooltip>
                  <TooltipTrigger asChild>
                    <span className="font-medium underline decoration-dotted underline-offset-2">
                      {optimiseProgress.current ? optimiseProgress.current.score.toFixed(9) : '—'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    {scoreTooltip}
                  </TooltipContent>
                </ConfiguredTooltip>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                Best score:{' '}
                <ConfiguredTooltip>
                  <TooltipTrigger asChild>
                    <span className="font-medium underline decoration-dotted underline-offset-2">
                      {optimiseProgress.best ? optimiseProgress.best.score.toFixed(9) : '—'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    {scoreTooltip}
                  </TooltipContent>
                </ConfiguredTooltip>
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
            <ConfiguredTooltip>
              <TooltipTrigger asChild>
                <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                  Resonance f0: {f0} Hz
                </label>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {f0Tooltip}
              </TooltipContent>
            </ConfiguredTooltip>
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
            <ConfiguredTooltip>
              <TooltipTrigger asChild>
                <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                  Damping (ζ): {zeta.toFixed(3)}
                </label>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {zetaTooltip}
              </TooltipContent>
            </ConfiguredTooltip>
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
            <ConfiguredTooltip>
              <TooltipTrigger asChild>
                <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                  Tolerance (vtol): {vtol.toFixed(3)}
                </label>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {vtolTooltip}
              </TooltipContent>
            </ConfiguredTooltip>
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
