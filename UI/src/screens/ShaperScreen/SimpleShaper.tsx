import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { FREQUENCY_SLIDER_RANGE_HZ, PRINT_ACCEL_RANGE } from '@/constants';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import {
  corneringSettingsAtom,
  ftmFsAtom,
  printAccelAtom,
  priorityAtom,
  selectedShaperParamsAtom,
  simpleRankingAtom,
} from './atoms';
import GcodePanel from './GcodePanel';
import { peakFromSeries, type CorneringSettings, type ShaperParams } from './input-shaper';
import { klipperSmoothing } from './shaper-scores/klipper';
import { ShapedSpectrumPlot } from './ShaperPlots';
import { SHAPER_COLORS } from './shaper-colors';
import { PRIORITIES, PRIORITY_ORDER, type SimpleCandidate } from './simple-shaper';

const sameParams = (a: ShaperParams, b: ShaperParams) =>
  a.type === b.type && a.fHz === b.fHz && a.zeta === b.zeta && a.vtol === b.vtol;

const percent = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
const accel = (v: number) => `${Math.round(v / 100) * 100} mm/s²`;
const roundingAt = (c: SimpleCandidate, printAccel: number, cornering: CorneringSettings) =>
  klipperSmoothing(c.taps.a, c.taps.t, printAccel, cornering);

// A 90° corner as printed (shaper color) over the ideal corner (dashed), seen from above.
// The rounding is to scale (enlarged). The ripples after the corner only show the relative ringing.
const CORNER_PX_PER_MM = 100;
const RIPPLE_PX_PER_RINGING = 60;
const CornerPicture = ({
  roundingMm,
  ringing,
  color,
}: {
  roundingMm: number;
  ringing: number;
  color: string;
}) => {
  const c = 90; // corner position
  // A quadratic curve through the corner control point passes 0.354·d from the corner.
  const d = Math.min(70, (roundingMm * CORNER_PX_PER_MM) / 0.354);
  const amplitude = Math.min(8, ringing * RIPPLE_PX_PER_RINGING);
  const ripple: string[] = [];
  for (let y = c - d; y >= 5; y -= 1) {
    const s = c - d - y;
    ripple.push(`${c + amplitude * Math.sin(s / 2.5) * Math.exp(-s / 30)} ${y}`);
  }
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0" aria-hidden>
      <path
        d={`M 5 ${c} L ${c} ${c} L ${c} 5`}
        fill="none"
        stroke="currentColor"
        strokeDasharray="3 3"
        className="text-muted-foreground"
      />
      <path
        d={`M 5 ${c} L ${c - d} ${c} Q ${c} ${c} ${c} ${c - d} L ${ripple.join(' L ')}`}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
      />
    </svg>
  );
};

const PrioritySlider = () => {
  const [priority, setPriority] = useAtom(priorityAtom);
  return (
    <div className="flex flex-col gap-y-2">
      <div className="text-sm font-medium">What matters more to you?</div>
      <div className="text-muted-foreground text-xs">
        Every shaper trades ringing (ghost lines after edges) against corner rounding. You pick the
        balance.
      </div>
      <Slider
        min={0}
        max={PRIORITY_ORDER.length - 1}
        step={1}
        value={[PRIORITY_ORDER.indexOf(priority)]}
        onValueChange={([i]) => setPriority(PRIORITY_ORDER[i] ?? 'balanced')}
        aria-label="Priority"
        className="mt-2 w-full"
      />
      <div className="grid grid-cols-3 text-xs">
        {PRIORITY_ORDER.map((p, i) => (
          <button
            key={p}
            type="button"
            onClick={() => setPriority(p)}
            className={cn(
              i === 0 ? 'text-left' : i === 1 ? 'text-center' : 'text-right',
              p === priority ? 'text-foreground font-semibold' : 'text-muted-foreground'
            )}
          >
            {PRIORITIES[p].label}
          </button>
        ))}
      </div>
      <div className="text-muted-foreground text-xs" data-testid="priority-description">
        {PRIORITIES[priority].description}
      </div>
    </div>
  );
};

