import { atom, useAtomValue, useSetAtom } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import { FREQUENCY_SLIDER_RANGE_HZ, SPECTROGRAM_WATERFALL_HEIGHT } from '@/constants';
import { ScatterPlot, type ScatterPoint } from '@/visualisations/ScatterPlot';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import { SHAPER_COLORS } from './shaper-colors';
import {
  analysisRangeAtom,
  historyModeAtom,
  optimisationHistoryAtom,
  shaperResponseAtom,
  shapedSpectrumAtom,
  shaperParamsAtom,
  shaperScoreModeAtom,
  shaperStatsAtom,
  previewStatsAtom,
  shaperPreviewParamsAtom,
  selectedParamsStatsAtom,
} from './atoms';
import type { OptimisationResult } from './shaper-optimiser.worker';
import { useMeasure } from '@uidotdev/usehooks';
import { ExplainTooltip } from '@/components/ExplainTooltip';

const historyPointsAtom = atom((get) => {
  const { type } = get(shaperParamsAtom);
  const historyMode = get(historyModeAtom);
  type HistoryPoint = ScatterPoint<OptimisationResult>;
  const historyPoints = get(optimisationHistoryAtom)
    .map(
      (h): HistoryPoint => ({
        x: historyMode === 'centroid_ms' ? h.delay * 1000 : h.maxAccel,
        y: h.score,
        color: SHAPER_COLORS[h.params.type],
        strokeColor: type === h.params.type ? 'black' : '',
        strokeWidth: type === h.params.type ? 0.5 : 0,
        radius: type === h.params.type ? 2 : 0.5,
        meta: h,
        disabled: type !== h.params.type,
      })
    )
    .sort((a, _b) => (a.meta?.params.type === type ? 1 : -1));

  return historyPoints;
});

const allPointsAtom = atom((get) => {
  const historyPoints = get(historyPointsAtom);
  const historyMode = get(historyModeAtom);
  const finalStats = get(selectedParamsStatsAtom);
  const shaperParams = get(shaperParamsAtom);

  const currentPoint = {
    x: historyMode === 'centroid_ms' ? finalStats.delay * 1000 : finalStats.maxAccel,
    y: finalStats.score,
    color: 'rgba(255, 255, 255, 1)',
    radius: 6,
    strokeColor: 'rgba(0, 0, 0, 0.9)',
    strokeWidth: 1.5,
    meta: {
      ...finalStats,
      params: shaperParams,
    },
    disabled: true,
  };
  const all = [...historyPoints, currentPoint];

  const previewStats = get(previewStatsAtom);
  const previewParams = get(shaperPreviewParamsAtom);
  if (previewStats && previewParams) {
    all.push({
      x: historyMode === 'centroid_ms' ? previewStats.delay * 1000 : previewStats.maxAccel,
      y: previewStats.score,
      color: 'rgba(255, 255, 255, .5)',
      radius: 6,
      strokeColor: 'rgba(0, 0, 0, 0.9)',
      strokeWidth: 1.5,
      meta: {
        ...previewStats,
        params: previewParams,
      },
      disabled: true,
    });
  }
  return all;
});

