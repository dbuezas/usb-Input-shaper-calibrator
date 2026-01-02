import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Atom } from 'jotai';
import { useAtomValue } from 'jotai';
import { scaleLinear } from 'd3-scale';
import { ACTUAL_RESOLUTION, MAX_FREQ, MIN_FREQ, SPECTROGRAM_MAX_TIME_SLICES } from '@/constants';
import { DEFAULT_AXIS_PADDING, getInnerSize, useD3Axes } from './axis';
import { Tooltip } from './tooltip';
import { useRafThrottledHover } from './plot-hover';

const tickFormat = (v: number) => `${Math.round(v)}`;

export const Waterfall = ({
  width,
  height,
  freqRange,
  dataAtom,
  scaleMax,
  onPeakFrequency,
  markers,
}: {
  width: number;
  height: number;
  freqRange: [number, number];
  dataAtom: Atom<Float32Array>;
  scaleMax?: number;
  onPeakFrequency: (freqHz: number) => void;
  markers?: Array<{ freqHz: number; color?: string }>;
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

  const yScale = useMemo(
    () => scaleLinear().domain([SPECTROGRAM_MAX_TIME_SLICES, 0]).range([innerHeight, 0]),
    [innerHeight]
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
    xDomain: [freqRange[0], freqRange[1]],
    yDomain: [SPECTROGRAM_MAX_TIME_SLICES, 0],
    xTicks: 6,
    yTicks: 4,
    xTickFormat: tickFormat,
    yTickFormat: (v) => `${Math.round(v)}`,
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
        const slice = yScale.invert(plotY);
        setHover({
          visible: true,
          x,
          y,
          title: 'Cursor',
          lines: [`f: ${freq.toFixed(1)} Hz`, `slice: ${Math.round(slice)}`],
        });
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="image-rendering-pixelated block border bg-black"
      />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="pointer-events-none absolute inset-0"
      />
      {markerLines && (
        <svg width={width} height={height} className="pointer-events-none absolute inset-0">
          {markerLines}
        </svg>
      )}
      <Waterfall_render
        canvasRef={canvasRef}
        width={width}
        height={height}
        freqRange={freqRange}
        dataAtom={dataAtom}
        scaleMax={scaleMax}
        onPeakFrequency={onPeakFrequency}
      />
      <Tooltip hover={hover} />
    </div>
  );
};

const Waterfall_render = ({
  canvasRef,
  width,
  height,
  freqRange,
  dataAtom,
  scaleMax,
  onPeakFrequency,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  freqRange: [number, number];
  dataAtom: Atom<Float32Array>;
  scaleMax?: number;
  onPeakFrequency: (freqHz: number) => void;
}) => {
  const spectrum = useAtomValue(dataAtom);

  useEffect(() => {
    if (!spectrum.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const left = DEFAULT_AXIS_PADDING.left;
    const right = width - DEFAULT_AXIS_PADDING.right;
    const top = DEFAULT_AXIS_PADDING.top;
    const bottom = height - DEFAULT_AXIS_PADDING.bottom;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);
    const yScale = plotHeight / SPECTROGRAM_MAX_TIME_SLICES;

    const iMin = Math.max(0, Math.round((spectrum.length / (MAX_FREQ - MIN_FREQ)) * freqRange[0]));
    const iMax = Math.min(
      spectrum.length - 1,
      Math.round((spectrum.length / (MAX_FREQ - MIN_FREQ)) * freqRange[1])
    );

    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    let peakIdx = 0;
    for (let i = iMin; i < iMax; i++) {
      const value = spectrum[i];
      min = Math.min(min, value);
      if (max < value) {
        peakIdx = i;
        max = value;
      }
    }

    if (scaleMax != null) max = Math.max(max, scaleMax);
    const freqBinWidth = plotWidth / (iMax - iMin);
    const rangeVal = max - min;
    const safeRange = rangeVal <= 0 ? 1 : rangeVal;

    ctx.drawImage(
      canvas,
      left,
      top,
      plotWidth,
      plotHeight - 1,
      left,
      top + 1,
      plotWidth,
      plotHeight - 1
    );

    const y = top;
    for (let i = iMin; i < iMax; i++) {
      const value = spectrum[i];
      const val = (value - min) / safeRange;
      const r = Math.floor(val * 255);
      const g = Math.floor(val * 128);
      const b = Math.floor((1 - val) * 255);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const x = left + (i - iMin) * freqBinWidth;
      ctx.fillRect(x, y, freqBinWidth + 1, yScale);
    }
    ctx.fillStyle = `rgb(255,255,255)`;
    ctx.fillRect(left + (peakIdx - iMin) * freqBinWidth, y, freqBinWidth + 1, yScale);

    onPeakFrequency(peakIdx * ACTUAL_RESOLUTION);
  }, [width, height, spectrum, freqRange, scaleMax, canvasRef, dataAtom, onPeakFrequency]);

  return null;
};
