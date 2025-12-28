import { useEffect } from 'react';
import type {
  SpectrumSliceMessage,
  WelchPsdSliceMessage,
  WindowFunctionType,
} from '@/screens/AnalyzerScreen/messages';
import { spectrogramChannel } from '@/screens/AnalyzerScreen/messages';
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
import type { DataSource } from '@/screens/AnalyzerScreen/data-source';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import { Waterfall } from '@/visualisations/Waterfall';
import { Button } from '@/components/ui/button';
import { historicPeakAtom, peakAtom, spectrogramMaxHoldAtom, welchPsdMaxHoldAtom } from './atoms';

const spectrogramAtom = atom<number[]>([]);
const welchPsdAtom = atom<number[]>([]);

const spectrogramScaleMaxAtom = atom<number | undefined>(undefined);
const welchPsdScaleMaxAtom = atom<number | undefined>(undefined);

const windowFunctionAtom = atom<WindowFunctionType>('hann');
const viewAtom = atom<'spectrum' | 'welch'>('welch');
const freqRangeAtom = atom<[number, number]>([MIN_FREQUENCY_SLIDER, MAX_FREQUENCY_SLIDER]);

export function SpectrogramControls({ dataSource }: { dataSource?: DataSource }) {
  const [windowFunction, setWindowFunction] = useAtom(windowFunctionAtom);
  const [view, setView] = useAtom(viewAtom);
  const [freqRange, setFreqRange] = useAtom(freqRangeAtom);
  const setSpectrogramMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const setWelchPsdMaxHold = useSetAtom(welchPsdMaxHoldAtom);
  const setSpectrogramScaleMax = useSetAtom(spectrogramScaleMaxAtom);
  const setWelchPsdScaleMax = useSetAtom(welchPsdScaleMaxAtom);
  const setHistoricPeak = useSetAtom(historicPeakAtom);

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
  const setWelchPsd = useSetAtom(welchPsdAtom);
  const setWelchPsdMaxHold = useSetAtom(welchPsdMaxHoldAtom);
  const setSpectrogramScaleMax = useSetAtom(spectrogramScaleMaxAtom);
  const setWelchPsdScaleMax = useSetAtom(welchPsdScaleMaxAtom);
  const setPeak = useSetAtom(peakAtom);
  const setHistoricPeak = useSetAtom(historicPeakAtom);
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;
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
          const next = updateMaxHold(prev, msg.spectrum);
          setHistoricPeak(peakFromSeries(next));
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
          const next = updateMaxHold(prev, msg.psd);
          setHistoricPeak(peakFromSeries(next));
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
      <h3 className="mb-2 font-semibold">Live Waterfall Spectrogram</h3>

      <Waterfall
        height={height}
        width={width}
        freqRange={freqRange}
        dataAtom={view === 'spectrum' ? spectrogramAtom : welchPsdAtom}
        scaleMax={activeScaleMax}
        onPeakFrequency={(freqHz) => setPeak(freqHz)}
      />
      {view === 'spectrum' ? (
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
      ) : (
        <>
          <h3 className="mt-4 mb-2 font-semibold">Welch PSD (Scatter)</h3>
          <SpectrumPlot
            traces={[
              {
                dataAtom: welchPsdAtom,
                mode: 'points',
                color: 'rgba(255, 180, 0, 0.9)',
              },
              {
                dataAtom: welchPsdMaxHoldAtom,
                mode: 'line',
                color: 'rgba(255, 80, 80, 0.95)',
              },
            ]}
            height={height}
            width={width}
            freqRange={freqRange}
            scaleMax={welchPsdScaleMax}
          />
        </>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm">
        <span>Resolution: {(ACTUAL_RESOLUTION || 1).toFixed(2)} Hz/bin</span>
        <span>Time Slices: {SPECTROGRAM_MAX_TIME_SLICES}</span>
      </div>
    </div>
  );
}

export default Spectrogram;
