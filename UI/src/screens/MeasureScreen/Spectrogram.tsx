import { useEffect, useMemo } from 'react';
import type { SpectrumSliceMessage } from '@/screens/MeasureScreen/messages';
import { spectrogramChannel } from '@/screens/MeasureScreen/messages';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import {
  ACTUAL_RESOLUTION,
  MAX_FREQUENCY_SLIDER,
  MIN_FREQUENCY_SLIDER,
  SPECTROGRAM_MAX_TIME_SLICES,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
} from '@/constants';
import type { DataSource } from '@/screens/MeasureScreen/data-source';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import { Waterfall } from '@/visualisations/Waterfall';
import { historicPeakAtom, peakAtom, spectrogramMaxHoldAtom } from './atoms';

const spectrogramAtom = atom<Float32Array>(new Float32Array());

const spectrogramScaleMaxAtom = atom<number | undefined>(undefined);

export function SpectrogramControls() {
  return null;
}

const peakFromSeries = (series: Float32Array, freqRangeHz: [number, number]) => {
  let max = Number.NEGATIVE_INFINITY;
  let peakIdx = -1;
  const freqStepHz = ACTUAL_RESOLUTION || 1;
  const [fMinHz, fMaxHz] = freqRangeHz;
  const start = Math.max(0, Math.floor(fMinHz / freqStepHz));
  const end = Math.min(series.length - 1, Math.floor(fMaxHz / freqStepHz));

  for (let i = start; i <= end; i++) {
    const v = series[i];
    if (v > max) {
      max = v;
      peakIdx = i;
    }
  }
  if (peakIdx < 0) return undefined;
  return peakIdx * ACTUAL_RESOLUTION;
};

const updateMaxHold = (prev: Float32Array | undefined, nextSlice: Float32Array) => {
  if (!prev?.length || prev.length !== nextSlice.length) return nextSlice;
  const next = prev.slice();
  for (let i = 0; i < nextSlice.length; i++) next[i] = Math.max(next[i], nextSlice[i]);
  return next;
};

function Spectrogram({ dataSource: _dataSource }: { dataSource?: DataSource }) {
  const setSpectrogram = useSetAtom(spectrogramAtom);
  const setSpectrogramMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const setSpectrogramScaleMax = useSetAtom(spectrogramScaleMaxAtom);
  const setPeak = useSetAtom(peakAtom);
  const setHistoricPeak = useSetAtom(historicPeakAtom);
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;
  const freqRange = useMemo(
    () => [MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER] as [number, number],
    []
  );
  const spectrogramScaleMax = useAtomValue(spectrogramScaleMaxAtom);

  useEffect(() => {
    const handleMessage = (e: MessageEvent<SpectrumSliceMessage>) => {
      const msg = e.data;
      setSpectrogram(msg.spectrum);
      setSpectrogramScaleMax((prev) => {
        let next = prev ?? Number.NEGATIVE_INFINITY;
        for (const v of msg.spectrum) next = Math.max(next, v);
        return next === Number.NEGATIVE_INFINITY ? undefined : next;
      });
      setSpectrogramMaxHold((prev) => {
        const next = updateMaxHold(prev, msg.spectrum);
        setHistoricPeak(peakFromSeries(next, freqRange));
        return next;
      });
    };

    spectrogramChannel.addEventListener('message', handleMessage);
    return () => {
      spectrogramChannel.removeEventListener('message', handleMessage);
    };
  }, [freqRange, setHistoricPeak, setSpectrogram, setSpectrogramMaxHold, setSpectrogramScaleMax]);

  return (
    <div className="text-center">
      <h3 className="mb-2 font-semibold">Live Waterfall Spectrogram</h3>

      <Waterfall
        height={height}
        width={width}
        freqRange={freqRange}
        dataAtom={spectrogramAtom}
        scaleMax={spectrogramScaleMax}
        onPeakFrequency={(freqHz) => setPeak(freqHz)}
      />
      <>
        <h3 className="mt-4 mb-2 font-semibold">Last Spectrum and Max Hold</h3>
        <SpectrumPlot
          traces={[
            {
              dataAtom: spectrogramAtom,
              mode: 'points',
              color: 'rgba(0, 220, 255, 0.9)',
            },
            {
              dataAtom: spectrogramMaxHoldAtom,
              mode: 'line',
              color: 'rgba(0, 220, 255, 0.55)',
            },
          ]}
          height={height}
          width={width}
          freqRange={freqRange}
          scaleMax={spectrogramScaleMax}
        />
      </>
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm">
        <span>Resolution: {(ACTUAL_RESOLUTION || 1).toFixed(2)} Hz/bin</span>
        <span>Time Slices: {SPECTROGRAM_MAX_TIME_SLICES}</span>
      </div>
    </div>
  );
}

export default Spectrogram;
