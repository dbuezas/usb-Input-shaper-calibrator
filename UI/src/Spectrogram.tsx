import { useEffect } from 'react';
import type { SpectrumSliceMessage, WelchPsdSliceMessage } from './messages';
import { spectrogramChannel } from './messages';
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ACTUAL_RESOLUTION, MAX_FREQUENCY_SLIDER, MIN_FREQUENCY_SLIDER } from './constants';
import { Slider } from './components/ui/slider';
import type { DataSource } from './data-source';
import { SpectrumPlot } from './visualisations/SpectrumPlot';
import { Waterfall } from './visualisations/Waterfall';
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
  const setPeak = useSetAtom(peakAtom);
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
        maxTimeSlices={MAX_TIME_SLICES}
        onPeakFrequency={(freqHz) => setPeak(freqHz)}
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
