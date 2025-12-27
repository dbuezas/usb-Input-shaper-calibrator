import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { Atom } from 'jotai';
import { useAtomValue } from 'jotai';
import { scaleLinear } from 'd3-scale';
import { DEFAULT_AXIS_PADDING, getInnerSize, useD3Axes } from './axis';
import { Tooltip, useRafThrottledHover } from './tooltip';
import { MAX_FREQ, MIN_FREQ } from '@/constants';

export type SpectrumPlotMode = 'points' | 'line';

export type SpectrumPlotTrace = {
  dataAtom: Atom<number[]>;
  mode: SpectrumPlotMode;
  color: string;
};

const SpectrumPlot_render = ({
  canvasRef,
  traces,
  width,
  height,
  freqRange,
  scaleMax,
  dynamicRangeDb,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  traces: SpectrumPlotTrace[];
  width: number;
  height: number;
  freqRange: [number, number];
  scaleMax?: number;
  dynamicRangeDb?: number;
}) => {
  const datasets = traces.map(({ dataAtom }) => useAtomValue(dataAtom));

  useEffect(() => {
    if (!traces.length) return;

    const data = datasets[0];
    if (!data?.length) return;

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

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const series of datasets) {
      if (!series?.length) continue;
      if (series.length !== data.length) continue;

      for (let i = iMin; i < iMax; i++) {
        min = Math.min(min, series[i]);
        max = Math.max(max, series[i]);
      }
    }
    if (scaleMax != null) max = Math.max(max, scaleMax);
    if (dynamicRangeDb && dynamicRangeDb > 0) min = max - dynamicRangeDb;

    const rangeVal = max - min;
    const safeRange = rangeVal <= 0 ? 1 : rangeVal;

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
      if (!trace) continue;

      const series = datasets[t];
      if (!series?.length) continue;
      if (series.length !== data.length) continue;

      ctx.strokeStyle = trace.color;
      ctx.fillStyle = trace.color;

      if (trace.mode === 'line') {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = iMin; i < iMax; i++) {
          const norm = (series[i] - min) / safeRange;
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
        const norm = (series[i] - min) / safeRange;
        const x = left + (i - iMin) * xScale;
        const y = bottom - norm * innerHeight;
        ctx.beginPath();
        ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [width, height, datasets, freqRange, traces, dynamicRangeDb, scaleMax, canvasRef]);

  return null;
};

export const SpectrumPlot = ({
  traces,
  width,
  height,
  freqRange,
  scaleMax,
  dynamicRangeDb,
}: {
  traces: SpectrumPlotTrace[];
  width: number;
  height: number;
  freqRange: [number, number];
  scaleMax?: number;
  dynamicRangeDb?: number;
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

  const yDomain = (() => {
    if (dynamicRangeDb && dynamicRangeDb > 0) {
      const max = scaleMax ?? 0;
      return [max - dynamicRangeDb, max] as [number, number];
    }
    return [0, scaleMax ?? 1] as [number, number];
  })();

  const yScale = useMemo(
    () => scaleLinear().domain(yDomain).range([innerHeight, 0]),
    [yDomain, innerHeight]
  );

  useD3Axes({
    svgRef,
    width,
    height,
    xDomain: [freqRange[0], freqRange[1]],
    yDomain,
    xTicks: 6,
    yTicks: 4,
    xTickFormat: (v) => `${Math.round(v)}`,
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
        setHover({
          visible: true,
          x,
          y,
          title: 'Cursor',
          lines: [`f: ${freq.toFixed(1)} Hz`, `y: ${yScale.invert(plotY).toFixed(2)}`],
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
      <SpectrumPlot_render
        canvasRef={canvasRef}
        traces={traces}
        width={width}
        height={height}
        freqRange={freqRange}
        scaleMax={scaleMax}
        dynamicRangeDb={dynamicRangeDb}
      />
      <Tooltip hover={hover} />
    </div>
  );
};