export default function ShaperPlots() {
  const height = SPECTROGRAM_WATERFALL_HEIGHT;
  const [plotRef, plotBounds] = useMeasure<HTMLDivElement>();
  const width = Math.max(0, Math.floor(plotBounds.width ?? 0));

  const shaperParams = useAtomValue(shaperParamsAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const shaperResponse = useAtomValue(shaperResponseAtom);
  const analysisRange = useAtomValue(analysisRangeAtom);
  const historyMode = useAtomValue(historyModeAtom);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="mb-2 font-semibold">Spectrum Max-Hold → Shaped</h4>
        <div ref={plotRef} className="w-full">
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
              {
                dataAtom: shaperResponseAtom,
                mode: 'line',
                color: SHAPER_COLORS[shaperParams.type].replace(', 1)', ', 0.85)'),
                yAxis: 'right',
              },
            ]}
            height={height}
            width={width}
            freqRange={FREQUENCY_SLIDER_RANGE_HZ}
            xLabel="Frequency (Hz)"
            yLabel="Amplitude"
            y2Label="Response"
            markers={[
              { freqHz: analysisRange[0], color: 'rgba(255,255,255,0.75)' },
              { freqHz: analysisRange[1], color: 'rgba(255,255,255,0.75)' },
            ]}
            scaleMax={maxHoldSpectrum.length ? Math.max(...maxHoldSpectrum) : undefined}
            scaleMaxRight={shaperResponse.length ? Math.max(...shaperResponse) : 1}
          />
        </div>
      </div>
      <CurrentScore />

      <div>
        <h4 className="mb-2 font-semibold">
          Optimiser Results:{' '}
          {historyMode === 'centroid_ms' ? 'Delay Centroid' : 'Suggested Max Accel'} vs Score
        </h4>
        <div className="text-muted-foreground mb-2 text-xs">
          Each dot is a new best-so-far candidate found during the optimiser run (lower score is
          better). X axis is{' '}
          {historyMode === 'centroid_ms' ? 'delay centroid (ms)' : 'suggested max accel (mm/s²)'}.
        </div>
        <HistoryPlot />
      </div>
    </div>
  );
}
const HistoryPlot = () => {
  const height = SPECTROGRAM_WATERFALL_HEIGHT;
  const [plotRef, plotBounds] = useMeasure<HTMLDivElement>();
  const width = Math.max(0, Math.floor(plotBounds.width ?? 0));

  const setShaperParams = useSetAtom(shaperParamsAtom);
  const setPreviewShaperParams = useSetAtom(shaperPreviewParamsAtom);
  const historyMode = useAtomValue(historyModeAtom);
  const scoreMode = useAtomValue(shaperScoreModeAtom);

  const allHistoryPoints = useAtomValue(allPointsAtom);

  return (
    <div
      ref={plotRef}
      className="w-full"
      onPointerLeave={() => {
        setPreviewShaperParams(undefined);
      }}
    >
      <ScatterPlot
        points={allHistoryPoints}
        width={width}
        height={height}
        xTickFormat={(v) => `${Math.round(v)}`}
        xLabel={
          historyMode === 'centroid_ms' ? 'Delay centroid (ms)' : 'Suggested max accel (mm/s²)'
        }
        yLabel={scoreMode === 'klipper' ? 'Score (Klipper)' : 'Score (variation)'}
        hoverMode="x"
        onPointClick={(p) => {
          if (!p.meta) return;
          setShaperParams(p.meta.params);
          setPreviewShaperParams(undefined);
        }}
        onPointHover={(p) => {
          setPreviewShaperParams(p?.meta?.params);
        }}
        getHover={(p) => {
          const meta = p.meta;
          if (!meta) {
            return {
              title: 'Candidate',
              lines: [`x: ${p.x.toFixed(2)}`, `y: ${p.y.toFixed(6)}`],
            };
          }

          return {
            title: meta.params.type.toUpperCase(),
            lines: [
              `Max accel: ${meta.maxAccel.toFixed(0)} mm/s²`,
              `Delay: ${(meta.delay * 1000).toFixed(2)} ms`,
              `Score: ${meta.score.toFixed(9)}`,
            ],
          };
        }}
      />
    </div>
  );
};

const CurrentScore = () => {
  const shaperStats = useAtomValue(shaperStatsAtom);

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="border-border rounded-lg border p-3">
        <div className="text-muted-foreground text-sm">Score</div>
        <div className="mt-1 font-mono text-sm tabular-nums">{shaperStats.score.toFixed(9)}</div>
      </div>

      <div className="border-border rounded-lg border p-3">
        <ExplainTooltip
          title="Suggested max accel"
          accurate={
            <>
              A projection of the highest acceleration where Klipper’s smoothing model stays under a
              fixed threshold:{' '}
              <code className="font-mono">smoothing(taps, accel, cornering) ≤ 0.12</code>. It’s
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
          }
          intuition={
            <>
              If you push accel above this, the shaper tends to “round off” corners more (it’s
              trading sharpness for reduced ringing).
            </>
          }
        >
          <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
            Max accel
          </div>
        </ExplainTooltip>
        <div className="mt-1 font-mono text-sm tabular-nums">
          {shaperStats.maxAccel.toFixed(2)} <span className="text-xs">mm/s²</span>
        </div>
      </div>

      <div className="border-border rounded-lg border p-3">
        <ExplainTooltip
          title="Delay centroid"
          accurate={
            <div className="max-w-90 leading-snug">
              <div className="mt-2">
                A rough “center of mass” of the shaper taps in time:{' '}
                <span className="font-mono">Σ(aᵢ·tᵢ) / Σ(aᵢ)</span>.
              </div>
              <div className="text-muted-foreground mt-2">
                This matters because a shaper spreads a single motion command over time. At a 90°
                corner (finish X, then start Y), the delayed tail of X can overlap with the start of
                Y. That overlap is one reason corners look rounded: you’re effectively moving in X
                and Y at the same time for a short moment.
              </div>
            </div>
          }
          intuition={null}
        >
          <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
            Delay centroid
          </div>
        </ExplainTooltip>
        <div className="mt-1 font-mono text-sm tabular-nums">
          {(shaperStats.delay * 1000).toFixed(2)} ms
        </div>
      </div>
    </div>
  );
};
