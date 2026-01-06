import { useAtom, useAtomValue } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import {
  FREQUENCY_SLIDER_RANGE_HZ,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
} from '@/constants';
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
} from './atoms';
import { type InputShaperType } from './input-shaper';
import type { OptimisationResult } from './shaper-optimiser.worker';
import { useMemo, useState } from 'react';
import { Slider } from '@/components/ui/slider';

export default function ShaperPlots() {
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const shaperParams = useAtomValue(shaperParamsAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const shaperResponse = useAtomValue(shaperResponseAtom);
  const analysisRange = useAtomValue(analysisRangeAtom);
  const historyMode = useAtomValue(historyModeAtom);

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
      </div>

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
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const [shaperParams, setShaperParams] = useAtom(shaperParamsAtom);

  const currentScore = useAtomValue(currentScoreAtom);
  const currentMaxAccel = useAtomValue(currentMaxAccelAtom);
  const delayCentroidSeconds = useAtomValue(delayCentroidSecondsAtom);
  const optimisationHistory = useAtomValue(optimisationHistoryAtom);
  const historyMode = useAtomValue(historyModeAtom);

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

  const dataXExtent = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const p of [...historyPoints, currentPoint]) {
      if (!Number.isFinite(p.x)) continue;
      min = Math.min(min, p.x);
      max = Math.max(max, p.x);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (min === max) return [min - 1, max + 1] as const;
    return [min, max] as const;
  }, [historyPoints, currentPoint]);

  const [xRange, setXRange] = useState<[number, number] | null>(null);

  const effectiveXRange = useMemo(() => {
    if (!dataXExtent) return null;
    if (!xRange) return [dataXExtent[0], dataXExtent[1]] as const;
    const nextMin = Math.max(dataXExtent[0], Math.min(xRange[0], dataXExtent[1]));
    const nextMax = Math.max(nextMin, Math.min(xRange[1], dataXExtent[1]));
    return [nextMin, nextMax] as const;
  }, [dataXExtent, xRange]);

  const basePoints = [
    ...historyPoints,
    { ...currentPoint, color: 'rgba(255, 255, 255, .5)' },
    oldParams,
  ].filter((v): v is NonNullable<typeof v> => Boolean(v));

  const allHistoryPoints = (() => {
    const range = effectiveXRange;
    if (!range) return basePoints;

    const [minX, maxX] = range;
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
    <>
      <div
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
      </div>
      {dataXExtent && effectiveXRange && (
        <div className="mt-4">
          <Slider
            style={{ width: SPECTROGRAM_PLOT_WIDTH }}
            min={dataXExtent[0]}
            max={dataXExtent[1]}
            step={(dataXExtent[1] - dataXExtent[0]) / 10000}
            value={[effectiveXRange[0], effectiveXRange[1]]}
            onValueChange={(v) => {
              const a = v[0] ?? dataXExtent[0];
              const b = v[1] ?? dataXExtent[1];
              setXRange([Math.min(a, b), Math.max(a, b)]);
            }}
            className="w-full"
          />
        </div>
      )}
    </>
  );
};
