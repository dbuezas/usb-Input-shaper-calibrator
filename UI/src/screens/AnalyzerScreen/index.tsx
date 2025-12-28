import { useEffect, useState } from 'react';
import { atom, useAtomValue, useSetAtom, type Atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import Spectrogram, { SpectrogramControls } from './Spectrogram';
import type { DataSource } from '@/screens/AnalyzerScreen/data-source';
import { SerialDataSource } from '@/screens/AnalyzerScreen/data-source';
import { SimulationPort } from '@/screens/AnalyzerScreen/simulation-port';
import { Button } from '@/components/ui/button';
import { ConfiguredTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { historicPeakFrequencyAtom, peakFrequencyAtom } from './atoms';

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

  const explain = (title: string, accurate: string, intuition: string) => (
    <div className="max-w-[360px] leading-snug">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2">{accurate}</div>
      <div className="text-muted-foreground mt-2">{intuition}</div>
    </div>
  );

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

  type TopTile = {
    key: string;
    title: string;
    value: React.ReactNode;
    tooltip?: React.ReactNode;
  };

  const topTiles = (
    [
      {
        key: 'x',
        title: 'X Axis',
        tooltip: explain(
          'X Axis',
          'Latest raw accelerometer sample on the X axis from the connected sensor (e.g. ADXL345).',
          'Think of it as the “instant snapshot” of vibration on that axis; the spectrogram shows the frequency content over time.'
        ),
        value: <AtomValue atom={formattedAxisValueAtom(0)} />,
      },
      {
        key: 'y',
        title: 'Y Axis',
        tooltip: explain(
          'Y Axis',
          'Latest raw accelerometer sample on the Y axis from the connected sensor.',
          'A quick sanity check that the sensor is alive and you’re reading the right axis.'
        ),
        value: <AtomValue atom={formattedAxisValueAtom(1)} />,
      },
      {
        key: 'z',
        title: 'Z Axis',
        tooltip: explain(
          'Z Axis',
          'Latest raw accelerometer sample on the Z axis from the connected sensor.',
          'Useful to detect mounting/orientation issues (Z often behaves differently from X/Y on a bed-slinger).'
        ),
        value: <AtomValue atom={formattedAxisValueAtom(2)} />,
      },
      {
        key: 'peak',
        title: 'Peak',
        tooltip: explain(
          'Peak',
          'Current dominant resonance frequency detected from the live spectrum for the selected axis. “max” is the highest peak seen so far in this session.',
          'This is usually the “main ringing” frequency. If it’s stable, it’s a good starting point for input shaper tuning.'
        ),
        value: (
          <>
            <div>
              <span className="tabular-nums">
                <AtomValue atom={peakFrequencyAtom} />
              </span>{' '}
              Hz
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              max:{' '}
              <span className="tabular-nums">
                <AtomValue atom={historicPeakFrequencyAtom} />
              </span>{' '}
              Hz
            </div>
          </>
        ),
      },
      {
        key: 'acq',
        title: 'Acquisition',
        tooltip: explain(
          'Acquisition',
          'Current sampling / acquisition rate reported by the data source (how often samples arrive).',
          'If this is low or unstable, the plots and peak detection will be less reliable.'
        ),
        value: (
          <>
            <AtomValue atom={formattedFrequencyAtom} /> Hz
          </>
        ),
      },
    ] satisfies TopTile[]
  ).map((tile) => (
    <Card key={tile.key} className="w-full flex-1 text-center sm:min-w-0">
      <CardHeader className="pb-3">
        {tile.tooltip ? (
          <ConfiguredTooltip>
            <TooltipTrigger asChild>
              <CardTitle className="underline decoration-dotted underline-offset-2">
                {tile.title}
              </CardTitle>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {tile.tooltip}
            </TooltipContent>
          </ConfiguredTooltip>
        ) : (
          <CardTitle>{tile.title}</CardTitle>
        )}
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
              <ConfiguredTooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => void connect('usb')}>Connect</Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {explain(
                    'Connect',
                    'Opens the browser’s Web Serial picker and starts reading accelerometer data from the selected USB serial device.',
                    'Use this when your printer/MCU is plugged in and streaming ADXL data.'
                  )}
                </TooltipContent>
              </ConfiguredTooltip>

              <ConfiguredTooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" onClick={() => void connect('simulation')}>
                    Simulate
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {explain(
                    'Simulate',
                    'Uses a built-in simulated serial port that emits synthetic accelerometer samples.',
                    'Great for testing the UI without hardware; the numbers won’t match a real printer.'
                  )}
                </TooltipContent>
              </ConfiguredTooltip>
            </>
          ) : (
            <ConfiguredTooltip>
              <TooltipTrigger asChild>
                <Button onClick={disconnect}>Disconnect</Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {explain(
                  'Disconnect',
                  'Stops the current data source and releases the serial port.',
                  'Use this before unplugging the device or switching to another port.'
                )}
              </TooltipContent>
            </ConfiguredTooltip>
          )}
        </div>

        <div className="bg-muted mt-5 rounded-lg p-3">
          <ConfiguredTooltip>
            <TooltipTrigger asChild>
              <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Status
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {explain(
                'Status',
                'Connection and acquisition state reported by the data source (connecting, streaming, errors).',
                'If it’s stuck on “Connecting”, it usually means the wrong device, no firmware streaming, or the port is busy.'
              )}
            </TooltipContent>
          </ConfiguredTooltip>
          <div className="mt-1 text-lg">
            <span className={isConnected ? 'text-primary font-bold' : 'text-destructive font-bold'}>
              {status}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <ConfiguredTooltip>
            <TooltipTrigger asChild>
              <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Axis
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {explain(
                'Axis',
                'Selects which accelerometer axis is used for the spectrogram and peak detection.',
                'Pick the axis that matches the direction you’re exciting (X test → X axis is usually most informative).'
              )}
            </TooltipContent>
          </ConfiguredTooltip>
          <div className="border-border mt-2 inline-flex rounded-md border p-1">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <ConfiguredTooltip key={axis}>
                <TooltipTrigger asChild>
                  <Button
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
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {explain(
                    `${axis.toUpperCase()} axis`,
                    `Uses the ${axis.toUpperCase()} channel for plots and peak detection.`,
                    'Choose the axis that shows the clearest resonance peak for your test move.'
                  )}
                </TooltipContent>
              </ConfiguredTooltip>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <ConfiguredTooltip>
            <TooltipTrigger asChild>
              <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Spectrogram
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {explain(
                'Spectrogram',
                'A time-varying frequency plot: for each moment, it shows how strong each frequency is.',
                'It’s like a “heat map” of vibrations over time. A stable bright band indicates a resonance.'
              )}
            </TooltipContent>
          </ConfiguredTooltip>
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
