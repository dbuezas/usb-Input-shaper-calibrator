import { useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { FREQUENCY_SLIDER_RANGE_HZ, SIMPLE_SHAPER_ROUNDING_ACCEL } from '@/constants';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { spectrogramMaxHoldAtom } from '../MeasureScreen/atoms';
import {
  corneringSettingsAtom,
  ftmFsAtom,
  priorityAtom,
  selectedShaperParamsAtom,
  simpleRankingAtom,
} from './atoms';
import GcodePanel from './GcodePanel';
import { peakFromSeries, type ShaperParams } from './input-shaper';
import { ShapedSpectrumPlot } from './ShaperPlots';
import { SHAPER_COLORS } from './shaper-colors';
import { PRIORITIES, PRIORITY_ORDER, type SimpleCandidate } from './simple-shaper';

const sameParams = (a: ShaperParams, b: ShaperParams) =>
  a.type === b.type && a.fHz === b.fHz && a.zeta === b.zeta && a.vtol === b.vtol;

const percent = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
const accel = (v: number) => `${Math.round(v / 100) * 100} mm/s²`;

// A 90° corner as printed (shaper color) over the ideal corner (dashed). Enlarged a lot.
const CORNER_PX_PER_MM = 300;
const CornerPicture = ({ roundingMm, color }: { roundingMm: number; color: string }) => {
  const c = 90; // corner position
  // A quadratic curve through the corner control point passes 0.354·d from the corner.
  const d = Math.min(80, (roundingMm * CORNER_PX_PER_MM) / 0.354);
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" aria-hidden>
      <path
        d={`M 5 ${c} L ${c} ${c} L ${c} 5`}
        fill="none"
        stroke="currentColor"
        strokeDasharray="3 3"
        className="text-muted-foreground"
      />
      <path
        d={`M 5 ${c} L ${c - d} ${c} Q ${c} ${c} ${c} ${c - d} L ${c} 5`}
        fill="none"
        stroke={color}
        strokeWidth={3}
      />
    </svg>
  );
};

const PrioritySlider = () => {
  const [priority, setPriority] = useAtom(priorityAtom);
  return (
    <div className="flex flex-col gap-y-2">
      <div className="text-sm font-medium">What matters more to you?</div>
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
  return (
    <div className="border-border bg-card rounded-xl border p-5" data-testid="simple-selected">
      <div className="text-muted-foreground text-sm">
        {recommended ? 'Recommended for your printer' : 'Your pick'}
      </div>
      <div className="mt-1 text-2xl font-bold">
        <span style={{ color }}>{candidate.params.type.toUpperCase()}</span> at{' '}
        {candidate.fEffHz.toFixed(1)} Hz
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
            Ghost lines next to edges. Lower is better.
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-sm">Max acceleration</div>
          <div className="mt-1 font-mono text-lg">{accel(candidate.maxAccel)}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Faster than this rounds corners more than 0.12 mm.
          </div>
        </div>
        <div className="flex gap-3">
          <div>
            <div className="text-muted-foreground text-sm">Corner rounding</div>
            <div className="mt-1 font-mono text-lg">{candidate.roundingMm.toFixed(2)} mm</div>
            <div className="text-muted-foreground mt-1 text-xs">
              At {SIMPLE_SHAPER_ROUNDING_ACCEL} mm/s². The picture is {CORNER_PX_PER_MM}× larger.
            </div>
          </div>
          <CornerPicture roundingMm={candidate.roundingMm} color={color} />
        </div>
      </div>
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
}) => (
  <div className="border-border overflow-x-auto rounded-xl border">
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-left text-xs">
        <tr>
          <th className="p-2 pl-4">Shaper</th>
          <th className="p-2">Frequency</th>
          <th className="p-2">Ringing left</th>
          <th className="p-2">Max acceleration</th>
          <th className="p-2 pr-4">Corner rounding</th>
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
            <td className="p-2 pr-4">{c.roundingMm.toFixed(2)} mm</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

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
