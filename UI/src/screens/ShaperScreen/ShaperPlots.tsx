import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import {
  FREQUENCY_SLIDER_RANGE_HZ,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
} from '@/constants';
import { ExplainTooltip } from '@/components/ExplainTooltip';
import { computeMarlinShaperTaps } from './input-shaper';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import {
  analysisRangeAtom,
  currentMaxAccelAtom,
  currentScoreAtom,
  delayCentroidSecondsAtom,
  shapedSpectrumAtom,
  shaperF0Atom,
  shaperScoreModeAtom,
  shaperTypeAtom,
  shaperVtolAtom,
  shaperZetaAtom,
} from './atoms';

export default function ShaperPlots() {
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const type = useAtomValue(shaperTypeAtom);
  const f0 = useAtomValue(shaperF0Atom);
  const zeta = useAtomValue(shaperZetaAtom);
  const vtol = useAtomValue(shaperVtolAtom);
  const scoreMode = useAtomValue(shaperScoreModeAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const analysisRange = useAtomValue(analysisRangeAtom);
  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);
  const delayCentroidSeconds = useAtomValue(delayCentroidSecondsAtom);

  const optimiserWorkersRef = useRef<Worker[]>([]);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const w of optimiserWorkersRef.current) w.terminate();
      optimiserWorkersRef.current = [];
    };
  }, []);

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

  const maxAccelAccurate = (
    <>
      A projection of the highest acceleration where Klipper’s smoothing model stays under a fixed
      threshold: <code className="font-mono">smoothing(taps, accel, cornering) ≤ 0.12</code>. It’s
      found via bisection search.
      <div className="mt-2">
        <h4 className="text-sm font-semibold">Cornering model</h4>
        <div className="mt-1">
          The smoothing model depends on your firmware’s cornering behavior.
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <b>SCV (Klipper)</b>: planner maintains a target speed through sharp corners.
            </li>
            <li>
              <b>Jerk (Marlin)</b>: classic jerk limit (approx. corner speed ≈ jerk).
            </li>
            <li>
              <b>Junction deviation (Marlin)</b>: corner speed derived from accel + JD.
            </li>
          </ul>
        </div>
      </div>
    </>
  );

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
          freqRange={FREQUENCY_SLIDER_RANGE_HZ}
          markers={[
            { freqHz: analysisRange[0], color: 'rgba(255,255,255,0.75)' },
            { freqHz: analysisRange[1], color: 'rgba(255,255,255,0.75)' },
          ]}
          scaleMax={maxHoldSpectrum.length ? Math.max(...maxHoldSpectrum) : undefined}
        />
      </div>
      <div className="border-border mt-4 rounded-lg border p-3">
        <div className="text-muted-foreground text-sm">Score</div>
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
            intuition={<>Used by the optimiser and for quick comparisons.</>}
          >
            <span className="font-medium underline decoration-dotted underline-offset-2">
              {currentScore != null ? currentScore.toFixed(9) : '—'}
            </span>
          </ExplainTooltip>
        </div>

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
    </div>
  );
}