const PrintAccelInput = () => {
  const [printAccel, setPrintAccel] = useAtom(printAccelAtom);
  const [text, setText] = useState(String(printAccel));
  return (
    <div className="flex flex-col gap-y-2">
      <label className="text-sm font-medium" htmlFor="print-accel">
        Your print acceleration (mm/s²)
      </label>
      <input
        id="print-accel"
        type="number"
        min={PRINT_ACCEL_RANGE[0]}
        max={PRINT_ACCEL_RANGE[1]}
        step={500}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (v >= PRINT_ACCEL_RANGE[0] && v <= PRINT_ACCEL_RANGE[1]) setPrintAccel(v);
        }}
        className="bg-muted w-full rounded-md p-1 text-sm"
      />
      <div className="text-muted-foreground text-xs">
        Corners round more at higher acceleration. Used only to show the rounding.
      </div>
    </div>
  );
};

const Assumptions = () => {
  const cornering = useAtomValue(corneringSettingsAtom);
  const ftmFs = useAtomValue(ftmFsAtom);
  const corneringText =
    cornering.model === 'junction_deviation'
      ? `Junction deviation ${cornering.value} mm`
      : cornering.model === 'jerk'
        ? `Classic jerk ${cornering.value} mm/s`
        : `SCV ${cornering.value} mm/s`;
  return (
    <div className="bg-muted text-muted-foreground rounded-lg p-3 text-xs leading-relaxed">
      Your printer settings (Marlin defaults): {corneringText}, FTM_FS {ftmFs} Hz. Different on your
      printer? Change them in <b>Advanced</b>.
    </div>
  );
};

const whyText = (c: SimpleCandidate, peakHz: number, recommended: boolean) => {
  const above = c.fEffHz > peakHz * 1.05;
  const where = above
    ? `Tuned to ${c.fEffHz.toFixed(0)} Hz, above your ${peakHz.toFixed(0)} Hz peak: its notch is wide enough to still cover the peak, and a higher frequency rounds corners less.`
    : `Tuned to your ${peakHz.toFixed(0)} Hz peak.`;
  if (!c.meetsTarget) return `${where} It cannot get the ringing under the limit you picked.`;
  return recommended ? `${where} Highest acceleration of all shapers for your choice.` : where;
};

const SelectedCard = ({
  candidate,
  recommended,
  peakHz,
}: {
  candidate: SimpleCandidate;
  recommended: boolean;
  peakHz: number;
}) => {
  const color = SHAPER_COLORS[candidate.params.type];
  const printAccel = useAtomValue(printAccelAtom);
  const cornering = useAtomValue(corneringSettingsAtom);
  const roundingMm = roundingAt(candidate, printAccel, cornering);
  return (
    <div className="border-border bg-card rounded-xl border p-5" data-testid="simple-selected">
      <div className="text-muted-foreground text-sm">
        {recommended ? 'Recommended for your printer' : 'Your pick'}
      </div>
      <div className="mt-1 text-2xl font-bold">
        <span style={{ color }}>{candidate.params.type.toUpperCase()}</span> at{' '}
        {candidate.fEffHz.toFixed(1)} Hz
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <div className="grid flex-1 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground text-sm">Ringing left</div>
            <div className="mt-1 font-mono text-lg">{percent(candidate.ringing)}</div>
            <div className="bg-muted mt-1 h-2 w-full rounded">
              <div
                className="h-2 rounded"
                style={{
                  width: `${Math.min(100, (candidate.ringing / 0.2) * 100)}%`,
                  background: color,
                }}
              />
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              Ghost lines after edges. Lower is better.
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-sm">Corner rounding</div>
            <div className="mt-1 font-mono text-lg" data-testid="simple-rounding">
              {roundingMm.toFixed(2)} mm
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              At your {printAccel} mm/s². Lower is better.
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-sm">Max acceleration</div>
            <div className="mt-1 font-mono text-lg">{accel(candidate.maxAccel)}</div>
            <div className="text-muted-foreground mt-1 text-xs">
              Above this, corners round more than 0.12 mm.
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center">
          <CornerPicture roundingMm={roundingMm} ringing={candidate.ringing} color={color} />
          <div className="text-muted-foreground w-28 text-center text-[10px] leading-tight">
            A corner from above. Rounding {CORNER_PX_PER_MM}× larger.
          </div>
        </div>
      </div>
      {printAccel > candidate.maxAccel && (
        <div className="mt-3 rounded-md bg-amber-500/15 p-2 text-sm">
          Your {printAccel} mm/s² is above the max acceleration of this shaper. Corners round more
          than 0.12 mm. Print slower, or move the slider to the left.
        </div>
      )}
      <div className="mt-4 text-sm">{whyText(candidate, peakHz, recommended)}</div>
    </div>
  );
};

