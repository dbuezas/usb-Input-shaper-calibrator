import { useRef, useEffect, useState, type RefObject } from 'react';
import type { SpectrumSliceMessage } from './messages';
import { spectrogramChannel } from './messages';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import {
  ACTUAL_RESOLUTION,
  MAX_FREQ,
  MAX_FREQUENCY_SLIDER,
  MIN_FREQ,
  MIN_FREQUENCY_SLIDER,
} from './constants';
import { Slider } from './components/ui/slider';

const spectrogramAtom = atom<number[]>();
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

const SpectrumScatter = ({
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
        className="block border border-gray-300 bg-black"
      />
      <SpectrumScatter_render
        canvasRef={canvasRef}
        width={width}
        height={height}
        freqRange={freqRange}
      />
    </>
  );
};

const SpectrumScatter_render = ({
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

  useEffect(() => {
    if (!spectrum?.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const iMin = Math.max(0, Math.round((spectrum.length / (MAX_FREQ - MIN_FREQ)) * freqRange[0]));
    const iMax = Math.min(
      spectrum.length - 1,
      Math.round((spectrum.length / (MAX_FREQ - MIN_FREQ)) * freqRange[1])
    );
    if (iMax <= iMin) return;

    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    for (let i = iMin; i < iMax; i++) {
      const value = spectrum[i];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const rangeVal = max - min;
    const safeRange = rangeVal <= 0 ? 1 : rangeVal;

    ctx.clearRect(0, 0, width, height);

    // Axes (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, height - 0.5);
    ctx.lineTo(width - 0.5, height - 0.5);
    ctx.moveTo(0.5, 0.5);
    ctx.lineTo(0.5, height - 0.5);
    ctx.stroke();

    const xScale = width / (iMax - iMin);
    const pointRadius = 1.2;
    ctx.fillStyle = 'rgba(0, 220, 255, 0.9)';

    for (let i = iMin; i < iMax; i++) {
      const dbValue = spectrum[i];
      const norm = (dbValue - min) / safeRange;
      const x = (i - iMin) * xScale;
      const y = height - 1 - norm * (height - 2);
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [width, height, spectrum, freqRange]);

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

function Spectrogram() {
  const setSpectrogram = useSetAtom(spectrogramAtom);
  const width = 800;
  const height = 400;
  const [freqRange, setFreqRange] = useState([MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER] as [
    number,
    number,
  ]);
  useEffect(() => {
    const handleMessage = (e: MessageEvent<SpectrumSliceMessage>) => {
      const { type, spectrum } = e.data;
      if (type !== 'spectrumSlice') return;
      setSpectrogram(spectrum);
    };

    spectrogramChannel.addEventListener('message', handleMessage);
    return () => {
      spectrogramChannel.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div className="text-center">
      <div className="mb-8 flex w-full flex-col items-stretch gap-6">
        <label htmlFor="frequency-slider" className="mb-1 text-sm">
          Frequency Range: {freqRange[0]}-{freqRange[1]} Hz
        </label>
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
      <h3 className="mb-4 text-2xl font-semibold">Live Waterfall Spectrogram</h3>

      <Waterfall height={height} width={width} freqRange={freqRange} />
      <h3 className="mt-10 mb-4 text-2xl font-semibold">Last Spectrum (Scatter)</h3>
      <SpectrumScatter height={Math.round(height / 2)} width={width} freqRange={freqRange} />
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
