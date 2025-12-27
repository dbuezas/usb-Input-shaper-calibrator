import { useEffect, useState } from 'react';
import { atom, useAtomValue, useSetAtom, type Atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import Spectrogram, {
  SpectrogramControls,
  historicPeakFrequencyAtom,
  peakFrequencyAtom,
} from './Spectrogram';
import type { DataSource } from './data-source';
import { SerialDataSource } from './data-source';
import { SimulationPort } from './simulation-port';
import ShaperSimulator from './ShaperSimulator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Mode = 'simulation' | 'usb';
type Screen = 'analyzer' | 'shaper';

const screenFromTabValue = (v: string): Screen => (v === 'shaper' ? 'shaper' : 'analyzer');

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

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const setAdxlData = useSetAtom(adxlDataAtom);
  const setFrequency = useSetAtom(frequencyAtom);
  const [status, setStatus] = useState('Disconnected');
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  const [mode, setMode] = useState<Mode>('usb');
  const [screen, setScreen] = useState<Screen>('analyzer');
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

  useEffect(() => {
    if (!dataSource) return;
    if (screen !== 'shaper') return;

    // Shaper view is an offline analysis screen; pause acquisition while it is open.
    void dataSource.stop();
    setIsConnected(false);
    setStatus('Disconnected');
  }, [screen, dataSource, setStatus]);

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
              max-hold:{' '}
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
    <div className="mx-auto max-w-6xl p-6 font-sans">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">ADXL Resonance Analyzer</h1>
        <Tabs value={screen} onValueChange={(v) => setScreen(screenFromTabValue(v))}>
          <TabsList>
            <TabsTrigger value="analyzer">Analyzer</TabsTrigger>
            <TabsTrigger value="shaper">Shaper</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className="flex flex-col gap-6 md:flex-row">
        {screen !== 'shaper' && (
          <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-7.5rem)] md:w-80 md:overflow-auto">
            <h1 className="text-2xl font-bold">ADXL Resonance Analyzer</h1>

            <div className="mt-5">
              <div className="text-muted-foreground text-sm">Source</div>
              <div className="border-border mt-2 inline-flex rounded-md border p-1">
                {(
                  [
                    { value: 'usb', label: 'Serial' },
                    { value: 'simulation', label: 'Simulation' },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={mode === opt.value ? 'secondary' : 'ghost'}
                    className="h-8 px-3"
                    aria-pressed={mode === opt.value}
                    onClick={() => setMode(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {!isConnected ? (
                <Button onClick={connect}>Connect to Device</Button>
              ) : (
                <Button onClick={disconnect}>Disconnect</Button>
              )}
            </div>

            <div className="bg-muted mt-5 rounded-lg p-3">
              <div className="text-muted-foreground text-sm">Status</div>
              <div className="mt-1 text-lg">
                <span
                  className={isConnected ? 'text-primary font-bold' : 'text-destructive font-bold'}
                >
                  {status}
                </span>
              </div>
            </div>

            {isConnected && (
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
                    >
                      {axis.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {isConnected && (
              <div className="mt-8">
                <div className="text-muted-foreground text-sm">Spectrogram</div>
                <div className="mt-3">
                  <SpectrogramControls dataSource={dataSource} />
                </div>
              </div>
            )}

            <div className="text-muted-foreground mt-8 text-sm leading-relaxed">
              <p className="my-2">Make sure your device is connected and running the firmware.</p>
              <p className="my-2">
                This app requires a browser that supports the Web Serial API (Chrome, Edge, Opera).
              </p>
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {screen === 'shaper' ? (
            <ShaperSimulator />
          ) : (
            <>
              <div className="flex flex-wrap gap-4">{topTiles}</div>

              {isConnected ? (
                <div className="mt-4">
                  <Spectrogram dataSource={dataSource} />
                </div>
              ) : (
                <div className="border-border bg-muted text-muted-foreground mt-10 rounded-xl border border-dashed p-10 text-center">
                  Connect to a device to view the spectrogram.
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
