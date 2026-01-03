import { useAtom, useAtomValue } from 'jotai';
import {
  CORNERING_JUNCTION_DEVIATION_RANGE_MM,
  CORNERING_SPEED_RANGE_MM_S,
  SHAPER_F0_RANGE_HZ,
  SHAPER_VTOL_RANGE,
  SHAPER_ZETA_RANGE,
} from '@/constants';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ExplainTooltip } from '@/components/ExplainTooltip';
import { cn } from '@/lib/utils';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
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
} from './atoms';
import useOptimisers from './optimisers';
import { SEARCH_TYPES } from './shaper-optimiser.worker';

export default function ShaperSideBar() {
  const [type, setType] = useAtom(shaperTypeAtom);
  const [f0, setF0] = useAtom(shaperF0Atom);
  const [zeta, setZeta] = useAtom(shaperZetaAtom);
  const [vtol, setVtol] = useAtom(shaperVtolAtom);
  const [scoreMode, setScoreMode] = useAtom(shaperScoreModeAtom);
  const [corneringModel, setCorneringModel] = useAtom(corneringModelAtom);
  const [corneringScv, setCorneringScv] = useAtom(corneringScvAtom);
  const [corneringJerk, setCorneringJerk] = useAtom(corneringJerkAtom);
  const [corneringJd, setCorneringJd] = useAtom(corneringJdAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const [analysisRange, setAnalysisRange] = useAtom(analysisRangeAtom);

  const {
    runAutoOptimise,
    runCoarseTuneSelected,
    runRefineCurrent,
    isOptimising,
    optimiseProgress,
    bestByType,
    optimisePreviewMode,
    setOptimisePreviewMode,
  } = useOptimisers();

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
          <span className="font-mono">accel=5000</span>,{' '}
          <span className="font-mono">cornering</span>
          from the UI). Bigger smoothing rounds corners more.
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

  const variationScoreTooltip = (
    <>
      Measures how “smooth” the <b>shaped</b> spectrum is (lower is better).
      <div className="text-muted-foreground mt-2">
        Computed as total variation over 0–200 Hz: <span className="font-mono">Σ |Δy|</span>.
      </div>
    </>
  );

  const scoreModeTooltip = {
    title: 'Score mode',
    accurate: (
      <>
        Choose what <b>Find best</b> and <b>Coarse tune</b> try to minimize.
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>Klipper</b>: tradeoff between remaining vibration and smoothing (good general
            default).
          </li>
          <li>
            <b>Flatness</b>: minimize variation from a horizontal line in the shaped spectrum.
          </li>
          <li>
            <b>Variation</b>: minimize “roughness” of the shaped spectrum (total variation).
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

  const corneringModelInfo = {
    title: 'Cornering model',
    accurate: (
      <>
        Controls how the smoothing term models corner rounding for the Klipper-style score and the
        suggested max acceleration.
      </>
    ),
    intuition: <>Pick the option that matches your firmware and what you configured in it.</>,
  };

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

  const findBest = {
    title: 'Find best',
    accurate: (
      <>
        Brute-force searches shaper type + frequency + damping (+ tolerance for EI/HEI) to minimize
        the score, using your Measure <b>max-hold</b> spectrum as input.
      </>
    ),
    intuition: <>It also runs a gradient refinment at the end.</>,
  };

  const coarseTuneSelected = {
    title: 'Coarse tune',
    accurate: (
      <>Brute-force searches only the currently selected shaper type to minimize the score.</>
    ),
    intuition: <>This skips the final gradient refinement pass.</>,
  };

  const fineTune = {
    title: 'Fine tune',
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

  const scoreModeVariation = {
    title: 'Variation score mode',
    accurate: (
      <>
        Minimizes the total variation of the <b>shaped</b> spectrum over 0–200 Hz:
        <div className="mt-2 font-mono">Σ |y[i] - y[i-1]|</div>
      </>
    ),
    intuition: (
      <>
        Use this when you want a smoother shaped spectrum (fewer sharp wiggles), even if it’s not
        perfectly flat.
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

  return (
    <>
      <div className="text-left">
        <h3 className="text-lg font-semibold">Input Shaper Simulator</h3>
        <div className="text-muted-foreground text-sm">Works from Measure max-hold data.</div>
      </div>

      <div className="mt-5">
        <div className="mb-2">
          <ExplainTooltip
            title="Analysis range"
            accurate={
              <>
                Limits what frequencies the optimiser considers when scoring candidates. The plots
                still show the full spectrum.
              </>
            }
            intuition={<>Narrow this around the resonance band you care about.</>}
            side="right"
            sideOffset={8}
          >
            <div className="text-muted-foreground underline decoration-dotted underline-offset-2">
              Analysis range
            </div>
          </ExplainTooltip>
        </div>
        <label className="text-muted-foreground text-sm">
          {analysisRange[0].toFixed(0)}–{analysisRange[1].toFixed(0)} Hz
        </label>
        <div className="mt-3">
          <Slider
            min={0}
            max={SHAPER_F0_RANGE_HZ[1]}
            step={1}
            value={analysisRange}
            onValueChange={(v: [number, number]) => setAnalysisRange(v)}
            className="w-full"
          />
        </div>

        <div className="mb-2">
          <ExplainTooltip
            title={corneringModelInfo.title}
            accurate={corneringModelInfo.accurate}
            intuition={corneringModelInfo.intuition}
            side="right"
            sideOffset={8}
          >
            <div className="text-muted-foreground underline decoration-dotted underline-offset-2">
              Cornering model
            </div>
          </ExplainTooltip>
        </div>

        <div className="border-border grid w-full grid-cols-3 gap-1 rounded-md border p-1">
          <Button
            type="button"
            size="sm"
            variant={corneringModel === 'scv' ? 'secondary' : 'ghost'}
            className="h-8 w-full"
            aria-pressed={corneringModel === 'scv'}
            onClick={() => setCorneringModel('scv')}
          >
            SCV
          </Button>
          <Button
            type="button"
            size="sm"
            variant={corneringModel === 'jerk' ? 'secondary' : 'ghost'}
            className="h-8 w-full"
            aria-pressed={corneringModel === 'jerk'}
            onClick={() => setCorneringModel('jerk')}
          >
            Jerk
          </Button>
          <Button
            type="button"
            size="sm"
            variant={corneringModel === 'junction_deviation' ? 'secondary' : 'ghost'}
            className="h-8 w-full"
            aria-pressed={corneringModel === 'junction_deviation'}
            onClick={() => setCorneringModel('junction_deviation')}
          >
            Junction dev
          </Button>
        </div>

        <div className="mt-4 grid gap-4">
          {corneringModel === 'scv' && (
            <div>
              <label className="text-muted-foreground text-sm">
                SCV: {corneringScv.toFixed(1)} mm/s
              </label>
              <div className="mt-3">
                <Slider
                  min={CORNERING_SPEED_RANGE_MM_S[0]}
                  max={CORNERING_SPEED_RANGE_MM_S[1]}
                  step={0.5}
                  value={[corneringScv]}
                  onValueChange={(v) => setCorneringScv(v[0])}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {corneringModel === 'jerk' && (
            <div>
              <label className="text-muted-foreground text-sm">
                Jerk: {corneringJerk.toFixed(1)} mm/s
              </label>
              <div className="mt-3">
                <Slider
                  min={CORNERING_SPEED_RANGE_MM_S[0]}
                  max={CORNERING_SPEED_RANGE_MM_S[1]}
                  step={0.5}
                  value={[corneringJerk]}
                  onValueChange={(v) => setCorneringJerk(v[0])}
                  className="w-full"
                />
              </div>
            </div>
          )}
          {corneringModel === 'junction_deviation' && (
            <div>
              <label className="text-muted-foreground text-sm">
                Junction deviation: {corneringJd.toFixed(3)} mm
              </label>
              <div className="mt-3">
                <Slider
                  min={CORNERING_JUNCTION_DEVIATION_RANGE_MM[0]}
                  max={CORNERING_JUNCTION_DEVIATION_RANGE_MM[1]}
                  step={0.001}
                  value={[corneringJd]}
                  onValueChange={(v) => setCorneringJd(v[0])}
                  className="w-full"
                />
              </div>
            </div>
          )}
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
            <div className="text-muted-foreground underline decoration-dotted underline-offset-2">
              Score mode
            </div>
          </ExplainTooltip>
        </div>
        <div className="border-border grid w-full grid-cols-3 gap-1 rounded-md border p-1">
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

          <ExplainTooltip
            title={scoreModeVariation.title}
            accurate={scoreModeVariation.accurate}
            intuition={scoreModeVariation.intuition}
          >
            <Button
              type="button"
              size="sm"
              variant={scoreMode === 'variation' ? 'secondary' : 'ghost'}
              className="h-8 w-full"
              aria-pressed={scoreMode === 'variation'}
              onClick={() => setScoreMode('variation')}
            >
              Variation
            </Button>
          </ExplainTooltip>
        </div>
        <div className="mt-4">
          <ExplainTooltip
            title={findBest.title}
            accurate={findBest.accurate}
            intuition={findBest.intuition}
          >
            <Button
              type="button"
              className="w-full"
              variant="destructive"
              onClick={() => void runAutoOptimise()}
              disabled={!maxHoldSpectrum.length || isOptimising}
            >
              Full auto tune all shapers
            </Button>
          </ExplainTooltip>
        </div>
      </div>
      <div className="mt-5">
        <ExplainTooltip
          title={shaperFamily.title}
          accurate={shaperFamily.accurate}
          intuition={shaperFamily.intuition}
        >
          <div className="text-muted-foreground underline decoration-dotted underline-offset-2">
            Shaper
          </div>
        </ExplainTooltip>

        <div className="border-border mt-2 grid w-full grid-cols-4 gap-1 rounded-md border p-1">
          {SEARCH_TYPES.map((shaper) => (
            <ExplainTooltip
              key={shaper}
              title={shaperTypeButton.title}
              accurate={shaperTypeButton.accurate}
              intuition={shaperTypeButton.intuition}
            >
              <Button
                type="button"
                size="sm"
                variant={type === shaper ? 'secondary' : 'ghost'}
                className="h-8 w-full"
                aria-pressed={shaper === shaper}
                onClick={() => {
                  setType(shaper);
                  const best = bestByType[shaper];
                  if (best) {
                    setF0(best.params.fHz);
                    setZeta(best.params.zeta);
                    setVtol(best.params.vtol);
                  }
                }}
              >
                {shaper.toUpperCase()}
              </Button>
            </ExplainTooltip>
          ))}
        </div>
      </div>

      <div>
        <div className="mt-2 grid w-full grid-cols-2 gap-1 rounded-md">
          <ExplainTooltip
            title={coarseTuneSelected.title}
            accurate={coarseTuneSelected.accurate}
            intuition={coarseTuneSelected.intuition}
          >
            <Button
              type="button"
              size="sm"
              className="h-8 w-full"
              onClick={() => void runCoarseTuneSelected()}
              disabled={!maxHoldSpectrum.length || isOptimising}
            >
              Coarse tune {type}
            </Button>
          </ExplainTooltip>

          <ExplainTooltip
            title={fineTune.title}
            accurate={fineTune.accurate}
            intuition={fineTune.intuition}
          >
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 w-full"
              onClick={() => void runRefineCurrent()}
              disabled={!maxHoldSpectrum.length || isOptimising}
            >
              Fine tune {type}
            </Button>
          </ExplainTooltip>
        </div>

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
                accurate={
                  scoreMode === 'flatness'
                    ? flatnessScoreTooltip
                    : scoreMode === 'variation'
                      ? variationScoreTooltip
                      : scoreTooltip
                }
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
                accurate={
                  scoreMode === 'flatness'
                    ? flatnessScoreTooltip
                    : scoreMode === 'variation'
                      ? variationScoreTooltip
                      : scoreTooltip
                }
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
              min={SHAPER_F0_RANGE_HZ[0]}
              max={SHAPER_F0_RANGE_HZ[1]}
              step={0.5}
              value={[f0]}
              onValueChange={(v) => setF0(v[0])}
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
              min={SHAPER_ZETA_RANGE[0]}
              max={SHAPER_ZETA_RANGE[1]}
              step={0.005}
              value={[zeta]}
              onValueChange={(v) => setZeta(v[0])}
              className="w-full"
            />
          </div>
        </div>

        <div
          className={cn(
            type === 'zv' || type === 'zvd' || type === 'zvdd' || type === 'zvddd' || type === 'mzv'
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
              min={SHAPER_VTOL_RANGE[0]}
              max={SHAPER_VTOL_RANGE[1]}
              step={0.005}
              value={[vtol]}
              onValueChange={(v) => setVtol(v[0])}
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
    </>
  );
}