const ShaperTable = ({
  ranking,
  selected,
  onPick,
}: {
  ranking: SimpleCandidate[];
  selected: ShaperParams;
  onPick: (c: SimpleCandidate) => void;
}) => {
  const printAccel = useAtomValue(printAccelAtom);
  const cornering = useAtomValue(corneringSettingsAtom);
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="p-2 pl-4">Shaper</th>
            <th className="p-2">Frequency</th>
            <th className="p-2">Ringing left</th>
            <th className="p-2">Max acceleration</th>
            <th className="p-2 pr-4">Rounding at {printAccel} mm/s²</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {ranking.map((c) => (
            <tr
              key={c.params.type}
              data-testid={`shaper-row-${c.params.type}`}
              onClick={() => onPick(c)}
              className={cn(
                'border-border hover:bg-muted/60 cursor-pointer border-t',
                sameParams(c.params, selected) && 'bg-muted',
                !c.meetsTarget && 'text-muted-foreground'
              )}
            >
              <td className="p-2 pl-4 font-sans font-semibold">
                <span style={{ color: SHAPER_COLORS[c.params.type] }}>
                  {c.params.type.toUpperCase()}
                </span>
              </td>
              <td className="p-2">{c.fEffHz.toFixed(1)} Hz</td>
              <td className="p-2">
                {percent(c.ringing)}
                {!c.meetsTarget && <span className="font-sans text-xs"> (over limit)</span>}
              </td>
              <td className="p-2">{accel(c.maxAccel)}</td>
              <td className="p-2 pr-4">{roundingAt(c, printAccel, cornering).toFixed(2)} mm</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function SimpleShaper() {
  const ranking = useAtomValue(simpleRankingAtom);
  const maxHold = useAtomValue(spectrogramMaxHoldAtom);
  const [selected, setSelected] = useAtom(selectedShaperParamsAtom);
  const recommended = ranking.at(0);

  // A new ranking (other priority or new data) selects its recommendation.
  useEffect(() => {
    if (recommended) setSelected(recommended.params);
  }, [recommended, setSelected]);

  const current = ranking.find((c) => sameParams(c.params, selected)) ?? recommended;
  const peakHz = peakFromSeries(maxHold, FREQUENCY_SLIDER_RANGE_HZ);

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="border-border bg-card flex w-full flex-col gap-y-5 rounded-xl border p-5 shadow-sm md:w-80">
        <div>
          <h3 className="text-lg font-semibold">Optimize shaper</h3>
          <div className="text-muted-foreground text-sm">
            Pick what matters more. The app finds the best shaper for your printer.
          </div>
        </div>
        <PrioritySlider />
        <PrintAccelInput />
        <Assumptions />
        <GcodePanel />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        {!current ? (
          <div className="border-border text-muted-foreground rounded-xl border p-5">
            No measurement yet. Go to step 2 (Measure axis) and measure an axis first.
          </div>
        ) : (
          <>
            <SelectedCard
              candidate={current}
              recommended={current === recommended}
              peakHz={peakHz}
            />
            <div>
              <h4 className="mb-1 font-semibold">All shapers</h4>
              <div className="text-muted-foreground mb-2 text-xs">
                Each shaper at its best frequency for your choice. Click a row to use it instead.
              </div>
              <ShaperTable
                ranking={ranking}
                selected={selected}
                onPick={(c) => setSelected(c.params)}
              />
            </div>
            <div>
              <h4 className="mb-1 font-semibold">Before and after</h4>
              <div className="text-muted-foreground mb-2 text-xs">
                Blue: your measured vibration. Green: what is left with this shaper.
              </div>
              <ShapedSpectrumPlot showAnalysisRange={false} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
