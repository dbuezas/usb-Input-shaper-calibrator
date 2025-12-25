import { useRef, useEffect, useState, useMemo } from 'react';
import type { SpectrumSliceMessage } from './messages';
import { spectrogramChannel } from './messages';

type PeakInfo = {
  frequency: number;
  magnitude: number;
};

interface FrequencyRange {
  min: number;
  max: number;
  resolution: number;
}

interface SpectrogramProps {
  selectedAxis: 'x' | 'y' | 'z';
  width?: number;
  height?: number;
  onPeakUpdate?: (info: PeakInfo) => void;
  minFrequency?: number;
  maxFrequency?: number;
  onSetAxis?: (axis: 'x' | 'y' | 'z') => void;
  onSetRange?: (min: number, max: number) => void;
}

const DEFAULT_FREQUENCY_RANGE: FrequencyRange = {
  min: 0,
  max: 800,
  resolution: 1,
};

const clampSliderRange = (range: FrequencyRange, minFrequency: number, maxFrequency: number) => {
  const clampedMin = Math.max(Math.min(minFrequency, range.max), range.min);
  const clampedMax = Math.min(Math.max(maxFrequency, range.min), range.max);
  return { min: clampedMin, max: Math.max(clampedMin, clampedMax) };
};

const getBinRange = (
  spectrumLength: number,
  range: FrequencyRange,
  minFrequency: number,
  maxFrequency: number
) => {
  if (!spectrumLength) {
    return { startBin: 0, endBin: -1 };
  }

  const { min: startFreq, max: endFreq } = clampSliderRange(range, minFrequency, maxFrequency);
  const resolution = range.resolution > 0 ? range.resolution : 1;

  const rawStart = Math.floor((startFreq - range.min) / resolution);
  const rawEnd = Math.ceil((endFreq - range.min) / resolution);

  const normalizedStart = Math.max(0, Math.min(spectrumLength - 1, rawStart));
  const normalizedEnd = Math.max(normalizedStart, Math.min(spectrumLength - 1, rawEnd));

  return { startBin: normalizedStart, endBin: normalizedEnd };
};

function Spectrogram({
  selectedAxis,
  width = 800,
  height = 300,
  onPeakUpdate,
  minFrequency = DEFAULT_FREQUENCY_RANGE.min,
  maxFrequency = DEFAULT_FREQUENCY_RANGE.max,
  onSetRange,
}: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const MAX_TIME_SLICES = 100;
  const spectrograms: number[][] = useMemo(
    () => Array.from({ length: MAX_TIME_SLICES }).map(() => []),
    []
  );
  const [lastIndex, setLastIndex] = useState(0);
  const [freqRange, setFreqRange] = useState<FrequencyRange>(DEFAULT_FREQUENCY_RANGE);
  // console.log('spectro');
  useEffect(() => {
    const handleMessage = (e: MessageEvent<SpectrumSliceMessage>) => {
      const { type, spectrum, freqRange: workerRange, peakFrequency, peakMagnitude } = e.data;
      if (type !== 'spectrumSlice') return;
      setLastIndex((lastIndex) => {
        const next = (lastIndex + 1) % MAX_TIME_SLICES;
        spectrograms[next] = spectrum;
        return next;
      });

      setFreqRange(workerRange);

      if (onPeakUpdate) {
        onPeakUpdate({
          frequency: peakFrequency,
          magnitude: peakMagnitude,
        });
      }
    };

    spectrogramChannel.addEventListener('message', handleMessage);
    return () => {
      spectrogramChannel.removeEventListener('message', handleMessage);
    };
  }, [onPeakUpdate, spectrograms]);

  useEffect(() => {
    onSetRange?.(minFrequency, maxFrequency);
  }, [minFrequency, maxFrequency, onSetRange]);

  useEffect(() => {
    const slice = spectrograms[lastIndex];
    if (!slice.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { startBin, endBin } = getBinRange(slice.length, freqRange, minFrequency, maxFrequency);

    const binCount = endBin - startBin + 1;
    const freqBinWidth = width / Math.max(binCount, 1);
    const yScale = height / spectrograms.length;
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    for (let j = startBin; j <= endBin; j++) {
      const value = slice[j];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const rangeVal = max - min;
    const y = 0; //(spectrograms.length - lastIndex) * yScale;
    ctx.drawImage(canvas, 0, 1);
    for (let j = startBin; j <= endBin; j++) {
      const dbValue = slice[j];
      const val = (dbValue - min) / rangeVal;
      const r = Math.floor(val * 255);
      const g = Math.floor(val * 128);
      const b = Math.floor((1 - val) * 255);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      const x = (j - startBin) * freqBinWidth;
      ctx.fillRect(x, y, freqBinWidth + 1, yScale);
    }
  }, [spectrograms, selectedAxis, width, height, freqRange, minFrequency, maxFrequency, lastIndex]);

  const sliderRange = clampSliderRange(freqRange, minFrequency, maxFrequency);

  return (
    <div className="text-center">
      <h3 className="mb-4 text-2xl font-semibold">Live Waterfall Spectrogram</h3>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="image-rendering-pixelated block border border-gray-300 bg-black"
      />
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm">
        <span>
          Displaying: {sliderRange.min.toFixed(1)}-{sliderRange.max.toFixed(1)} Hz
        </span>
        <span>
          Worker span: {freqRange.min.toFixed(1)}-{freqRange.max.toFixed(1)} Hz
        </span>
        <span>Resolution: {(freqRange.resolution || 1).toFixed(2)} Hz/bin</span>
        <span>Time Slices: {MAX_TIME_SLICES}</span>
      </div>
    </div>
  );
}

export default Spectrogram;
