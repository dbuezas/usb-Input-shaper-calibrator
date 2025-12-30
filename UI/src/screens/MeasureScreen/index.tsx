import { useEffect, useState } from 'react';
import { atom, useAtomValue, useSetAtom, type Atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import Spectrogram, { SpectrogramControls } from './Spectrogram';
import type { DataSource } from '@/screens/MeasureScreen/data-source';
import { SerialDataSource } from '@/screens/MeasureScreen/data-source';
import { SimulationPort } from '@/screens/MeasureScreen/simulation-port';
import { Button } from '@/components/ui/button';
import { ExplainTooltip } from '@/components/ExplainTooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  historicPeakAtom,
  historicPeakFrequencyAtom,
  peakAtom,
  peakFrequencyAtom,
  spectrogramMaxHoldAtom,
} from './atoms';
import { Slider } from '@/components/ui/slider';

const DEFAULT_SIMULATION_SWEEP_S = 20;

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

export default function MeasureScreen() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectedKind, setConnectedKind] = useState<'usb' | 'simulation' | null>(null);
  const setAdxlData = useSetAtom(adxlDataAtom);
  const setFrequency = useSetAtom(frequencyAtom);
  const clearMaxHold = useSetAtom(spectrogramMaxHoldAtom);
  const clearPeak = useSetAtom(peakAtom);
  const clearHistoricPeak = useSetAtom(historicPeakAtom);
  const [status, setStatus] = useState('Disconnected');
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  const [dataSource, setDataSource] = useState<DataSource | undefined>(undefined);
  const [simulationSweepSeconds, setSimulationSweepSeconds] = useState(DEFAULT_SIMULATION_SWEEP_S);
  const [simulationPort, setSimulationPort] = useState<SimulationPort | null>(null);

  useEffect(() => {
    return () => void dataSource?.stop();
  }, [dataSource]);

  const connect = async (kind: 'usb' | 'simulation') => {
    await dataSource?.stop();

    const port =
      kind === 'simulation'
        ? new SimulationPort({ sweepSeconds: simulationSweepSeconds })
        : await navigator.serial.requestPort();
    setSimulationPort(kind === 'simulation' ? (port as SimulationPort) : null);
    setConnectedKind(kind);
    const newDataSource = new SerialDataSource(
      port,
      (data) => setAdxlData(data),
      (freq) => setFrequency(freq),
      (stat) => setStatus(stat)
    );
    newDataSource.setSelectedAxis(selectedAxis);
    setDataSource(newDataSource);
    setStatus('Connecting');

    const success = await newDataSource.start();
    setIsConnected(success);
    if (!success) {
      setStatus('Disconnected');
      setConnectedKind(null);
      setSimulationPort(null);
    }
    return success;
  };

  const disconnect = async () => {
    if (!dataSource) return;
    await dataSource.stop();
    setIsConnected(false);
    setSimulationPort(null);
    setConnectedKind(null);
  };

  type TopTile = {
    key: string;
    title: string;
    value: React.ReactNode;
    tooltip?: { title: React.ReactNode; accurate: React.ReactNode; intuition: React.ReactNode };
  };

  const topTiles = (
    [
      {
        key: 'x',
        title: 'X Axis',
        tooltip: {
          title: 'X Axis',
          accurate: (
            <>
              Latest raw accelerometer sample on the <b>X</b> axis from the connected sensor (e.g.
              <code className="font-mono">ADXL345</code>).
            </>
          ),
          intuition: (
            <>
              Think of it as the “instant snapshot” of vibration on that axis; the spectrogram shows
              the frequency content over time.
            </>
          ),
        },
        value: <AtomValue atom={formattedAxisValueAtom(0)} />,
      },
      {
        key: 'y',
        title: 'Y Axis',
        tooltip: {
          title: 'Y Axis',
          accurate: (
            <>
              Latest raw accelerometer sample on the <b>Y</b> axis from the connected sensor.
            </>
          ),
          intuition: (
            <>A quick sanity check that the sensor is alive and you’re reading the right axis.</>
          ),
        },
        value: <AtomValue atom={formattedAxisValueAtom(1)} />,
      },
      {
        key: 'z',
        title: 'Z Axis',
        tooltip: {
          title: 'Z Axis',
          accurate: (
            <>
              Latest raw accelerometer sample on the <b>Z</b> axis from the connected sensor.
            </>
          ),
          intuition: (
            <>
              Useful to detect mounting/orientation issues (<b>Z</b> often behaves differently from
              <b>X/Y</b> on a bed-slinger).
            </>
          ),
        },
        value: <AtomValue atom={formattedAxisValueAtom(2)} />,
      },
      {
        key: 'peak',
        title: 'Peak',
        tooltip: {
          title: 'Peak',
          accurate: (
            <>
              Current dominant resonance frequency detected from the live spectrum for the selected
              axis. <i>max</i> is the highest peak seen so far in this session.
            </>
          ),
          intuition: (
            <>
              This is usually the “main ringing” frequency. If it’s stable, it’s a good starting
              point for input shaper tuning.
            </>
          ),
        },
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
        tooltip: {
          title: 'Acquisition',
          accurate: (
            <>
              Current sampling / acquisition rate reported by the data source (how often samples
              arrive).
            </>
          ),
          intuition: (
            <>If this is low or unstable, the plots and peak detection will be less reliable.</>
          ),
        },
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
        <ExplainTooltip
          title={tile.tooltip.title}
          accurate={tile.tooltip.accurate}
          intuition={tile.tooltip.intuition}
        >
          <CardTitle className="underline decoration-dotted underline-offset-2">
            {tile.title}
          </CardTitle>
        </ExplainTooltip>
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
              <ExplainTooltip
                title="Connect"
                accurate={
                  <>
                    Opens the browser’s <b>Web Serial</b> picker and starts reading accelerometer
                    data from the selected USB serial device.
                  </>
                }
                intuition={
                  <>Use this when your printer/MCU is plugged in and streaming ADXL data.</>
                }
                side="right"
                sideOffset={8}
              >
                <Button onClick={() => void connect('usb')}>Connect</Button>
              </ExplainTooltip>

              <ExplainTooltip
                title="Simulate"
                accurate={
                  <>
                    Uses a built-in simulated serial port that emits <i>synthetic</i> accelerometer
                    samples.
                  </>
                }
                intuition={
                  <>
                    Great for testing the UI without hardware; the numbers won’t match a real
                    printer.
                  </>
                }
                side="right"
                sideOffset={8}
              >
                <Button variant="secondary" onClick={() => void connect('simulation')}>
                  Simulate
                </Button>
              </ExplainTooltip>
            </>
          ) : (
            <ExplainTooltip
              title="Disconnect"
              accurate={<>Stops the current data source and releases the serial port.</>}
              intuition={<>Use this before unplugging the device or switching to another port.</>}
              side="right"
              sideOffset={8}
            >
              <Button onClick={() => void disconnect()}>Disconnect</Button>
            </ExplainTooltip>
          )}
        </div>

        {/* Only show simulation controls while the simulator is actively running. */}
        {isConnected && connectedKind === 'simulation' && (
          <div className="border-border mt-3 rounded-lg border p-3">
            <ExplainTooltip
              title="Simulation sweep"
              accurate={
                <>
                  Controls how many seconds the simulated resonance sweep takes to go from{' '}
                  <b>min</b> to <b>max</b> frequency before wrapping.
                </>
              }
              intuition={
                <>Lower values sweep faster (more “animated”), higher values sweep slower.</>
              }
              side="right"
              sideOffset={8}
            >
              <label className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
                Simulation sweep: {simulationSweepSeconds.toFixed(1)} s
              </label>
            </ExplainTooltip>
            <div className="mt-3">
              <Slider
                min={0.5}
                max={60}
                step={0.5}
                value={[simulationSweepSeconds]}
                onValueChange={(v) => {
                  const next = v[0] ?? DEFAULT_SIMULATION_SWEEP_S;
                  setSimulationSweepSeconds(next);
                  simulationPort?.setSweepSeconds(next);
                }}
                className="w-full"
              />
            </div>
          </div>
        )}

        <div className="bg-muted mt-5 rounded-lg p-3">
          <ExplainTooltip
            title="Status"
            accurate={
              <>
                Connection and acquisition state reported by the data source (<i>connecting</i>,
                <i> streaming</i>, errors).
              </>
            }
            intuition={
              <>
                If it’s stuck on <b>Connecting</b>, it usually means the wrong device, no firmware
                streaming, or the port is busy.
              </>
            }
            side="right"
            sideOffset={8}
          >
            <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Status
            </div>
          </ExplainTooltip>
          <div className="mt-1 text-lg">
            <span className={isConnected ? 'text-primary font-bold' : 'text-destructive font-bold'}>
              {status}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <ExplainTooltip
            title="Axis"
            accurate={
              <>Selects which accelerometer axis is used for the spectrogram and peak detection.</>
            }
            intuition={
              <>
                Pick the axis that matches the direction you’re exciting (X test → <b>X</b> axis is
                usually most informative).
              </>
            }
            side="right"
            sideOffset={8}
          >
            <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Axis
            </div>
          </ExplainTooltip>
          <div className="border-border mt-2 inline-flex rounded-md border p-1">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <ExplainTooltip
                key={axis}
                title={`${axis.toUpperCase()} axis`}
                accurate={
                  <>
                    Uses the <b>{axis.toUpperCase()}</b> channel for plots and peak detection.
                  </>
                }
                intuition={
                  <>Choose the axis that shows the clearest resonance peak for your test move.</>
                }
              >
                <Button
                  type="button"
                  size="sm"
                  variant={selectedAxis === axis ? 'secondary' : 'ghost'}
                  className="h-8 px-3"
                  aria-pressed={selectedAxis === axis}
                  onClick={() => {
                    setSelectedAxis(axis);
                    dataSource?.setSelectedAxis(axis);

                    // Axis changes invalidate max-hold + peak stats.
                    clearMaxHold(new Float32Array());
                    clearPeak(undefined);
                    clearHistoricPeak(undefined);
                  }}
                >
                  {axis.toUpperCase()}
                </Button>
              </ExplainTooltip>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <ExplainTooltip
            title="Spectrogram"
            accurate={
              <>
                A time-varying frequency plot: for each moment, it shows how strong each frequency
                is.
              </>
            }
            intuition={
              <>
                It’s like a “heat map” of vibrations over time. A stable bright band indicates a
                resonance.
              </>
            }
            side="right"
            sideOffset={8}
          >
            <div className="text-muted-foreground text-sm underline decoration-dotted underline-offset-2">
              Spectrogram
            </div>
          </ExplainTooltip>
          <div className="mt-3">
            <SpectrogramControls />
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
