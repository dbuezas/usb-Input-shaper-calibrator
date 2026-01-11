import { useAtom, useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import {
  CORNERING_JUNCTION_DEVIATION_RANGE_MM,
  CORNERING_JERK_RANGE_MM_S,
  CORNERING_SPEED_RANGE_MM_S,
  SHAPER_F0_RANGE_HZ,
  SHAPER_VTOL_RANGE,
  SHAPER_ZETA_RANGE,
  FREQUENCY_SLIDER_RANGE_HZ,
} from '@/constants';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ExplainTooltip } from '@/components/ExplainTooltip';
import { cn } from '@/lib/utils';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import {
  shaperParamsAtom,
  shaperScoreModeAtom,
  corneringSettingsAtom,
  analysisRangeAtom,
  historyModeAtom,
} from './atoms';
import useOptimisers from './useOptimizers';
import { SEARCH_TYPES } from './shaper-optimiser.worker';
import { isEiFamily } from './input-shaper';
import { SHAPER_COLORS } from './shaper-colors';

export default function ShaperSideBar() {
  const [shaperParams, setShaperParams] = useAtom(shaperParamsAtom);
  const [scoreMode, setScoreMode] = useAtom(shaperScoreModeAtom);
  const [corneringSettings, setCorneringSettings] = useAtom(corneringSettingsAtom);
  const [historyMode, setHistoryMode] = useAtom(historyModeAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const [analysisRange, setAnalysisRange] = useAtom(analysisRangeAtom);

  const { runAutoOptimise, optimiseProgress, bestByType, stop } = useOptimisers();
  const isOptimising = !!optimiseProgress;
  const percent = optimiseProgress
    ? (100 * optimiseProgress.iterationsDone) / optimiseProgress.iterationsTotal
    : 0;
  const scoreModeTooltip = {
    title: 'Score mode',
    accurate: (
      <>
        Choose what <b>Auto tune</b> try to minimize.
      </>
    ),
    intuition: (
      <>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>Variation</b>: minimize “roughness” of the shaped spectrum (total variation).
          </li>
          <li>
            <b>Klipper-like</b>: tradeoff between remaining vibration and smoothing.
          </li>
        </ul>
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

  const findBest = {
    title: 'Find best',
    accurate: (
      <>
        Brute-force searches shaper type + frequency + damping (+ tolerance for EI/HEI) to minimize
        the score.
      </>
    ),
    intuition: (
      <>
        Uses your Measure <b>max-hold</b> spectrum as input.
      </>
    ),
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

  const scoreModeVariation = {
    title: 'Variation score mode',
    accurate: (
      <>
        Minimizes the total variation of the <b>shaped</b> spectrum:
        <div className="mt-2 font-mono">Σ (y[i] - y[i-10])^2</div>
      </>
    ),
    intuition: <>Use this when you want a smoother shaped spectrum (fewer sharp wiggles).</>,
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
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-col gap-y-4">
        <div className="flex flex-col gap-y-2">
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

          <label className="text-muted-foreground text-sm">
            {analysisRange[0].toFixed(0)}–{analysisRange[1].toFixed(0)} Hz
          </label>

          <Slider
            min={FREQUENCY_SLIDER_RANGE_HZ[0]}
            max={FREQUENCY_SLIDER_RANGE_HZ[1]}
            step={1}
            value={analysisRange}
            onValueChange={(v: [number, number]) => setAnalysisRange(v)}
            className="w-full"
          />
        </div>

        <div className="flex flex-col gap-y-2">
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

          <div className="border-border grid w-full grid-cols-3 gap-1 rounded-md border p-1">
            <Button
              type="button"
              size="sm"
              variant={corneringSettings.model === 'scv' ? 'secondary' : 'ghost'}
              className="h-8 w-full"
              onClick={() => setCorneringSettings({ model: 'scv', value: 5 })}
            >
              SCV
            </Button>
            <Button
              type="button"
              size="sm"
              variant={corneringSettings.model === 'jerk' ? 'secondary' : 'ghost'}
              className="h-8 w-full"
              onClick={() => setCorneringSettings({ model: 'jerk', value: 10 })}
            >
              Jerk
            </Button>
            <Button
              type="button"
              size="sm"
              variant={corneringSettings.model === 'junction_deviation' ? 'secondary' : 'ghost'}
              className="h-8 w-full"
              onClick={() => setCorneringSettings({ model: 'junction_deviation', value: 0.013 })}
            >
              Junction dev
            </Button>
          </div>

          <div className="grid gap-4">
            {corneringSettings.model === 'scv' && (
              <div className="flex flex-col gap-y-2">
                <label className="text-muted-foreground text-sm">
                  SCV: {corneringSettings.value.toFixed(1)} mm/s
                </label>
                <Slider
                  min={CORNERING_SPEED_RANGE_MM_S[0]}
                  max={CORNERING_SPEED_RANGE_MM_S[1]}
                  step={0.5}
                  value={[corneringSettings.value]}
                  onValueChange={([value]) => setCorneringSettings({ model: 'scv', value })}
                  className="w-full"
                />
              </div>
            )}

            {corneringSettings.model === 'jerk' && (
              <div className="flex flex-col gap-y-2">
                <label className="text-muted-foreground text-sm">
                  Jerk: {corneringSettings.value.toFixed(1)} mm/s
                </label>
                <Slider
                  min={CORNERING_JERK_RANGE_MM_S[0]}
                  max={CORNERING_JERK_RANGE_MM_S[1]}
                  step={0.5}
                  value={[corneringSettings.value]}
                  onValueChange={([value]) => setCorneringSettings({ model: 'jerk', value })}
                  className="w-full"
                />
              </div>
            )}
            {corneringSettings.model === 'junction_deviation' && (
              <div className="flex flex-col gap-y-2">
                <label className="text-muted-foreground text-sm">
                  Junction deviation: {corneringSettings.value.toFixed(3)} mm
                </label>
                <Slider
                  min={CORNERING_JUNCTION_DEVIATION_RANGE_MM[0]}
                  max={CORNERING_JUNCTION_DEVIATION_RANGE_MM[1]}
                  step={0.001}
                  value={[corneringSettings.value]}
                  onValueChange={([value]) =>
                    setCorneringSettings({ model: 'junction_deviation', value })
                  }
                  className="w-full"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-y-4">
        <div className="flex flex-col gap-y-2">
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
                onClick={() => setScoreMode('klipper')}
              >
                Klipper-like
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
                onClick={() => setScoreMode('variation')}
              >
                Variation
              </Button>
            </ExplainTooltip>
          </div>
        </div>

        <div className="flex flex-col gap-y-2">
          <ExplainTooltip
            title="Optimiser view"
            accurate={
              <>
                Controls both what the optimiser considers a “better tradeoff” when keeping
                best-so-far candidates, and what the optimiser history chart shows on its X axis.
              </>
            }
            intuition={
              <>
                <b>Centroid</b> emphasizes lower delay / less corner overlap; <b>Max accel</b>
                emphasizes higher usable acceleration.
              </>
            }
            side="right"
            sideOffset={8}
          >
            <div className="text-muted-foreground underline decoration-dotted underline-offset-2">
              Optimiser view
            </div>
          </ExplainTooltip>

          <div className="border-border grid w-full grid-cols-2 gap-1 rounded-md border p-1">
            <Button
              type="button"
              size="sm"
              variant={historyMode === 'suggested_max_accel' ? 'secondary' : 'ghost'}
              className="h-8 w-full"
              onClick={() => setHistoryMode('suggested_max_accel')}
            >
              Max accel
            </Button>
            <Button
              type="button"
              size="sm"
              variant={historyMode === 'centroid_ms' ? 'secondary' : 'ghost'}
              className="h-8 w-full"
              onClick={() => setHistoryMode('centroid_ms')}
            >
              Delay centroid
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-y-2">
          {!isOptimising && (
            <ExplainTooltip
              title={findBest.title}
              accurate={findBest.accurate}
              intuition={findBest.intuition}
            >
              <Button
                type="button"
                className="w-full"
                variant="destructive"
                onClick={async () => {
                  await runAutoOptimise();
                }}
                disabled={!maxHoldSpectrum.length || isOptimising}
              >
                Full auto tune all shapers
              </Button>
            </ExplainTooltip>
          )}
          {optimiseProgress && isOptimising && (
            <div className="flex flex-col gap-y-2">
              <Button className="w-full" onClick={stop} variant="destructive">
                Stop
              </Button>
              <div className="text-muted-foreground text-xs">
                {percent.toFixed(0)}% ({optimiseProgress.iterationsDone}/
                {optimiseProgress.iterationsTotal})
              </div>
              <div className="bg-muted h-2 w-full rounded">
                <div
                  className="bg-primary h-2 rounded"
                  style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                />
              </div>
            </div>
          )}
          {!maxHoldSpectrum.length && (
            <div className="text-muted-foreground text-xs">
              Collect max-hold data in Measure first.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-y-2">
        <ExplainTooltip
          title={shaperFamily.title}
          accurate={shaperFamily.accurate}
          intuition={shaperFamily.intuition}
        >
          <div className="text-muted-foreground underline decoration-dotted underline-offset-2">
            Shaper
          </div>
        </ExplainTooltip>

        <div className="border-border grid w-full grid-cols-4 gap-1 rounded-md border p-1">
          {SEARCH_TYPES.map((shaper) => {
            const active = shaperParams.type === shaper;
            const style = { '--shaper-color': SHAPER_COLORS[shaper] } as CSSProperties;
            return (
              <Button
                type="button"
                size="sm"
                key={shaper}
                variant={shaperParams.type === shaper ? 'secondary' : 'ghost'}
                className={cn(
                  'relative h-8 w-full overflow-hidden transition-[filter,transform] duration-150 hover:brightness-125 hover:saturate-150',
                  'before:absolute before:inset-0 before:bg-(--shaper-color) before:content-[""]',
                  active ? 'text-black before:opacity-100' : 'text-white/85 before:opacity-25',
                  'border border-(--shaper-color)'
                )}
                style={style}
                onClick={() => {
                  setShaperParams((old) => ({
                    ...old,
                    type: shaper,
                    ...(bestByType[shaper]?.params ?? {}),
                  }));
                }}
              >
                <span className="relative z-10">{shaper.toUpperCase()}</span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="flex flex-col gap-y-2">
          <ExplainTooltip
            title={f0Info.title}
            accurate={f0Info.accurate}
            intuition={f0Info.intuition}
          >
            <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Resonance f0: {shaperParams.fHz.toFixed(1)} Hz
            </label>
          </ExplainTooltip>
          <Slider
            min={SHAPER_F0_RANGE_HZ[0]}
            max={SHAPER_F0_RANGE_HZ[1]}
            step={0.5}
            value={[shaperParams.fHz]}
            onValueChange={([fHz]) => setShaperParams((old) => ({ ...old, fHz }))}
            className="w-full"
          />
        </div>

        <div className="flex flex-col gap-y-2">
          <ExplainTooltip
            title={zetaInfo.title}
            accurate={zetaInfo.accurate}
            intuition={zetaInfo.intuition}
          >
            <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Damping (ζ): {shaperParams.zeta.toFixed(3)}
            </label>
          </ExplainTooltip>
          <Slider
            min={SHAPER_ZETA_RANGE[0]}
            max={SHAPER_ZETA_RANGE[1]}
            step={0.005}
            value={[shaperParams.zeta]}
            onValueChange={([zeta]) => setShaperParams((old) => ({ ...old, zeta }))}
            className="w-full"
          />
        </div>

        <div
          className={cn('flex flex-col gap-y-2', { 'opacity-60': !isEiFamily(shaperParams.type) })}
        >
          <ExplainTooltip
            title={vtolInfo.title}
            accurate={vtolInfo.accurate}
            intuition={vtolInfo.intuition}
          >
            <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Tolerance (vtol): {shaperParams.vtol.toFixed(3)}
            </label>
          </ExplainTooltip>
          <Slider
            min={SHAPER_VTOL_RANGE[0]}
            max={SHAPER_VTOL_RANGE[1]}
            step={0.005}
            value={[shaperParams.vtol]}
            onValueChange={([vtol]) => setShaperParams((old) => ({ ...old, vtol }))}
            className="w-full"
            disabled={!isEiFamily(shaperParams.type)}
          />
        </div>
      </div>
    </div>
  );
}
