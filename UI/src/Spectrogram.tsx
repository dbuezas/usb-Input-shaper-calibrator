import { useRef, useEffect, useMemo, useState, type RefObject } from 'react';
import type { SpectrumSliceMessage, WelchPsdSliceMessage } from './messages';
import { spectrogramChannel } from './messages';
import { atom, useAtom, useAtomValue, useSetAtom, type Atom } from 'jotai';
import { select } from 'd3-selection';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear } from 'd3-scale';
import { format } from 'd3-format';
import {
  ACTUAL_RESOLUTION,
  MAX_FREQ,
  MAX_FREQUENCY_SLIDER,
  MIN_FREQ,
  MIN_FREQUENCY_SLIDER,
} from './constants';
import { Slider } from './components/ui/slider';
import type { DataSource } from './data-source';
import type { WindowFunctionType } from './messages';
import { Button } from '@/components/ui/button';

const spectrogramAtom = atom<number[]>([]);
const spectrogramMaxHoldAtom = atom<number[]>([]);
const welchPsdAtom = atom<number[]>([]);
const welchPsdMaxHoldAtom = atom<number[]>([]);

const spectrogramScaleMaxAtom = atom<number | undefined>(undefined);
const welchPsdScaleMaxAtom = atom<number | undefined>(undefined);

const windowFunctionAtom = atom<WindowFunctionType>('hann');
const viewAtom = atom<'spectrum' | 'welch'>('welch');
const freqRangeAtom = atom<[number, number]>([MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER]);

const peakAtom = atom<number>();

export const peakFrequencyAtom = atom((get) => {
  const peak = get(peakAtom);
  return peak ? peak.toFixed(1) : '';
});

const MAX_TIME_SLICES = 100;

const AXIS = {
  left: 44,
  right: 12,
  top: 10,
  bottom: 28,
} as const;

const useD3Axes = ({
  svgRef,
  width,
  height,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xTickFormat,
  yTickFormat,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number;
  yTicks: number;
  xTickFormat?: (v: number) => string;
  yTickFormat?: (v: number) => string;
}) => {
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const innerWidth = Math.max(1, width - AXIS.left - AXIS.right);
    const innerHeight = Math.max(1, height - AXIS.top - AXIS.bottom);

    const xScale = scaleLinear().domain(xDomain).range([0, innerWidth]);
    const yScale = scaleLinear().domain(yDomain).range([innerHeight, 0]);

    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('class', 'axes')
      .attr('transform', `translate(${AXIS.left},${AXIS.top})`);

    const xAxis = axisBottom(xScale)
      .ticks(xTicks)
      .tickFormat((d: number | { valueOf(): number }) =>
        xTickFormat ? xTickFormat(Number(d)) : format('~g')(Number(d))
      );

    const yAxis = axisLeft(yScale)
      .ticks(yTicks)
      .tickFormat((d: number | { valueOf(): number }) =>
        yTickFormat ? yTickFormat(Number(d)) : format('~g')(Number(d))
      );

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    g.append('g').attr('class', 'y-axis').call(yAxis);

    g.selectAll('path, line').attr('stroke', 'rgba(255,255,255,0.25)');
    g.selectAll('text').attr('fill', 'rgba(255,255,255,0.7)').style('font-size', '10px');
  }, [svgRef, width, height, xDomain[0], xDomain[1], yDomain[0], yDomain[1], xTicks, yTicks]);
};

type PlotHover = {
  visible: boolean;
  x: number;
  y: number;
  title?: string;
  lines: string[];
};

const useRafThrottledHover = () => {
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<PlotHover | null>(null);
  const [hover, setHover] = useState<PlotHover>({ visible: false, x: 0, y: 0, lines: [] });

  const flush = () => {
    rafRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) setHover(next);
  };

  const set = (next: PlotHover) => {
    pendingRef.current = next;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  };

  const hide = () => {
    pendingRef.current = { visible: false, x: 0, y: 0, lines: [] };
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { hover, setHover: set, hideHover: hide };
};

const Tooltip = ({ hover }: { hover: PlotHover }) => {
  if (!hover.visible) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-black/80 px-2 py-1 text-left text-xs text-white shadow"
      style={{ left: hover.x + 10, top: hover.y + 10 }}
    >
      {hover.title && <div className="mb-1 font-semibold">{hover.title}</div>}
      {hover.lines.map((l, i) => (
        <div key={i} className="text-white/90">
          {l}
        </div>
      ))}
    </div>
  );
};

