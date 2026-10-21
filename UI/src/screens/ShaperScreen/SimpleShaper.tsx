import { useEffect, useId, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  CORNER_SIM_SPEED_MM_S,
  CORNER_SIM_ZETA,
  FREQUENCY_SLIDER_RANGE_HZ,
  PRINT_ACCEL_RANGE,
} from '@/constants';
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
import { peakFromSeries, type ShaperParams } from './input-shaper';
import {
  cornerCutMm,
  NO_SHAPER,
  simulateCorner,
  wallRippleMm,
  type CornerPath,
} from './corner-sim';
import { ShapedSpectrumPlot } from './ShaperPlots';
import { SHAPER_COLORS } from './shaper-colors';
import { PRIORITIES, PRIORITY_ORDER, type SimpleCandidate } from './simple-shaper';

const sameParams = (a: ShaperParams, b: ShaperParams) =>
  a.type === b.type && a.fHz === b.fHz && a.zeta === b.zeta && a.vtol === b.vtol;

const percent = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
const accel = (v: number) => `${Math.round(v / 100) * 100} mm/s²`;
const microns = (mm: number) => `${Math.round(mm * 1000)} µm`;

// Charts of the simulated corner. The scales do not depend on the shaper, so the slider changes
// the shapes, not the axes.
const GRAY = 'var(--color-muted-foreground)';
const PLOT_PX = 130;
const MARGIN_PX = 10;
const CORNER_VIEW_MM = 0.3; // how much of each wall the corner chart shows
const CORNER_PAD_MM = 0.06; // room outside the corner
const WALL_VIEW_MM = 2.5; // how much of the wall after the corner the wall chart shows
const WALL_W_PX = 240;
const MIN_WALL_RANGE_MM = 0.005;

const CornerChart = ({
  shaped,
  none,
  color,
}: {
  shaped: CornerPath;
  none: CornerPath;
  color: string;
}) => {
  const clipId = useId();
  const pxPerMm = PLOT_PX / (CORNER_VIEW_MM + CORNER_PAD_MM);
  const toSvg = ([x, y]: [number, number]) =>
    `${MARGIN_PX + (x + CORNER_VIEW_MM) * pxPerMm},${MARGIN_PX + (CORNER_VIEW_MM - y) * pxPerMm}`;
  const line = (points: [number, number][]) => points.map(toSvg).join(' ');
  const size = PLOT_PX + 2 * MARGIN_PX;
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground text-xs">
        Corner from above, true scale
      </figcaption>
      <svg
        viewBox={`0 0 ${size} ${size + 14}`}
        className="w-40"
        role="img"
        aria-label="Simulated corner"
      >
        <clipPath id={clipId}>
          <rect x={MARGIN_PX} y={MARGIN_PX} width={PLOT_PX} height={PLOT_PX} />
        </clipPath>
        <polyline
          points={line([
            [-CORNER_VIEW_MM, 0],
            [0, 0],
            [0, CORNER_VIEW_MM],
          ])}
          fill="none"
          stroke={GRAY}
          strokeDasharray="3 3"
        />
        <g clipPath={`url(#${clipId})`} fill="none" strokeWidth={2} strokeLinejoin="round">
          <polyline points={line(none.points)} stroke={GRAY} opacity={0.6} />
          <polyline points={line(shaped.points)} stroke={color} />
        </g>
        <line
          x1={MARGIN_PX}
          x2={MARGIN_PX + 0.1 * pxPerMm}
          y1={size + 4}
          y2={size + 4}
          stroke={GRAY}
          strokeWidth={2}
        />
        <text x={MARGIN_PX + 0.1 * pxPerMm + 4} y={size + 8} fontSize={10} fill={GRAY}>
          0.1 mm
        </text>
      </svg>
    </figure>
  );
};

