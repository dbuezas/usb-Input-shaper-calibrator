import { useAtom, useAtomValue } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import { FREQUENCY_SLIDER_RANGE_HZ, SPECTROGRAM_WATERFALL_HEIGHT } from '@/constants';
import { ScatterPlot, type ScatterPoint } from '@/visualisations/ScatterPlot';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import { SHAPER_COLORS } from './shaper-colors';
import {
  analysisRangeAtom,
  currentMaxAccelAtom,
  currentScoreAtom,
  delayCentroidSecondsAtom,
  historyModeAtom,
  optimisationHistoryAtom,
  shaperResponseAtom,
  shapedSpectrumAtom,
  shaperParamsAtom,
  shaperScoreModeAtom,
} from './atoms';
import { type InputShaperType } from './input-shaper';
import type { OptimisationResult } from './shaper-optimiser.worker';
import { useEffect, useMemo, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { useMeasure } from '@uidotdev/usehooks';
import { ExplainTooltip } from '@/components/ExplainTooltip';

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
          {width > 0 && (
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
              markers={[
                { freqHz: analysisRange[0], color: 'rgba(255,255,255,0.75)' },
                { freqHz: analysisRange[1], color: 'rgba(255,255,255,0.75)' },
              ]}
              scaleMax={maxHoldSpectrum.length ? Math.max(...maxHoldSpectrum) : undefined}
              scaleMaxRight={shaperResponse.length ? Math.max(...shaperResponse) : undefined}
            />
          )}
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

  const [shaperParams, setShaperParams] = useAtom(shaperParamsAtom);

  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);
  const delayCentroidSeconds = useAtomValue(delayCentroidSecondsAtom);
  const optimisationHistory = useAtomValue(optimisationHistoryAtom);
  const historyMode = useAtomValue(historyModeAtom);
  const scoreMode = useAtomValue(shaperScoreModeAtom);

  const typeColor: Record<InputShaperType, string> = SHAPER_COLORS;

  type HistoryPoint = ScatterPoint<OptimisationResult>;

  const historyPoints = optimisationHistory
    .map(
      (h): HistoryPoint => ({
        x: historyMode === 'centroid_ms' ? h.delay * 1000 : h.maxAccel,
        y: h.score,
        color: typeColor[h.params.type],
        strokeColor: shaperParams.type === h.params.type ? 'black' : '',
        strokeWidth: shaperParams.type === h.params.type ? 0.5 : 0,
        radius: shaperParams.type === h.params.type ? 2 : 0.5,
        meta: h,
        disabled: shaperParams.type !== h.params.type,
      })
    )
    .sort((a, _b) => (a.meta?.params.type === shaperParams.type ? 1 : -1));

  const currentPoint: HistoryPoint = useMemo(() => {
    return {
      x:
        historyMode === 'centroid_ms'
          ? delayCentroidSeconds * 1000
          : (currentMaxAccel ?? Number.NaN),
      y: currentScore,
      color: 'rgba(255, 255, 255, 1)',
      radius: 6,
      strokeColor: 'rgba(0, 0, 0, 0.9)',
      strokeWidth: 1.5,
      meta: {
        delay: delayCentroidSeconds,
        maxAccel: currentMaxAccel ?? Number.NaN,
        score: currentScore,
        params: shaperParams,
      },
      disabled: true,
    };
  }, [delayCentroidSeconds, currentMaxAccel, currentScore, shaperParams, historyMode]);
  const [oldParams, setOldParams] = useState<HistoryPoint>();

  const dataXExtent = useMemo((): [number, number] | undefined => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const p of [...historyPoints, currentPoint]) {
      min = Math.min(min, p.x);
      max = Math.max(max, p.x);
    }
    if (min === max) return [min - 1, max + 1];
    return [min, max];
  }, [historyPoints, currentPoint]);

  const [xRange, setXRange] = useState<[number, number]>([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setXRange([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]);
  }, [historyMode, scoreMode]);

  const basePoints = [
    ...historyPoints,
    { ...currentPoint, color: 'rgba(255, 255, 255, .5)' },
    oldParams,
  ].filter((v): v is NonNullable<typeof v> => Boolean(v));

  const allHistoryPoints = (() => {
    const minX = xRange[0];
    const maxX = xRange[1];
    const visible = basePoints.filter((p) => Number.isFinite(p.x) && p.x >= minX && p.x <= maxX);

    // Sentinel points: enforce x-axis bounds without affecting y-domain.
    // (ScatterPlot ignores non-finite y values both for domains and drawing.)
    const sentinels: HistoryPoint[] = [
      { x: minX, y: Number.NaN, disabled: true, radius: 0 },
      { x: maxX, y: Number.NaN, disabled: true, radius: 0 },
    ];

    return [...visible, ...sentinels];
  })();

  return (
    <div
      ref={plotRef}
      className="w-full"
      onPointerEnter={() => void setOldParams(currentPoint)}
      onPointerLeave={() => {
        if (oldParams?.meta) setShaperParams(oldParams.meta.params);
      }}
    >
      <ScatterPlot
        points={allHistoryPoints}
        width={width}
        height={height}
        xTickFormat={(v) => `${Math.round(v)}`}
        hoverMode="x"
        onPointClick={(p) => {
          if (!p.meta) return;
          setOldParams(currentPoint);
          setShaperParams(p.meta.params);
        }}
        onPointHover={(p) => {
          if (!p?.meta) {
            if (oldParams?.meta?.params) {
              setShaperParams(oldParams.meta.params);
            }
          } else {
            setShaperParams(p.meta.params);
          }
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

      <div className="mt-4">
        <Slider
          min={dataXExtent?.[0] ?? 0}
          max={dataXExtent?.[1] ?? 0}
          step={dataXExtent ? (dataXExtent[1] - dataXExtent[0]) / 10000 : 1}
          value={xRange}
          onValueChange={(v: [number, number]) => void setXRange(v)}
          className="w-full"
        />
      </div>
    </div>
  );
};

const CurrentScore = () => {
  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);
  const delayCentroidSeconds = useAtomValue(delayCentroidSecondsAtom);
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="border-border rounded-lg border p-3">
        <div className="text-muted-foreground text-sm">Score</div>
        <div className="mt-1 font-mono text-sm tabular-nums">{currentScore.toFixed(9)}</div>
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
          {(currentMaxAccel ?? 0).toFixed(2)} <span className="text-xs">mm/s²</span>
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
          {(delayCentroidSeconds * 1000).toFixed(2)} ms
        </div>
      </div>
    </div>
  );
};
