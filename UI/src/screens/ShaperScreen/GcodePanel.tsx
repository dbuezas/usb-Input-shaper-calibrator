import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Button } from '@/components/ui/button';
import { measureAxisAtom } from '../MeasureScreen/atoms';
import { axisShaperResultsAtom, ftmFsAtom, selectedShaperParamsAtom } from './atoms';
import { buildGcode } from './gcode';
import { computeMarlinShaperTaps } from './input-shaper';

const AXES = ['x', 'y', 'z'] as const;

export default function GcodePanel() {
  const [results, setResults] = useAtom(axisShaperResultsAtom);
  const params = useAtomValue(selectedShaperParamsAtom);
  const measureAxis = useAtomValue(measureAxisAtom);
  const ftmFs = useAtomValue(ftmFsAtom);
  const [saveToEeprom, setSaveToEeprom] = useState(false);
  const [copied, setCopied] = useState(false);

  const gcode = buildGcode(results, { saveToEeprom });
  const firstAxisWithResult = AXES.find((axis) => results[axis]);

  return (
    <div className="flex flex-col gap-y-2">
      <div className="text-muted-foreground text-sm">Marlin G-code</div>
      <div className="text-muted-foreground text-xs">
        Save the current shaper for each axis you measured (measuring: {measureAxis.toUpperCase()}).
      </div>
      <div className="grid grid-cols-3 gap-1">
        {AXES.map((axis) => (
          <Button
            key={axis}
            type="button"
            size="sm"
            variant={axis === measureAxis ? 'secondary' : 'ghost'}
            className="border-border h-8 border"
            onClick={() => setResults((old) => ({ ...old, [axis]: params }))}
          >
            Save as {axis.toUpperCase()}
          </Button>
        ))}
      </div>
      {AXES.filter((axis) => results[axis]).map((axis) => {
        const r = results[axis]!;
        const { fEffHz } = computeMarlinShaperTaps(r, ftmFs);
        return (
          <div key={axis} className="flex items-center justify-between text-xs">
            <span>
              {axis.toUpperCase()}: {r.type.toUpperCase()} {r.fHz.toFixed(1)} Hz (effective{' '}
              {fEffHz.toFixed(1)} Hz)
            </span>
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() =>
                setResults((old) => {
                  const next = { ...old };
                  delete next[axis];
                  return next;
                })
              }
            >
              clear
            </button>
          </div>
        );
      })}
      {firstAxisWithResult && (
        <>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveToEeprom}
              onChange={(e) => setSaveToEeprom(e.target.checked)}
            />
            Add M500 (save to EEPROM)
          </label>
          <textarea
            readOnly
            value={gcode}
            rows={gcode.split('\n').length}
            className="bg-muted w-full resize-none rounded-md p-2 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(gcode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy G-code'}
          </Button>
        </>
      )}
    </div>
  );
}
