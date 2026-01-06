import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { DEFAULT_AXIS_PADDING, getInnerSize, useD3Axes } from './axis';
import { useRafThrottledHover } from './plot-hover';
import { Tooltip } from './tooltip';

export type ScatterPoint<TMeta = unknown> = {
  x: number;
  y: number;
  color?: string;
  radius?: number;
  strokeColor?: string;
  strokeWidth?: number;
  disabled?: boolean;
  meta?: TMeta;
};

export type ScatterPlotHover = {
  title?: string;
  lines: string[];
};

const defaultGetHover = (point: ScatterPoint): ScatterPlotHover => {
  return {
    title: 'Candidate',
    lines: [`x: ${point.x.toFixed(2)}`, `y: ${point.y.toFixed(6)}`],
  };
};

const computeDomain = (values: number[]) => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1] as const;
  if (min === max) return [min - 1, max + 1] as const;
  const pad = (max - min) * 0.06;
  return [min - pad, max + pad] as const;
};

const tickFormat = (v: number) => `${Math.round(v)}`;

export const ScatterPlot = <P extends ScatterPoint>({
  points,
  width,
  height,
  xTickFormat,
  hoverMode,
  getHover,
  onPointHover,
  onPointClick,
}: {
  points: P[];
  width: number;
  height: number;
  xTickFormat?: (v: number) => string;
  hoverMode?: 'xy' | 'x';
  getHover?: (point: P, index: number) => ScatterPlotHover;
  onPointHover?: (meta: P | undefined) => void;
  onPointClick?: (meta: P) => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { hover, setHover, hideHover } = useRafThrottledHover();
  const hoveredPointIndexRef = useRef<number | null>(null);
  const [isHoveringPoint, setIsHoveringPoint] = useState(false);

  const { innerWidth, innerHeight } = getInnerSize({
    width,
    height,
    padding: DEFAULT_AXIS_PADDING,
  });

  const xDomain = useMemo(() => computeDomain(points.map((p) => p.x)), [points]);
  const yDomain = useMemo(() => computeDomain(points.map((p) => p.y)), [points]);

  const xScale = useMemo(
    () => scaleLinear().domain(xDomain).range([0, innerWidth]),
    [xDomain, innerWidth]
  );

  const yScale = useMemo(
    () => scaleLinear().domain(yDomain).range([innerHeight, 0]),
    [yDomain, innerHeight]
  );

  useD3Axes({
    svgRef,
    width,
    height,
    xDomain: xDomain as [number, number],
    yDomain: yDomain as [number, number],
    xTicks: 6,
    yTicks: 4,
    xTickFormat: xTickFormat ?? tickFormat,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!points.length) return;

    const left = DEFAULT_AXIS_PADDING.left;
    const top = DEFAULT_AXIS_PADDING.top;

    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const x = left + xScale(p.x);
      const y = top + yScale(p.y);
      const radius = p.radius ?? 1;
      ctx.fillStyle = p.color ?? 'rgba(0, 220, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (p.strokeColor && (p.strokeWidth ?? 0) > 0) {
        ctx.strokeStyle = p.strokeColor;
        ctx.lineWidth = p.strokeWidth ?? 1;
        ctx.stroke();
      }
    }
  }, [points, width, height, xScale, yScale]);

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      style={{ cursor: isHoveringPoint ? 'pointer' : 'default' }}
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

        const px = DEFAULT_AXIS_PADDING.left + xScale(xScale.invert(plotX));
        const py = DEFAULT_AXIS_PADDING.top + yScale(yScale.invert(plotY));

        const mode = hoverMode ?? 'xy';
        let bestIdx = -1;
        let bestDist2 = Number.POSITIVE_INFINITY;
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (p.disabled || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          const sx = DEFAULT_AXIS_PADDING.left + xScale(p.x);
          const sy = DEFAULT_AXIS_PADDING.top + yScale(p.y);
          const dx = sx - px;
          const dy = sy - py;
          const d2 = mode === 'x' ? dx * dx : dx * dx + dy * dy;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestIdx = i;
          }
        }

        const maxDistPx = 10;
        if (bestIdx < 0 || bestDist2 > maxDistPx * maxDistPx) {
          hoveredPointIndexRef.current = null;
          setIsHoveringPoint(false);
          hideHover();
          onPointHover?.(undefined);
          return;
        }

        const p = points[bestIdx];
        hoveredPointIndexRef.current = bestIdx;
        setIsHoveringPoint(Boolean(onPointClick));
        onPointHover?.(p);

        const hoverAnchorX = DEFAULT_AXIS_PADDING.left + xScale(p.x);
        const hoverAnchorY = DEFAULT_AXIS_PADDING.top + yScale(p.y);

        const hover = getHover?.(p, bestIdx) ?? defaultGetHover(p);
        setHover({
          visible: true,
          x: mode === 'x' ? hoverAnchorX : x,
          y: mode === 'x' ? hoverAnchorY : y,
          title: hover.title,
          lines: hover.lines,
        });
      }}
      onClick={() => {
        const idx = hoveredPointIndexRef.current;
        if (idx == null) return;
        const p = points[idx];
        onPointClick?.(p);
      }}
    >
      <canvas ref={canvasRef} width={width} height={height} className="block border bg-black" />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="pointer-events-none absolute inset-0"
      />
      <Tooltip hover={hover} />
    </div>
  );
};
