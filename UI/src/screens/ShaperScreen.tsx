import { useState } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import { SpectrumPlot } from '@/visualisations/SpectrumPlot';
import {
  FIXED_SAMPLE_RATE,
  SPECTROGRAM_PLOT_WIDTH,
  SPECTROGRAM_WATERFALL_HEIGHT,
} from '@/constants';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  applyShaperToMagnitudeSpectrum,
  applyShaperToWelchPsdDb,
  type InputShaperType,
  type ShaperParams,
  shaperMagnitudeAtHz,
} from '@/input-shaper';
import { spectrogramMaxHoldAtom, welchPsdMaxHoldAtom } from '@/Spectrogram';

type OptimisationResult = { params: ShaperParams; score: number };

const binToHz = (bin: number, bins: number) => bin * (FIXED_SAMPLE_RATE / (2 * (bins - 1)));

const weightedEnergyScore = (magnitudes: number[], shaped: number[], f0Hz: number) => {
  if (!magnitudes.length || magnitudes.length !== shaped.length) return Number.POSITIVE_INFINITY;

  const bins = magnitudes.length;
  const sigmaHz = 8;
  let num = 0;
  let den = 0;

  for (let i = 0; i < bins; i++) {
    const f = binToHz(i, bins);
    const w0 = Math.exp(-0.5 * Math.pow((f - f0Hz) / sigmaHz, 2));
    const w = 0.15 + 0.85 * w0;
    const base = magnitudes[i] ?? 0;
    const out = shaped[i] ?? 0;
    num += w * out * out;
    den += w * base * base;
  }
  return den > 0 ? num / den : Number.POSITIVE_INFINITY;
};

const estimatePeakHz = (magnitudes: number[]) => {
  if (!magnitudes.length) return 55;
  let peakIdx = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    if ((magnitudes[i] ?? 0) > (magnitudes[peakIdx] ?? 0)) peakIdx = i;
  }
  return binToHz(peakIdx, magnitudes.length);
};

const optimiseShaper = (magnitudes: number[]): OptimisationResult | null => {
  if (!magnitudes.length) return null;

  const peakHz = estimatePeakHz(magnitudes);
  const types: InputShaperType[] = ['zv', 'zvd', 'zvdd', 'zvddd', 'mzv', 'ei', '2hei', '3hei'];

  const fMin = Math.max(10, peakHz - 30);
  const fMax = Math.min(200, peakHz + 30);

  const zetas = [0.03, 0.05, 0.07, 0.1, 0.14, 0.18, 0.22, 0.28, 0.34];
  const vtols = [0.02, 0.05, 0.08, 0.1, 0.14, 0.2, 0.28, 0.38];

  let best: OptimisationResult | null = null;

  for (const type of types) {
    for (let f = fMin; f <= fMax; f += 0.5) {
      for (const zeta of zetas) {
        const vtolCandidates = type === 'ei' || type === '2hei' || type === '3hei' ? vtols : [0.1];
        for (const vtol of vtolCandidates) {
          const params: ShaperParams = { type, fHz: f, zeta, vtol };

          // Stability guard: if the chosen f0 makes |H| huge near the measured peak,
          // skip (prevents weird local minima).
          const hPeak = shaperMagnitudeAtHz(params, peakHz);
          if (!Number.isFinite(hPeak) || hPeak > 2.5) continue;

          const shaped = applyShaperToMagnitudeSpectrum(params, magnitudes);
          const score = weightedEnergyScore(magnitudes, shaped, peakHz);
          if (!Number.isFinite(score)) continue;

          // Prefer shorter shapers slightly when scores are close.
          const lengthPenalty =
            type === 'zv'
              ? 0.0
              : type === 'zvd'
                ? 0.002
                : type === 'mzv'
                  ? 0.003
                  : type === 'zvdd'
                    ? 0.006
                    : type === 'ei'
                      ? 0.006
                      : type === '2hei'
                        ? 0.01
                        : type === 'zvddd'
                          ? 0.013
                          : 0.013;
          const total = score + lengthPenalty;

          if (!best || total < best.score) best = { params, score: total };
        }
      }
    }
  }

  return best;
};

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

export default function ShaperScreen() {
  const width = SPECTROGRAM_PLOT_WIDTH;
  const height = SPECTROGRAM_WATERFALL_HEIGHT;

  const [type, setType] = useAtom(shaperTypeAtom);
  const [f0, setF0] = useAtom(shaperF0Atom);
  const [zeta, setZeta] = useAtom(shaperZetaAtom);
  const [vtol, setVtol] = useAtom(shaperVtolAtom);

  const maxHoldSpectrum = useAtomValue(spectrogramMaxHoldAtom);
  const maxHoldWelch = useAtomValue(welchPsdMaxHoldAtom);

  const [isOptimising, setIsOptimising] = useState(false);

  const runAutoOptimise = async () => {
    if (!maxHoldSpectrum.length) return;
    setIsOptimising(true);

    // Yield once so the UI can update the button state before the CPU-heavy search.
    await new Promise((r) => setTimeout(r, 0));

    try {
      const best = optimiseShaper(maxHoldSpectrum);
      if (!best) return;
      setType(best.params.type);
      setF0(best.params.fHz);
      setZeta(best.params.zeta);
      setVtol(best.params.vtol);
    } finally {
      setIsOptimising(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-7.5rem)] md:w-80 md:overflow-auto">
        <div className="text-left">
          <h3 className="text-lg font-semibold">Input Shaper Simulator</h3>
          <div className="text-muted-foreground text-sm">Works from Analyzer max-hold data.</div>
        </div>

        <div className="mt-5">
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
        </div>

        <div className="mt-5">
          <Button
            type="button"
            className="w-full"
            onClick={() => void runAutoOptimise()}
            disabled={!maxHoldSpectrum.length || isOptimising}
          >
            {isOptimising ? 'Optimising…' : 'Auto optimise'}
          </Button>
          {!maxHoldSpectrum.length && (
            <div className="text-muted-foreground mt-2 text-xs">
              Collect max-hold data in Analyzer first.
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-4">
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

        <div className="text-muted-foreground mt-6 text-xs leading-relaxed">
          Uses Marlin FT_MOTION coefficients. Shaped plots apply |H(f)| to magnitude and |H(f)|² to
          Welch PSD.
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="flex flex-col gap-6">
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
      </main>
    </div>
  );
}
