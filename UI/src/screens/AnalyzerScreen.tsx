import { useEffect, useState } from 'react';
import { atom, useAtomValue, useSetAtom, type Atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import Spectrogram, {
  SpectrogramControls,
  historicPeakFrequencyAtom,
  peakFrequencyAtom,
} from '@/Spectrogram';
import type { DataSource } from '@/data-source';
import { SerialDataSource } from '@/data-source';
import { SimulationPort } from '@/simulation-port';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const adxlDataAtom = atom<Int16Array<ArrayBufferLike>>();
const frequencyAtom = atom(0);

const formattedAxisValueAtom = atomFamily((i: number) =>
  atom((get) => {
    const data = get(adxlDataAtom);
    const value = data?.[i];
    return value == null ? '' : String(value);
  })
);

const formattedFrequencyAtom = atom((get) => get(frequencyAtom).toFixed(1));
const formattedPeakFrequencyAtom = atom((get) => get(peakFrequencyAtom));
const formattedHistoricPeakFrequencyAtom = atom((get) => get(historicPeakFrequencyAtom));

const AtomValue = ({ atom }: { atom: Atom<string> }) => {
  const value = useAtomValue(atom);
  return <>{value}</>;
};

export default function AnalyzerScreen() {
  const [isConnected, setIsConnected] = useState(false);
  const setAdxlData = useSetAtom(adxlDataAtom);
  const setFrequency = useSetAtom(frequencyAtom);
  const [status, setStatus] = useState('Disconnected');
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  const [dataSource, setDataSource] = useState<DataSource | undefined>(undefined);

  useEffect(() => {
    return () => void dataSource?.stop();
  }, [dataSource]);

  const connect = async (kind: 'usb' | 'simulation') => {
    await dataSource?.stop();

    const port =
      kind === 'simulation' ? new SimulationPort() : await navigator.serial.requestPort();
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

  const topTiles = (
    [
      { key: 'x', title: 'X Axis', value: <AtomValue atom={formattedAxisValueAtom(0)} /> },
      { key: 'y', title: 'Y Axis', value: <AtomValue atom={formattedAxisValueAtom(1)} /> },
      { key: 'z', title: 'Z Axis', value: <AtomValue atom={formattedAxisValueAtom(2)} /> },
      {
        key: 'peak',
        title: 'Peak',
        value: (
          <>
            <div>
              <span className="tabular-nums">
                <AtomValue atom={formattedPeakFrequencyAtom} />
              </span>{' '}
              Hz
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              max:{' '}
              <span className="tabular-nums">
                <AtomValue atom={formattedHistoricPeakFrequencyAtom} />
              </span>{' '}
              Hz
            </div>
          </>
        ),
      },
      {
        key: 'acq',
        title: 'Acquisition',
        value: (
          <>
            <AtomValue atom={formattedFrequencyAtom} /> Hz
          </>
        ),
      },
    ] as const
  ).map((tile) => (
    <Card key={tile.key} className="w-full flex-1 text-center sm:min-w-0">
      <CardHeader className="pb-3">
        <CardTitle>{tile.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div>{tile.value}</div>
      </CardContent>
    </Card>
  ));

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-7.5rem)] md:w-80 md:overflow-auto">
        <div className="mt-5 flex flex-col gap-3">
          {!isConnected ? (
            <>
              <Button onClick={() => void connect('usb')}>Connect</Button>
              <Button variant="secondary" onClick={() => void connect('simulation')}>
                Simulate
              </Button>
            </>
          ) : (
            <Button onClick={disconnect}>Disconnect</Button>
          )}
        </div>

        <div className="bg-muted mt-5 rounded-lg p-3">
          <div className="text-muted-foreground text-sm">Status</div>
          <div className="mt-1 text-lg">
            <span className={isConnected ? 'text-primary font-bold' : 'text-destructive font-bold'}>
              {status}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-muted-foreground text-sm">Axis</div>
          <div className="border-border mt-2 inline-flex rounded-md border p-1">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <Button
                key={axis}
                type="button"
                size="sm"
                variant={selectedAxis === axis ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                aria-pressed={selectedAxis === axis}
                onClick={() => {
                  setSelectedAxis(axis);
                  dataSource?.setSelectedAxis(axis);
                }}
                disabled={!isConnected}
              >
                {axis.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <div className="text-muted-foreground text-sm">Spectrogram</div>
          <div className="mt-3">
            <SpectrogramControls dataSource={dataSource} />
          </div>
          {!isConnected && (
            <div className="text-muted-foreground mt-2 text-xs">
              Connect or simulate to start acquisition.
            </div>
          )}
        </div>

        <div className="text-muted-foreground mt-8 text-sm leading-relaxed">
          <p className="my-2">Make sure your device is connected and running the firmware.</p>
          <p className="my-2">
            This app requires a browser that supports the Web Serial API (Chrome, Edge, Opera).
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-4">{topTiles}</div>

        <div className="mt-4">
          <Spectrogram dataSource={dataSource} />
        </div>

        {!isConnected && (
          <div className="text-muted-foreground mt-2 text-sm">
            No data yet — click <span className="font-medium">Connect</span> or{' '}
            <span className="font-medium">Simulate</span> to start acquisition.
          </div>
        )}
      </main>
    </div>
  );
}
