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
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 font-sans md:flex-row">
      <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-3rem)] md:w-80 md:overflow-auto">
        <h1 className="text-2xl font-bold">ADXL Resonance Analyzer</h1>

        <div className="bg-muted mt-5 rounded-lg p-3">
          <div className="text-muted-foreground text-sm">Status</div>
          <div className="mt-1 text-lg">
            <span className={isConnected ? 'text-primary font-bold' : 'text-destructive font-bold'}>
              {status}
            </span>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
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

        {isConnected && (
          <div className="mt-6">
            <div className="text-muted-foreground text-sm">Axis</div>
            <RadioGroup
              className="mt-2 flex items-center gap-4"
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
        )}

        <div className="text-muted-foreground mt-8 text-sm leading-relaxed">
          <p className="my-2">Make sure your device is connected and running the firmware.</p>
          <p className="my-2">
            This app requires a browser that supports the Web Serial API (Chrome, Edge, Opera).
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-border bg-card rounded-xl border p-6 text-center shadow-sm">
            <h2 className="m-0 mb-4 text-xl">X Axis</h2>
            <div className="text-primary font-mono text-3xl font-bold">
              <AdxlData i={0} />
            </div>
          </div>
          <div className="border-border bg-card rounded-xl border p-6 text-center shadow-sm">
            <h2 className="m-0 mb-4 text-xl">Y Axis</h2>
            <div className="text-primary font-mono text-3xl font-bold">
              <AdxlData i={1} />
            </div>
          </div>
          <div className="border-border bg-card rounded-xl border p-6 text-center shadow-sm">
            <h2 className="m-0 mb-4 text-xl">Z Axis</h2>
            <div className="text-primary font-mono text-3xl font-bold">
              <AdxlData i={2} />
            </div>
          </div>
          <div className="border-border bg-card rounded-xl border p-6 text-center shadow-sm">
            <h2 className="m-0 mb-4 text-xl">Frequency</h2>
            <div className="text-primary font-mono text-3xl font-bold">
              <Frequency /> Hz
            </div>
          </div>
        </div>

        {isConnected ? (
          <div className="mt-8">
            <Spectrogram dataSource={dataSource} />
          </div>
        ) : (
          <div className="border-border bg-muted text-muted-foreground mt-10 rounded-xl border border-dashed p-10 text-center">
            Connect to a device to view the spectrogram.
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
