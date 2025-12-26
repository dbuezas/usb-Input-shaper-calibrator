import { useState, useEffect } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import './App.css';
import Spectrogram from './Spectrogram';
import type { DataSource } from './data-source';
import { SerialDataSource, SimulationDataSource } from './data-source';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { MAX_DISPLAY_FREQUENCY, MIN_FREQUENCY_SLIDER, MIN_SLIDER_GAP } from './constants';

type Mode = 'simulation' | 'usb';

const adxlDataAtom = atom<Int16Array<ArrayBufferLike>>();
const AdxlData = ({ i }: { i: number }) => {
  const adxlData = useAtomValue(adxlDataAtom);
  return adxlData?.[i];
};

const frequencyAtom = atom(0);
const Frequency = () => {
  const frequency = useAtomValue(frequencyAtom);
  return frequency.toFixed(1);
};

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const setAdxlData = useSetAtom(adxlDataAtom);
  const setFrequency = useSetAtom(frequencyAtom);
  const [status, setStatus] = useState('Disconnected');
  const [minFrequency, setMinFrequency] = useState(5);
  const [maxFrequency, setMaxFrequency] = useState(150);
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  console.log('app');
  const [mode, setMode] = useState<Mode>('usb');
  const [dataSource, setDataSource] = useState<DataSource | null>(() => {
    // Initialize with serial data source by default
    return new SerialDataSource(
      (data) => setAdxlData(data),
      (freq) => setFrequency(freq),
      (stat) => setStatus(stat)
    );
  });

  useEffect(() => {
    return () => void dataSource?.stop();
  }, [dataSource]);

  const connect = async () => {
    if (!dataSource) return false;

    const success = await dataSource.start();
    if (success) {
      setIsConnected(true);
    }
    return success;
  };

  const disconnect = async () => {
    if (dataSource) {
      await dataSource.stop();
      setIsConnected(false);
    }
  };

  const toggleSimulationMode = async () => {
    const newMode: Mode = mode === 'simulation' ? 'usb' : 'simulation';

    // Stop current data source
    await dataSource?.stop();

    // Switch data source based on mode
    if (newMode === 'simulation') {
      const simulationDataSource = new SimulationDataSource(
        (data) => setAdxlData(data),
        (freq) => setFrequency(freq),
        (stat) => setStatus(stat)
      );
      setDataSource(simulationDataSource);
      simulationDataSource.start();
      setStatus('Simulation Mode');
      setIsConnected(true);
    } else {
      const serialDataSource = new SerialDataSource(
        (data) => setAdxlData(data),
        (freq) => setFrequency(freq),
        (stat) => setStatus(stat)
      );
      setDataSource(serialDataSource);
      setStatus('Disconnected');
      setIsConnected(false);
    }

    setMode(newMode);
  };

  const handleMinFrequencyChange = (value: number) => {
    const clampedValue = Math.min(
      value,
      Math.max(MIN_FREQUENCY_SLIDER, maxFrequency - MIN_SLIDER_GAP)
    );
    setMinFrequency(Math.max(MIN_FREQUENCY_SLIDER, clampedValue));
  };

  const handleMaxFrequencyChange = (value: number) => {
    const clampedValue = Math.max(
      value,
      Math.min(MAX_DISPLAY_FREQUENCY, minFrequency + MIN_SLIDER_GAP)
    );
    setMaxFrequency(Math.min(MAX_DISPLAY_FREQUENCY, clampedValue));
  };

  return (
    <div className="mx-auto max-w-4xl p-8 text-center font-sans">
      <h1 className="mb-8 text-4xl font-bold">ADXL Resonance Analyzer</h1>
      <div className="my-4 text-xl">
        <p>
          Status:{' '}
          <span className={isConnected ? 'font-bold text-green-600' : 'font-bold text-red-600'}>
            {status}
          </span>
        </p>
      </div>
      <div className="my-8 flex flex-wrap justify-center gap-4">
        {!isConnected ? (
          <Button onClick={connect}>Connect to Device</Button>
        ) : (
          <Button onClick={disconnect}>Disconnect</Button>
        )}
        <Button
          onClick={toggleSimulationMode}
          variant={mode === 'simulation' ? 'secondary' : 'outline'}
        >
          {mode === 'simulation' ? 'Stop Simulation' : 'Start Simulation'}
        </Button>
      </div>
      <div className="my-8 flex flex-wrap justify-center gap-4">
        <div className="max-w-[180px] min-w-[140px] flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">X Axis</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <AdxlData i={0} />
          </div>
        </div>
        <div className="max-w-[180px] min-w-[140px] flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">Y Axis</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <AdxlData i={1} />
          </div>
        </div>
        <div className="max-w-[180px] min-w-[140px] flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">Z Axis</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <AdxlData i={2} />
          </div>
        </div>
        <div className="max-w-[180px] min-w-[140px] flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">Frequency</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <Frequency /> Hz
          </div>
        </div>
      </div>

      {isConnected && (
        <div className="my-8 flex flex-col items-center">
          <div className="mb-6 flex items-center gap-4">
            <span className="text-sm text-gray-600">Axis:</span>
            <Select
              value={selectedAxis}
              onValueChange={(value) => {
                const axis = value as 'x' | 'y' | 'z';
                setSelectedAxis(axis);
                dataSource?.setSelectedAxis(axis);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select axis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="x">X Axis</SelectItem>
                <SelectItem value="y">Y Axis</SelectItem>
                <SelectItem value="z">Z Axis</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mb-8 flex w-full max-w-md flex-col items-stretch gap-6">
            <div className="flex min-w-[220px] flex-col items-start">
              <label htmlFor="min-frequency-slider" className="mb-1 text-sm">
                Min Frequency: {minFrequency} Hz
              </label>
              <Slider
                id="min-frequency-slider"
                min={MIN_FREQUENCY_SLIDER}
                max={MAX_DISPLAY_FREQUENCY}
                step={1}
                value={[minFrequency]}
                onValueChange={(value) => handleMinFrequencyChange(value[0])}
                className="w-full"
              />
            </div>
            <div className="flex min-w-[220px] flex-col items-start">
              <label htmlFor="max-frequency-slider" className="mb-1 text-sm">
                Max Frequency: {maxFrequency} Hz
              </label>
              <Slider
                id="max-frequency-slider"
                min={MIN_FREQUENCY_SLIDER}
                max={MAX_DISPLAY_FREQUENCY}
                step={1}
                value={[maxFrequency]}
                onValueChange={(value) => handleMaxFrequencyChange(value[0])}
                className="w-full"
              />
            </div>
          </div>
          <Spectrogram
            width={800}
            height={300}
            minFrequency={minFrequency}
            maxFrequency={maxFrequency}
            onSetRange={(min, max) => {
              dataSource?.setRange(min, max);
            }}
          />
        </div>
      )}

      <div className="mt-8 text-sm leading-relaxed">
        <p className="my-2">Make sure your device is connected and running the firmware.</p>
        <p className="my-2">
          This app requires a browser that supports the Web Serial API (Chrome, Edge, Opera).
        </p>
      </div>
    </div>
  );
}

export default App;
