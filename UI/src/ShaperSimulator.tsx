import { atom, useAtom, useAtomValue } from 'jotai';
import { SpectrumPlot } from './visualisations/SpectrumPlot';
import { SPECTROGRAM_PLOT_WIDTH, SPECTROGRAM_WATERFALL_HEIGHT } from './constants';
import { Slider } from './components/ui/slider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  applyShaperToMagnitudeSpectrum,
  applyShaperToWelchPsdDb,
  type InputShaperType,
  type ShaperParams,
} from './input-shaper';
import { spectrogramMaxHoldAtom, welchPsdMaxHoldAtom } from './Spectrogram';

const shaperTypeAtom = atom<InputShaperType>('zvd');
const shaperF0Atom = atom(55);
const shaperZetaAtom = atom(0.1);
const shaperVtolAtom = atom(0.1);

const shaperParamsAtom = atom<ShaperParams>((get) => ({
  type: get(shaperTypeAtom),
  fHz: get(shaperF0Atom),
  zeta: get(shaperZetaAtom),
  vtol: get(shaperVtolAtom),
}));

const shapedSpectrumAtom = atom((get) => {
  const base = get(spectrogramMaxHoldAtom);
  if (!base?.length) return [];
  return applyShaperToMagnitudeSpectrum(get(shaperParamsAtom), base);
});

const shapedWelchAtom = atom((get) => {
  const base = get(welchPsdMaxHoldAtom);
  if (!base?.length) return [];
  return applyShaperToWelchPsdDb(get(shaperParamsAtom), base);
});

export default function ShaperSimulator() {
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const [type, setType] = useAtom(shaperTypeAtom);
  const [f0, setF0] = useAtom(shaperF0Atom);
  const [zeta, setZeta] = useAtom(shaperZetaAtom);
  const [vtol, setVtol] = useAtom(shaperVtolAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const maxHoldWelch = useAtomValue(welchPsdMaxHoldAtom);

  return (
    <div className="text-center">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-left">
          <h3 className="font-semibold">Input Shaper Simulator (Max-Hold)</h3>
          <div className="text-muted-foreground text-sm">
            Acquisition is paused while this screen is open.
          </div>
        </div>
      </div>

      <div className="border-border bg-card mx-auto mb-4 w-full max-w-3xl rounded-xl border p-4 text-left">
        <div className="text-muted-foreground text-sm">Shaper</div>
        <div className="border-border mt-2 inline-flex flex-wrap gap-1 rounded-md border p-1">
          {(
            [
              { value: 'zv', label: 'ZV' },
              { value: 'zvd', label: 'ZVD' },
              { value: 'zvdd', label: 'ZVDD' },
              { value: 'zvddd', label: 'ZVDDD' },
              { value: 'mzv', label: 'MZV' },
              { value: 'ei', label: 'EI' },
              { value: '2hei', label: '2HEI' },
              { value: '3hei', label: '3HEI' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={type === opt.value ? 'secondary' : 'ghost'}
              className="h-8"
              aria-pressed={type === opt.value}
              onClick={() => setType(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-muted-foreground text-sm">Resonance f0: {f0} Hz</label>
            <div className="mt-3">
              <Slider
                min={10}
                max={200}
                step={0.5}
                value={[f0]}
                onValueChange={(v) => setF0(v[0] ?? 55)}
                className="w-full"
              />
            </div>
          </div>

          <div>
            <label className="text-muted-foreground text-sm">Damping (ζ): {zeta.toFixed(3)}</label>
            <div className="mt-3">
              <Slider
                min={0}
                max={0.4}
                step={0.005}
                value={[zeta]}
                onValueChange={(v) => setZeta(v[0] ?? 0.1)}
                className="w-full"
              />
            </div>
          </div>

          <div
            className={cn(
              type === 'zv' ||
                type === 'zvd' ||
                type === 'zvdd' ||
                type === 'zvddd' ||
                type === 'mzv'
                ? 'opacity-60'
                : ''
            )}
          >
            <label className="text-muted-foreground text-sm">
              Tolerance (vtol): {vtol.toFixed(3)}
            </label>
            <div className="mt-3">
              <Slider
                min={0}
                max={0.5}
                step={0.005}
                value={[vtol]}
                onValueChange={(v) => setVtol(v[0] ?? 0.1)}
                className="w-full"
                disabled={
                  type === 'zv' ||
                  type === 'zvd' ||
                  type === 'zvdd' ||
                  type === 'zvddd' ||
                  type === 'mzv'
                }
              />
            </div>
          </div>
        </div>

        <div className="text-muted-foreground mt-3 text-xs">
          Uses Marlin FT_MOTION coefficients (ZV/ZVD/ZVDD/ZVDDD/EI/2HEI/3HEI). The plotted “shaped”
          curves apply |H(f)| to the magnitude spectrum and |H(f)|² to Welch PSD.
        </div>
      </div>

      <div className="grid justify-center gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 font-semibold">Spectrum Max-Hold → Shaped</h4>
          <SpectrumPlot
            traces={[
              {
                dataAtom: spectrogramMaxHoldAtom,
                mode: 'line',
                color: 'rgba(0, 220, 255, 0.55)',
              },
              {
                dataAtom: shapedSpectrumAtom,
                mode: 'line',
                color: 'rgba(0, 255, 120, 0.9)',
              },
            ]}
            height={height}
            width={width}
            freqRange={[0, 200]}
            scaleMax={maxHoldSpectrum.length ? Math.max(...maxHoldSpectrum) : undefined}
          />
        </div>

        <div>
          <h4 className="mb-2 font-semibold">Welch PSD Max-Hold → Shaped</h4>
          <SpectrumPlot
            traces={[
              {
                dataAtom: welchPsdMaxHoldAtom,
                mode: 'line',
                color: 'rgba(255, 80, 80, 0.75)',
              },
              {
                dataAtom: shapedWelchAtom,
                mode: 'line',
                color: 'rgba(0, 255, 120, 0.9)',
              },
            ]}
            height={height}
            width={width}
            freqRange={[0, 200]}
            dynamicRangeDb={80}
            scaleMax={maxHoldWelch.length ? Math.max(...maxHoldWelch) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
