import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import Spectrogram from './Spectrogram';
import { SerialService } from './serial-service';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

type PeakInfo = {
  frequency: number;
  magnitude: number;
};

const SAMPLE_RATE_HZ = 1600;
const MAX_DISPLAY_FREQUENCY = SAMPLE_RATE_HZ / 2;
const MIN_FREQUENCY_SLIDER = 0;
const MIN_SLIDER_GAP = 1;

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [adxlData, setAdxlData] = useState<Int16Array<ArrayBufferLike>>();
  const [status, setStatus] = useState('Disconnected');
  const [frequency, setFrequency] = useState(0);
  const [minFrequency, setMinFrequency] = useState(5);
  const [maxFrequency, setMaxFrequency] = useState(150);
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  const [peakInfoByAxis, setPeakInfoByAxis] = useState<Record<'x' | 'y' | 'z', PeakInfo | null>>({
    x: null,
    y: null,
    z: null,
  });
  const serialServiceRef = useRef<SerialService | null>(null);

  useEffect(() => {
    serialServiceRef.current = new SerialService(
      (data) => setAdxlData(data),
      (freq) => setFrequency(freq),
      (stat) => setStatus(stat)
    );

    return () => {
      if (serialServiceRef.current) {
        serialServiceRef.current.disconnect();
      }
    };
  }, []);

  const handlePeakUpdate = useCallback(
    (info: PeakInfo) => {
      setPeakInfoByAxis((prev) => ({ ...prev, [selectedAxis]: info }));
    },
    [selectedAxis]
  );

  const connect = async () => {
    const success = await serialServiceRef.current?.connect();
    if (success) {
      setIsConnected(true);
    }
  };

  const disconnect = async () => {
    await serialServiceRef.current?.disconnect();
    setIsConnected(false);
    setPeakInfoByAxis({ x: null, y: null, z: null });
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

  const currentPeak = peakInfoByAxis[selectedAxis];

  return (
    <div className="max-w-4xl mx-auto p-8 text-center font-sans">
      <h1 className="mb-8 text-4xl font-bold">ADXL Resonance Analyzer</h1>
      <div className="my-4 text-xl">
        <p>
          Status:{' '}
          <span className={isConnected ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
            {status}
          </span>
        </p>
      </div>
      <div className="my-8">
        {!isConnected ? (
          <Button onClick={connect}>Connect to Device</Button>
        ) : (
          <Button onClick={disconnect}>Disconnect</Button>
        )}
      </div>
      <div className="flex justify-center my-8 flex-wrap gap-4">
        <div className="rounded-xl p-6 min-w-[140px] flex-1 max-w-[180px] shadow-sm text-center">
          <h2 className="m-0 mb-4 text-xl">X Axis</h2>
          <div className="text-3xl font-bold text-blue-600 font-mono">{adxlData?.[0]}</div>
        </div>
        <div className="rounded-xl p-6 min-w-[140px] flex-1 max-w-[180px] shadow-sm text-center">
          <h2 className="m-0 mb-4 text-xl">Y Axis</h2>
          <div className="text-3xl font-bold text-blue-600 font-mono">{adxlData?.[1]}</div>
        </div>
        <div className="rounded-xl p-6 min-w-[140px] flex-1 max-w-[180px] shadow-sm text-center">
          <h2 className="m-0 mb-4 text-xl">Z Axis</h2>
          <div className="text-3xl font-bold text-blue-600 font-mono">{adxlData?.[2]}</div>
        </div>
        <div className="rounded-xl p-6 min-w-[140px] flex-1 max-w-[180px] shadow-sm text-center">
          <h2 className="m-0 mb-4 text-xl">Frequency</h2>
          <div className="text-3xl font-bold text-blue-600 font-mono">
            {frequency.toFixed(1)} Hz
          </div>
        </div>
      </div>

      {isConnected && (
        <div className="my-8 flex flex-col items-center">
          <div className="flex items-center gap-4 mb-6">
            <span className="text-sm text-gray-600">Axis:</span>
            <Select
              value={selectedAxis}
              onValueChange={(value) => setSelectedAxis(value as 'x' | 'y' | 'z')}
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
          <div className="flex flex-col items-stretch gap-6 mb-8 w-full max-w-md">
            <div className="flex flex-col items-start min-w-[220px]">
              <label htmlFor="min-frequency-slider" className="text-sm mb-1">
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
            <div className="flex flex-col items-start min-w-[220px]">
              <label htmlFor="max-frequency-slider" className="text-sm mb-1">
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
            selectedAxis={selectedAxis}
            width={800}
            height={300}
            onPeakUpdate={handlePeakUpdate}
            minFrequency={minFrequency}
            maxFrequency={maxFrequency}
            onSetRange={(min, max) => serialServiceRef.current?.setRange(min, max)}
          />
        </div>
      )}

      <div className="mt-8 text-sm leading-relaxed">
        <div className="mb-2">
          <span className="font-medium">Peak ({selectedAxis.toUpperCase()}): </span>
          <strong>
            {currentPeak
              ? `${currentPeak.frequency.toFixed(1)} Hz @ ${currentPeak.magnitude.toFixed(1)}`
              : '—'}
          </strong>
        </div>
        <p className="my-2">Make sure your device is connected and running the firmware.</p>
        <p className="my-2">
          This app requires a browser that supports the Web Serial API (Chrome, Edge, Opera).
        </p>
      </div>
    </div>
  );
}

export default App;