type SpectrumPlotMode = 'points' | 'line';

const SpectrumPlot = ({
  dataAtom,
  width,
  height,
  freqRange,
  mode,
  color,
  scaleMax,
  dynamicRangeDb,
}: {
  dataAtom: Atom<number[]>;
  width: number;
  height: number;
  freqRange: [number, number];
  mode: SpectrumPlotMode;
  color: string;
  scaleMax?: number;
  dynamicRangeDb?: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { hover, setHover, hideHover } = useRafThrottledHover();

  const innerWidth = Math.max(1, width - AXIS.left - AXIS.right);
  const innerHeight = Math.max(1, height - AXIS.top - AXIS.bottom);

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

        const plotX = x - AXIS.left;
        const plotY = y - AXIS.top;
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
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="block border border-gray-300 bg-black"
      />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="pointer-events-none absolute inset-0"
      />
      <SpectrumPlot_render
        canvasRef={canvasRef}
        dataAtom={dataAtom}
        width={width}
        height={height}
        freqRange={freqRange}
        mode={mode}
        color={color}
        scaleMax={scaleMax}
        dynamicRangeDb={dynamicRangeDb}
      />
      <Tooltip hover={hover} />
    </div>
  );
};

const SpectrumPlot_render = ({
  canvasRef,
  dataAtom,
  width,
  height,
  freqRange,
  mode,
  color,
  scaleMax,
  dynamicRangeDb,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  dataAtom: Atom<number[]>;
  width: number;
  height: number;
  freqRange: [number, number];
  mode: SpectrumPlotMode;
  color: string;
  scaleMax?: number;
  dynamicRangeDb?: number;
}) => {
  const data = useAtomValue(dataAtom);

  useEffect(() => {
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

    for (let i = iMin; i < iMax; i++) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    if (scaleMax != null) max = Math.max(max, scaleMax);
    if (dynamicRangeDb && dynamicRangeDb > 0) min = max - dynamicRangeDb;

    const rangeVal = max - min;
    const safeRange = rangeVal <= 0 ? 1 : rangeVal;

    ctx.clearRect(0, 0, width, height);

    const left = AXIS.left;
    const right = width - AXIS.right;
    const top = AXIS.top;
    const bottom = height - AXIS.bottom;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);

    const xScale = plotWidth / (iMax - iMin);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    if (mode === 'line') {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = iMin; i < iMax; i++) {
        const norm = (data[i] - min) / safeRange;
        const x = left + (i - iMin) * xScale;
        const y = bottom - norm * plotHeight;
        if (i === iMin) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    const pointRadius = 1.2;
    for (let i = iMin; i < iMax; i++) {
      const norm = (data[i] - min) / safeRange;
      const x = left + (i - iMin) * xScale;
      const y = bottom - norm * plotHeight;
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [width, height, data, freqRange, mode, color, dynamicRangeDb]);

  return <></>;
};

const Waterfall = ({
  width,
  height,
  freqRange,
  dataAtom,
  scaleMax,
}: {
  width: number;
  height: number;
  freqRange: [number, number];
  dataAtom: Atom<number[]>;
  scaleMax?: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { hover, setHover, hideHover } = useRafThrottledHover();

  const innerWidth = Math.max(1, width - AXIS.left - AXIS.right);
  const innerHeight = Math.max(1, height - AXIS.top - AXIS.bottom);

  const xScale = useMemo(
    () => scaleLinear().domain([freqRange[0], freqRange[1]]).range([0, innerWidth]),
    [freqRange, innerWidth]
  );

  const yScale = useMemo(
    () => scaleLinear().domain([MAX_TIME_SLICES, 0]).range([innerHeight, 0]),
    [innerHeight]
  );

  useD3Axes({
    svgRef,
    width,
    height,
    xDomain: [freqRange[0], freqRange[1]],
    yDomain: [MAX_TIME_SLICES, 0],
    xTicks: 6,
    yTicks: 4,
    xTickFormat: (v) => `${Math.round(v)}`,
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

        const plotX = x - AXIS.left;
        const plotY = y - AXIS.top;
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
        className="image-rendering-pixelated block border border-gray-300 bg-black"
      />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="pointer-events-none absolute inset-0"
      />
      <Waterfall_render
        canvasRef={canvasRef}
        width={width}
        height={height}
        freqRange={freqRange}
        dataAtom={dataAtom}
        scaleMax={scaleMax}
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
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  freqRange: [number, number];
  dataAtom: Atom<number[]>;
  scaleMax?: number;
}) => {
  const spectrum = useAtomValue(dataAtom);
  const setPeak = useSetAtom(peakAtom);
  useEffect(() => {
    if (!spectrum?.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const left = AXIS.left;
    const right = width - AXIS.right;
    const top = AXIS.top;
    const bottom = height - AXIS.bottom;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);
    const yScale = plotHeight / MAX_TIME_SLICES;
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

    // Scroll the plot area down by 1px within the plot rect.
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
      const dbValue = spectrum[i];
      const val = (dbValue - min) / safeRange;
      const r = Math.floor(val * 255);
      const g = Math.floor(val * 128);
      const b = Math.floor((1 - val) * 255);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const x = left + (i - iMin) * freqBinWidth;
      ctx.fillRect(x, y, freqBinWidth + 1, yScale);
    }
    ctx.fillStyle = `rgb(255,255,255)`;

    ctx.fillRect(left + (peakIdx - iMin) * freqBinWidth, y, freqBinWidth + 1, yScale);

    setPeak(peakIdx * ACTUAL_RESOLUTION);
  }, [width, height, spectrum]);
  return <></>;
};

export function SpectrogramControls({ dataSource }: { dataSource?: DataSource }) {
  const [windowFunction, setWindowFunction] = useAtom(windowFunctionAtom);
  const [view, setView] = useAtom(viewAtom);
  const [freqRange, setFreqRange] = useAtom(freqRangeAtom);
  const setSpectrogramMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const setWelchPsdMaxHold = useSetAtom(welchPsdMaxHoldAtom);
  const setSpectrogramScaleMax = useSetAtom(spectrogramScaleMaxAtom);
  const setWelchPsdScaleMax = useSetAtom(welchPsdScaleMaxAtom);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-muted-foreground text-sm">Window</div>
        <div className="border-border mt-2 inline-flex flex-wrap gap-1 rounded-md border p-1">
          {(
            [
              { value: 'hann', label: 'Hann' },
              { value: 'hamming', label: 'Hamming' },
              { value: 'blackman', label: 'Blackman' },
              { value: 'rectangular', label: 'Rectangular' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={windowFunction === opt.value ? 'secondary' : 'ghost'}
              className="h-8"
              aria-pressed={windowFunction === opt.value}
              onClick={() => {
                setWindowFunction(opt.value);
                dataSource?.setWindowFunction(opt.value);
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted-foreground text-sm">View</div>
        <div className="border-border mt-2 inline-flex rounded-md border p-1">
          {(
            [
              { value: 'spectrum', label: 'Spectrum' },
              { value: 'welch', label: 'Welch PSD' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={view === opt.value ? 'secondary' : 'ghost'}
              className="h-8"
              aria-pressed={view === opt.value}
              onClick={() => setView(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="frequency-slider" className="text-muted-foreground text-sm">
          Frequency Range: {freqRange[0]}-{freqRange[1]} Hz
        </label>
        <div className="mt-3">
          <Slider
            id="frequency-slider"
            min={MIN_FREQUENCY_SLIDER}
            max={MAX_FREQUENCY_SLIDER}
            step={1}
            value={freqRange}
            onValueChange={(v: [number, number]) => setFreqRange(v)}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="bg-muted text-foreground hover:bg-muted/80 inline-flex items-center rounded-md px-3 py-2 text-sm"
          onClick={() => {
            setSpectrogramMaxHold([]);
            setWelchPsdMaxHold([]);
            setSpectrogramScaleMax(undefined);
            setWelchPsdScaleMax(undefined);
          }}
        >
          Clear Max-Hold
        </button>
      </div>
    </div>
  );
}

function Spectrogram({ dataSource: _dataSource }: { dataSource?: DataSource }) {
  const setSpectrogram = useSetAtom(spectrogramAtom);
  const setSpectrogramMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const setWelchPsd = useSetAtom(welchPsdAtom);
  const setWelchPsdMaxHold = useSetAtom(welchPsdMaxHoldAtom);
  const setSpectrogramScaleMax = useSetAtom(spectrogramScaleMaxAtom);
  const setWelchPsdScaleMax = useSetAtom(welchPsdScaleMaxAtom);
  const width = 800;
  const height = 200;
  const view = useAtomValue(viewAtom);
  const freqRange = useAtomValue(freqRangeAtom);
  const spectrogramScaleMax = useAtomValue(spectrogramScaleMaxAtom);
  const welchPsdScaleMax = useAtomValue(welchPsdScaleMaxAtom);
  const activeScaleMax = view === 'spectrum' ? spectrogramScaleMax : welchPsdScaleMax;
  useEffect(() => {
    const handleMessage = (e: MessageEvent<SpectrumSliceMessage | WelchPsdSliceMessage>) => {
      const msg = e.data;
      if (msg.type === 'spectrumSlice') {
        setSpectrogram(msg.spectrum);
        setSpectrogramScaleMax((prev) => {
          let next = prev ?? Number.NEGATIVE_INFINITY;
          for (const v of msg.spectrum) next = Math.max(next, v);
          return next === Number.NEGATIVE_INFINITY ? undefined : next;
        });
        setSpectrogramMaxHold((prev) => {
          if (!prev?.length || prev.length !== msg.spectrum.length) return [...msg.spectrum];
          const next = prev.slice();
          for (let i = 0; i < msg.spectrum.length; i++)
            next[i] = Math.max(next[i], msg.spectrum[i]);
          return next;
        });
      }
      if (msg.type === 'welchPsdSlice') {
        setWelchPsd(msg.psd);
        setWelchPsdScaleMax((prev) => {
          let next = prev ?? Number.NEGATIVE_INFINITY;
          for (const v of msg.psd) next = Math.max(next, v);
          return next === Number.NEGATIVE_INFINITY ? undefined : next;
        });
        setWelchPsdMaxHold((prev) => {
          if (!prev?.length || prev.length !== msg.psd.length) return [...msg.psd];
          const next = prev.slice();
          for (let i = 0; i < msg.psd.length; i++) next[i] = Math.max(next[i], msg.psd[i]);
          return next;
        });
      }
    };

    spectrogramChannel.addEventListener('message', handleMessage);
    return () => {
      spectrogramChannel.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div className="text-center">
      <h3 className="mb-4 text-2xl font-semibold">Live Waterfall Spectrogram</h3>

      <Waterfall
        height={height}
        width={width}
        freqRange={freqRange}
        dataAtom={view === 'spectrum' ? spectrogramAtom : welchPsdAtom}
        scaleMax={activeScaleMax}
      />
      {view === 'spectrum' ? (
        <>
          <h3 className="mt-10 mb-4 text-2xl font-semibold">Last Spectrum (Scatter)</h3>
          <SpectrumPlot
            dataAtom={spectrogramAtom}
            height={Math.round(height / 2)}
            width={width}
            freqRange={freqRange}
            mode="points"
            color="rgba(0, 220, 255, 0.9)"
            scaleMax={spectrogramScaleMax}
          />
          <div className="mt-10 mb-4 flex items-center justify-center gap-3">
            <h3 className="text-2xl font-semibold">Spectrum (Accumulated Max-Hold)</h3>
          </div>
          <SpectrumPlot
            dataAtom={spectrogramMaxHoldAtom}
            height={Math.round(height / 2)}
            width={width}
            freqRange={freqRange}
            mode="line"
            color="rgba(0, 220, 255, 0.9)"
            scaleMax={spectrogramScaleMax}
          />
        </>
      ) : (
        <>
          <h3 className="mt-10 mb-4 text-2xl font-semibold">Welch PSD (Scatter)</h3>
          <SpectrumPlot
            dataAtom={welchPsdAtom}
            height={Math.round(height / 2)}
            width={width}
            freqRange={freqRange}
            mode="points"
            color="rgba(255, 180, 0, 0.9)"
            dynamicRangeDb={80}
            scaleMax={welchPsdScaleMax}
          />
          <div className="mt-10 mb-4 flex items-center justify-center gap-3">
            <h3 className="text-2xl font-semibold">Welch PSD (Accumulated Max-Hold)</h3>
          </div>
          <SpectrumPlot
            dataAtom={welchPsdMaxHoldAtom}
            height={Math.round(height / 2)}
            width={width}
            freqRange={freqRange}
            mode="line"
            color="rgba(255, 80, 80, 0.95)"
            dynamicRangeDb={80}
            scaleMax={welchPsdScaleMax}
          />
        </>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm">
        <span>Resolution: {(ACTUAL_RESOLUTION || 1).toFixed(2)} Hz/bin</span>
        <span>Time Slices: {MAX_TIME_SLICES}</span>
      </div>
    </div>
  );
}

export default Spectrogram;