const WallChart = ({
  shaped,
  none,
  color,
}: {
  shaped: CornerPath;
  none: CornerPath;
  color: string;
}) => {
  const clipId = useId();
  // The no-shaper wobble sets the scale (after it has left the corner).
  const rangeMm = Math.max(MIN_WALL_RANGE_MM, 1.2 * wallRippleMm(none, 0.3));
  const toSvg = ([x, y]: [number, number]) =>
    `${MARGIN_PX + (y / WALL_VIEW_MM) * WALL_W_PX},${MARGIN_PX + ((rangeMm - x) / (2 * rangeMm)) * PLOT_PX}`;
  const line = (p: CornerPath) =>
    p.points
      .filter(([, y]) => y >= 0)
      .map(toSvg)
      .join(' ');
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="text-muted-foreground text-xs">
        Wall after the corner: sideways wobble (ghost lines)
      </figcaption>
      <svg
        viewBox={`0 0 ${WALL_W_PX + 2 * MARGIN_PX + 40} ${PLOT_PX + 2 * MARGIN_PX + 14}`}
        className="w-full max-w-80"
        role="img"
        aria-label="Simulated wall wobble"
      >
        <clipPath id={clipId}>
          <rect x={MARGIN_PX} y={MARGIN_PX} width={WALL_W_PX} height={PLOT_PX} />
        </clipPath>
        <line
          x1={MARGIN_PX}
          x2={MARGIN_PX + WALL_W_PX}
          y1={MARGIN_PX + PLOT_PX / 2}
          y2={MARGIN_PX + PLOT_PX / 2}
          stroke={GRAY}
          strokeDasharray="3 3"
        />
        <g clipPath={`url(#${clipId})`} fill="none" strokeWidth={2} strokeLinejoin="round">
          <polyline points={line(none)} stroke={GRAY} opacity={0.6} />
          <polyline points={line(shaped)} stroke={color} />
        </g>
        <g fontSize={10} fill={GRAY}>
          <text x={MARGIN_PX + WALL_W_PX + 4} y={MARGIN_PX + 8}>
            +{microns(rangeMm)}
          </text>
          <text x={MARGIN_PX + WALL_W_PX + 4} y={MARGIN_PX + PLOT_PX / 2 + 3}>
            0
          </text>
          <text x={MARGIN_PX + WALL_W_PX + 4} y={MARGIN_PX + PLOT_PX}>
            −{microns(rangeMm)}
          </text>
          <text x={MARGIN_PX} y={PLOT_PX + 2 * MARGIN_PX + 10}>
            corner
          </text>
          <text x={MARGIN_PX + WALL_W_PX} y={PLOT_PX + 2 * MARGIN_PX + 10} textAnchor="end">
            {WALL_VIEW_MM} mm
          </text>
        </g>
      </svg>
    </figure>
  );
};

const CornerSimulation = ({
  shaped,
  none,
  color,
  peakHz,
}: {
  shaped: CornerPath;
  none: CornerPath;
  color: string;
  peakHz: number;
}) => (
  <div className="mt-4">
    <div className="flex flex-wrap gap-6">
      <CornerChart shaped={shaped} none={none} color={color} />
      <WallChart shaped={shaped} none={none} color={color} />
    </div>
    <div className="text-muted-foreground mt-1 text-xs">
      Simulated print of a square corner. Colored: this shaper. Gray: no shaper. Dashed: the perfect
      path. Uses your {peakHz.toFixed(0)} Hz resonance (damping {CORNER_SIM_ZETA}), your
      acceleration, and walls at {CORNER_SIM_SPEED_MM_S} mm/s.
    </div>
  </div>
);

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
  const none = useMemo(
    () => simulateCorner(NO_SHAPER, peakHz, printAccel, cornering),
    [peakHz, printAccel, cornering]
  );
  const shaped = useMemo(
    () => simulateCorner(candidate.taps, peakHz, printAccel, cornering),
    [candidate.taps, peakHz, printAccel, cornering]
  );
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
            Ghost lines after edges. Lower is better.
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-sm">Corner rounding</div>
          <div className="mt-1 font-mono text-lg" data-testid="simple-rounding">
            {microns(cornerCutMm(shaped))}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">
            How much the corner is cut, at your {printAccel} mm/s². Lower is better.
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-sm">Max acceleration</div>
          <div className="mt-1 font-mono text-lg">{accel(candidate.maxAccel)}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Above this, corners get too round (Klipper's smoothing limit).
          </div>
        </div>
      </div>
      <CornerSimulation shaped={shaped} none={none} color={color} peakHz={peakHz} />
      {printAccel > candidate.maxAccel && (
        <div className="mt-3 rounded-md bg-amber-500/15 p-2 text-sm">
          Your {printAccel} mm/s² is above the max acceleration of this shaper. Corners get too
          round. Print slower, or move the slider to the left.
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
  peakHz,
}: {
  ranking: SimpleCandidate[];
  selected: ShaperParams;
  onPick: (c: SimpleCandidate) => void;
  peakHz: number;
}) => {
  const printAccel = useAtomValue(printAccelAtom);
  const cornering = useAtomValue(corneringSettingsAtom);
  const cuts = useMemo(
    () => ranking.map((c) => cornerCutMm(simulateCorner(c.taps, peakHz, printAccel, cornering))),
    [ranking, peakHz, printAccel, cornering]
  );
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="p-2 pl-4">Shaper</th>
            <th className="p-2">Frequency</th>
            <th className="p-2">Ringing left</th>
            <th className="p-2">Max acceleration</th>
            <th className="p-2 pr-4">Corner cut at {printAccel} mm/s²</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {ranking.map((c, i) => (
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
              <td className="p-2 pr-4">{microns(cuts[i] ?? 0)}</td>
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
                peakHz={peakHz}
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
