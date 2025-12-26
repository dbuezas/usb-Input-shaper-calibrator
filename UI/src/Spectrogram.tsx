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
import type { DataSource } from './data-source';

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
const Waterfall = ({
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

    const yScale = height / MAX_TIME_SLICES;
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    for (let j = 0; j < spectrum.length; j++) {
      const value = spectrum[j];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const rangeVal = max - min;
    const y = 0;
    const iMin = Math.round((spectrum.length / (MAX_FREQ - MIN_FREQ)) * freqRange[0]);
    const iMax = Math.round((spectrum.length / (MAX_FREQ - MIN_FREQ)) * freqRange[1]);
    const freqBinWidth = width / (iMax - iMin);
    ctx.drawImage(canvas, 0, 1);
    for (let j = iMin; j < iMax; j++) {
      const dbValue = spectrum[j];
      const val = (dbValue - min) / rangeVal;
      const r = Math.floor(val * 255);
      const g = Math.floor(val * 128);
      const b = Math.floor((1 - val) * 255);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      const x = (j - iMin) * freqBinWidth;
      ctx.fillRect(x, y, freqBinWidth + 1, yScale);
    }
  }, [width, height, spectrum]);
  return <></>;
};

function Spectrogram({ dataSource }: { dataSource?: DataSource }) {
  const setSpectrogram = useSetAtom(spectrogramAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setPeak = useSetAtom(peakAtom);
  const width = 800;
  const height = 400;
  const [freqRange, setFreqRange] = useState([MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER] as [
    number,
    number,
  ]);
  useEffect(() => {
    dataSource?.setRange(freqRange[0], freqRange[1]);
  }, freqRange);
  useEffect(() => {
    const handleMessage = (e: MessageEvent<SpectrumSliceMessage>) => {
      const { type, spectrum, peakFrequency, peakMagnitude } = e.data;
      if (type !== 'spectrumSlice') return;
      setSpectrogram(spectrum);

      setPeak({
        frequency: peakFrequency,
        magnitude: peakMagnitude,
      });
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
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="image-rendering-pixelated block border border-gray-300 bg-black"
      />
      <Waterfall canvasRef={canvasRef} height={height} width={width} freqRange={freqRange} />
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
