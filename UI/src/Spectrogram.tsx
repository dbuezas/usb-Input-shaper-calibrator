import { useRef, useEffect, type RefObject } from 'react';
import type { SpectrumSliceMessage, WelchPsdSliceMessage } from './messages';
import { spectrogramChannel } from './messages';
import { atom, useAtom, useAtomValue, useSetAtom, type Atom } from 'jotai';
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

const windowFunctionAtom = atom<WindowFunctionType>('hann');
const viewAtom = atom<'spectrum' | 'welch'>('welch');
const freqRangeAtom = atom<[number, number]>([MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER]);
type PeakInfo = {
  frequency: number;
  magnitude: number;
};
const peakAtom = atom<PeakInfo>();

const Peak = () => {
  const peak = useAtomValue(peakAtom);
  return peak ? `${peak.frequency.toFixed(1)} Hz @ ${peak.magnitude.toFixed(1)}` : '—';
};

const MAX_TIME_SLICES = 100;

type SpectrumPlotMode = 'points' | 'line';

const SpectrumPlot = ({
  dataAtom,
  width,
  height,
  freqRange,
  mode,
  color,
  dynamicRangeDb,
}: {
  dataAtom: Atom<number[]>;
  width: number;
  height: number;
  freqRange: [number, number];
  mode: SpectrumPlotMode;
  color: string;
  dynamicRangeDb?: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    <>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="block border border-gray-300 bg-black"
      />
      <SpectrumPlot_render
        canvasRef={canvasRef}
        dataAtom={dataAtom}
        width={width}
        height={height}
        freqRange={freqRange}
        mode={mode}
        color={color}
        dynamicRangeDb={dynamicRangeDb}
      />
    </>
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
  dynamicRangeDb,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  dataAtom: Atom<number[]>;
  width: number;
  height: number;
  freqRange: [number, number];
  mode: SpectrumPlotMode;
  color: string;
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

    if (dynamicRangeDb && dynamicRangeDb > 0) {
      for (let i = iMin; i < iMax; i++) max = Math.max(max, data[i]);
      min = max - dynamicRangeDb;
    } else {
      for (let i = iMin; i < iMax; i++) {
        min = Math.min(min, data[i]);
        max = Math.max(max, data[i]);
      }
    }

    const rangeVal = max - min;
    const safeRange = rangeVal <= 0 ? 1 : rangeVal;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, height - 0.5);
    ctx.lineTo(width - 0.5, height - 0.5);
    ctx.moveTo(0.5, 0.5);
    ctx.lineTo(0.5, height - 0.5);
    ctx.stroke();

    const xScale = width / (iMax - iMin);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    if (mode === 'line') {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = iMin; i < iMax; i++) {
        const norm = (data[i] - min) / safeRange;
        const x = (i - iMin) * xScale;
        const y = height - 1 - norm * (height - 2);
        if (i === iMin) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    const pointRadius = 1.2;
    for (let i = iMin; i < iMax; i++) {
      const norm = (data[i] - min) / safeRange;
      const x = (i - iMin) * xScale;
      const y = height - 1 - norm * (height - 2);
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
}: {
  width: number;
  height: number;
  freqRange: [number, number];
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="image-rendering-pixelated block border border-gray-300 bg-black"
      />
      <Waterfall_render canvasRef={canvasRef} width={width} height={height} freqRange={freqRange} />
    </>
  );
};
const Waterfall_render = ({
  canvasRef,
  width,
  height,
  freqRange,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  freqRange: [number, number];
}) => {
  const spectrum = useAtomValue(spectrogramAtom);
  const setPeak = useSetAtom(peakAtom);
  useEffect(() => {
    if (!spectrum?.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const yScale = height / MAX_TIME_SLICES;
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
    const freqBinWidth = width / (iMax - iMin);
    const rangeVal = max - min;
    const y = 0;
    ctx.drawImage(canvas, 0, 1);
    for (let i = iMin; i < iMax; i++) {
      const dbValue = spectrum[i];
      let val = (dbValue - min) / rangeVal;
      const r = Math.floor(val * 255);
      const g = Math.floor(val * 128);
      const b = Math.floor((1 - val) * 255);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const x = (i - iMin) * freqBinWidth;
      ctx.fillRect(x, y, freqBinWidth + 1, yScale);
    }
    ctx.fillStyle = `rgb(255,255,255)`;

    ctx.fillRect((peakIdx - iMin) * freqBinWidth, y, freqBinWidth + 1, yScale);

    setPeak((old) => {
      const frequency = peakIdx * ACTUAL_RESOLUTION;
      if (frequency === old?.frequency) return old;
      return {
        frequency,
        magnitude: 1,
      };
    });
  }, [width, height, spectrum]);
  return <></>;
};

export function SpectrogramControls({ dataSource }: { dataSource?: DataSource }) {
  const [windowFunction, setWindowFunction] = useAtom(windowFunctionAtom);
  const [view, setView] = useAtom(viewAtom);
  const [freqRange, setFreqRange] = useAtom(freqRangeAtom);
  const setSpectrogramMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const setWelchPsdMaxHold = useSetAtom(welchPsdMaxHoldAtom);

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
  const width = 800;
  const height = 200;
  const view = useAtomValue(viewAtom);
  const freqRange = useAtomValue(freqRangeAtom);
  useEffect(() => {
    const handleMessage = (e: MessageEvent<SpectrumSliceMessage | WelchPsdSliceMessage>) => {
      const msg = e.data;
      if (msg.type === 'spectrumSlice') {
        setSpectrogram(msg.spectrum);
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

      <Waterfall height={height} width={width} freqRange={freqRange} />
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
          />
        </>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm">
        <span>
          <Peak />
        </span>
        <span>Resolution: {(ACTUAL_RESOLUTION || 1).toFixed(2)} Hz/bin</span>
        <span>Time Slices: {MAX_TIME_SLICES}</span>
      </div>
    </div>
  );
}

export default Spectrogram;
