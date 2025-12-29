import { useEffect } from 'react';
import type { SpectrumSliceMessage } from '@/screens/MeasureScreen/messages';
import { spectrogramChannel } from '@/screens/MeasureScreen/messages';
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  ACTUAL_RESOLUTION,
  MAX_FREQUENCY_SLIDER,
  MIN_FREQUENCY_SLIDER,
  SPECTROGRAM_MAX_TIME_SLICES,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
} from '@/constants';
import { Slider } from '@/components/ui/slider';
import type { DataSource } from '@/screens/MeasureScreen/data-source';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import { Waterfall } from '@/visualisations/Waterfall';
import { ExplainTooltip } from '@/components/ExplainTooltip';
import { historicPeakAtom, peakAtom, spectrogramMaxHoldAtom } from './atoms';

const spectrogramAtom = atom<number[]>([]);

const spectrogramScaleMaxAtom = atom<number | undefined>(undefined);
const freqRangeAtom = atom<[number, number]>([MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER]);

export function SpectrogramControls() {
  const [freqRange, setFreqRange] = useAtom(freqRangeAtom);
  const setSpectrogramMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const setSpectrogramScaleMax = useSetAtom(spectrogramScaleMaxAtom);
  const setHistoricPeak = useSetAtom(historicPeakAtom);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ExplainTooltip
          title="Window function"
          accurate={
            <>
              The FFT isn’t run on the whole stream at once — it’s run on short time chunks
              (“windows”). This app always uses a <b>Hann</b> window.
            </>
          }
          intuition={
            <>
              A Hann window fades the chunk edges toward zero, reducing fake “extra bumps” around a
              real peak while keeping peaks readable.
            </>
          }
          side="right"
          sideOffset={8}
        >
          <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
            Window: Hann
          </div>
        </ExplainTooltip>
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
            setSpectrogramScaleMax(undefined);
            setHistoricPeak(undefined);
          }}
        >
          Clear Max-Hold
        </button>
      </div>
    </div>
  );
}

const peakFromSeries = (series: number[]) => {
  let max = Number.NEGATIVE_INFINITY;
  let peakIdx = -1;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v > max) {
      max = v;
      peakIdx = i;
    }
  }
  if (peakIdx < 0) return undefined;
  return peakIdx * ACTUAL_RESOLUTION;
};

const updateMaxHold = (prev: number[] | undefined, nextSlice: number[]) => {
  if (!prev?.length || prev.length !== nextSlice.length) return [...nextSlice];
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
  const freqRange = useAtomValue(freqRangeAtom);
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
        setHistoricPeak(peakFromSeries(next));
        return next;
      });
    };

    spectrogramChannel.addEventListener('message', handleMessage);
    return () => {
      spectrogramChannel.removeEventListener('message', handleMessage);
    };
  }, [setHistoricPeak, setSpectrogram, setSpectrogramMaxHold, setSpectrogramScaleMax]);

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
        <h3 className="mt-4 mb-2 font-semibold">Last Spectrum (Scatter)</h3>
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
