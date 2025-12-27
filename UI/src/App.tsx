import { useEffect, useState } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import Spectrogram from './Spectrogram';
import type { DataSource } from './data-source';
import { SerialDataSource } from './data-source';
import { SimulationPort } from './simulation-port';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

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
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  const [mode, setMode] = useState<Mode>('usb');
  const [dataSource, setDataSource] = useState<DataSource | undefined>(undefined);

  useEffect(() => {
    return () => void dataSource?.stop();
  }, [dataSource]);

  const connect = async () => {
    await dataSource?.stop();

    const port =
      mode === 'simulation' ? new SimulationPort() : await navigator.serial.requestPort();
    const newDataSource = new SerialDataSource(
      port,
      (data) => setAdxlData(data),
      (freq) => setFrequency(freq),
      (stat) => setStatus(stat)
    );
    setDataSource(newDataSource);
    setStatus('Connecting');

    const success = await newDataSource.start();
    setIsConnected(success);
    if (!success) setStatus('Disconnected');
    return success;
  };

  const disconnect = async () => {
    if (!dataSource) return;
    await dataSource.stop();
    setIsConnected(false);
  };

  const toggleSimulationMode = () => {
    const newMode: Mode = mode === 'simulation' ? 'usb' : 'simulation';
    setMode(newMode);
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
          {mode === 'simulation' ? 'Simulation' : 'Serial'}
        </Button>
      </div>

      <div className="my-8 flex flex-wrap justify-center gap-4">
        <div className="max-w-45 min-w-35 flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">X Axis</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <AdxlData i={0} />
          </div>
        </div>
        <div className="max-w-45 min-w-35 flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">Y Axis</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <AdxlData i={1} />
          </div>
        </div>
        <div className="max-w-45 min-w-35 flex-1 rounded-xl p-6 text-center shadow-sm">
          <h2 className="m-0 mb-4 text-xl">Z Axis</h2>
          <div className="font-mono text-3xl font-bold text-blue-600">
            <AdxlData i={2} />
          </div>
        </div>
        <div className="max-w-45 min-w-35 flex-1 rounded-xl p-6 text-center shadow-sm">
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
            <RadioGroup
              className="flex items-center gap-4"
              value={selectedAxis}
              onValueChange={(value) => {
                const axis = value as 'x' | 'y' | 'z';
                setSelectedAxis(axis);
                dataSource?.setSelectedAxis(axis);
              }}
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="x" />X
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="y" />Y
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="z" />Z
              </label>
            </RadioGroup>
          </div>

          <Spectrogram dataSource={dataSource} />
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
