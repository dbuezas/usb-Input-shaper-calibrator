import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { Atom } from 'jotai';
import { useAtomValue } from 'jotai';
import { scaleLinear } from 'd3-scale';
import { DEFAULT_AXIS_PADDING, getInnerSize, useD3Axes } from './axis';
import { AxisLabels } from './AxisLabels';
import { Tooltip } from './tooltip';
import { MAX_FREQ, MIN_FREQ } from '@/constants';
import { useRafThrottledHover } from './plot-hover';

export type SpectrumPlotMode = 'points' | 'line';

export type SpectrumPlotTrace = {
  dataAtom: Atom<Float32Array>;
  mode: SpectrumPlotMode;
  color: string;
  yAxis?: 'left' | 'right';
};

export type SpectrumPlotMarker = {
  freqHz: number;
  color?: string;
};

const SpectrumPlot_render = ({
  canvasRef,
  traces,
  width,
  height,
  freqRange,
  scaleMax,
  scaleMaxRight,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  traces: SpectrumPlotTrace[];
  width: number;
  height: number;
  freqRange: [number, number];
  scaleMax?: number;
  scaleMaxRight?: number;
}) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const datasets = traces.map(({ dataAtom }) => useAtomValue(dataAtom));

  useEffect(() => {
    if (!traces.length) return;

    if (!datasets.length) return;
    const data = datasets[0];
    if (!data.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const iMin = Math.max(0, Math.round((data.length / (MAX_FREQ - MIN_FREQ)) * freqRange[0]));
    const iMax = Math.min(
      data.length - 1,
      Math.round((data.length / (MAX_FREQ - MIN_FREQ)) * freqRange[1])
    );
    if (iMax <= iMin) return;

    let minLeft = Number.POSITIVE_INFINITY;
    let maxLeft = Number.NEGATIVE_INFINITY;
    let minRight = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;

    for (let t = 0; t < traces.length; t++) {
      const series = datasets[t];
      const axis = traces[t]?.yAxis ?? 'left';
      if (!series.length) continue;
      if (series.length !== data.length) continue;

      for (let i = iMin; i < iMax; i++) {
        const v = series[i];
        if (!Number.isFinite(v)) continue;
        if (axis === 'right') {
          minRight = Math.min(minRight, v);
          maxRight = Math.max(maxRight, v);
        } else {
          minLeft = Math.min(minLeft, v);
          maxLeft = Math.max(maxLeft, v);
        }
      }
    }

    if (scaleMax != null) maxLeft = Math.max(maxLeft, scaleMax);
    if (scaleMaxRight != null) maxRight = Math.max(maxRight, scaleMaxRight);

    if (!Number.isFinite(minLeft)) minLeft = 0;
    if (!Number.isFinite(maxLeft)) maxLeft = 1;
    if (!Number.isFinite(minRight)) minRight = 0;
    if (!Number.isFinite(maxRight)) maxRight = 1;

    const safeRangeLeft = maxLeft - minLeft <= 0 ? 1 : maxLeft - minLeft;
    const safeRangeRight = maxRight - minRight <= 0 ? 1 : maxRight - minRight;

    ctx.clearRect(0, 0, width, height);

    const { innerWidth, innerHeight } = getInnerSize({
      width,
      height,
      padding: DEFAULT_AXIS_PADDING,
    });

    const left = DEFAULT_AXIS_PADDING.left;
    const bottom = height - DEFAULT_AXIS_PADDING.bottom;
    const xScale = innerWidth / (iMax - iMin);

    for (let t = 0; t < traces.length; t++) {
      const trace = traces[t];

      const series = datasets[t];
      const axis = trace.yAxis ?? 'left';

      ctx.strokeStyle = trace.color;
      ctx.fillStyle = trace.color;

      if (trace.mode === 'line') {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = iMin; i < iMax; i++) {
          const v = series[i];
          if (!Number.isFinite(v)) continue;
          const norm =
            axis === 'right' ? (v - minRight) / safeRangeRight : (v - minLeft) / safeRangeLeft;
          const x = left + (i - iMin) * xScale;
          const y = bottom - norm * innerHeight;
          if (i === iMin) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        continue;
      }

      const pointRadius = 1.2;
      for (let i = iMin; i < iMax; i++) {
        const v = series[i];
        if (!Number.isFinite(v)) continue;
        const norm =
          axis === 'right' ? (v - minRight) / safeRangeRight : (v - minLeft) / safeRangeLeft;
        const x = left + (i - iMin) * xScale;
        const y = bottom - norm * innerHeight;
        ctx.beginPath();
        ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [width, height, datasets, freqRange, traces, scaleMax, scaleMaxRight, canvasRef]);

  return null;
};
const tickFormat = (v: number) => `${Math.round(v)}`;

export const SpectrumPlot = ({
  traces,
  width,
  height,
  freqRange,
  scaleMax,
  scaleMaxRight,
  markers,
  xLabel,
  yLabel,
  y2Label,
}:
  | {
      traces: SpectrumPlotTrace[];
      width: number;
      height: number;
      freqRange: [number, number];
      scaleMax?: number;
      scaleMaxRight?: undefined;
      markers?: SpectrumPlotMarker[];
      xLabel: string;
      yLabel: string;
      y2Label?: never;
    }
  | {
      traces: SpectrumPlotTrace[];
      width: number;
      height: number;
      freqRange: [number, number];
      scaleMax?: number;
      scaleMaxRight: number;
      markers?: SpectrumPlotMarker[];
      xLabel: string;
      yLabel: string;
      y2Label: string;
    }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { hover, setHover, hideHover } = useRafThrottledHover();

  const { innerWidth, innerHeight } = getInnerSize({
    width,
    height,
    padding: DEFAULT_AXIS_PADDING,
  });

  const xScale = useMemo(
    () => scaleLinear().domain([freqRange[0], freqRange[1]]).range([0, innerWidth]),
    [freqRange, innerWidth]
  );

  const yDomain = useMemo(() => [0, scaleMax ?? 1] as [number, number], [scaleMax]);
  const y2Domain = useMemo(
    () => (scaleMaxRight != null ? ([0, scaleMaxRight] as [number, number]) : undefined),
    [scaleMaxRight]
  );

  const yScale = useMemo(
    () => scaleLinear().domain(yDomain).range([innerHeight, 0]),
    [yDomain, innerHeight]
  );

  const y2Scale = useMemo(
    () => (y2Domain ? scaleLinear().domain(y2Domain).range([innerHeight, 0]) : null),
    [y2Domain, innerHeight]
  );

  const markerLines = useMemo(() => {
    if (!markers?.length) return null;
    const left = DEFAULT_AXIS_PADDING.left;
    const top = DEFAULT_AXIS_PADDING.top;
    const bottom = height - DEFAULT_AXIS_PADDING.bottom;

    return markers
      .map((m) => {
        if (m.freqHz < freqRange[0] || m.freqHz > freqRange[1]) return null;
        const x = left + xScale(m.freqHz);
        const color = m.color ?? 'rgba(255,255,255,0.7)';
        return (
          <line
            key={`${m.freqHz}`}
            x1={x}
            x2={x}
            y1={top}
            y2={bottom}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        );
      })
      .filter(Boolean);
  }, [markers, freqRange, height, xScale]);

  useD3Axes({
    svgRef,
    width,
    height,
    xDomain: freqRange,
    yDomain,
    y2Domain,
    xTicks: 6,
    yTicks: 4,
    xTickFormat: tickFormat,
  });

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onPointerLeave={() => hideHover()}
      onPointerMove={(e) => {
        const el = containerRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const plotX = x - DEFAULT_AXIS_PADDING.left;
        const plotY = y - DEFAULT_AXIS_PADDING.top;
        if (plotX < 0 || plotY < 0 || plotX > innerWidth || plotY > innerHeight) {
          hideHover();
          return;
        }

        const freq = xScale.invert(plotX);
        const leftVal = yScale.invert(plotY);
        const rightVal = y2Scale ? y2Scale.invert(plotY) : null;
        setHover({
          visible: true,
          x,
          y,
          title: 'Cursor',
          lines: [
            `f: ${freq.toFixed(1)} Hz`,
            `y(left): ${leftVal.toFixed(2)}`,
            ...(rightVal != null ? [`y(right): ${rightVal.toFixed(2)}`] : []),
          ],
        });
      }}
    >
      <canvas ref={canvasRef} width={width} height={height} className="block border bg-black" />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="pointer-events-none absolute inset-0"
      />
      <AxisLabels width={width} height={height} xLabel={xLabel} yLabel={yLabel} y2Label={y2Label} />
      {markerLines && (
        <svg width={width} height={height} className="pointer-events-none absolute inset-0">
          {markerLines}
        </svg>
      )}
      <SpectrumPlot_render
        canvasRef={canvasRef}
        traces={traces}
        width={width}
        height={height}
        freqRange={freqRange}
        scaleMax={scaleMax}
        scaleMaxRight={scaleMaxRight}
      />
      <Tooltip hover={hover} />
    </div>
  );
};
