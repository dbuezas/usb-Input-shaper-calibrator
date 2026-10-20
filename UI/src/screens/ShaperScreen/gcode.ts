import { isEiFamily, MARLIN_SHAPER_CODE, type ShaperParams } from './input-shaper';

type Axis = 'x' | 'y' | 'z';

// Marlin parses the same A/I/Q values the optimiser used; FTM_FS rounding happens in the firmware.
// M493 (Marlin/src/gcode/feature/ft_motion/M493.cpp): an M493 without an axis letter applies to X *and* Y,
// so every line names its axis. `C` is applied before `A`/`I`/`Q` on the same line.
export const formatM493 = (axis: Axis, { type, fHz, zeta, vtol }: ShaperParams) =>
  `M493 ${axis.toUpperCase()} C${MARLIN_SHAPER_CODE[type]} A${fHz.toFixed(1)} I${zeta.toFixed(3)}` +
  (isEiFamily(type) ? ` Q${vtol.toFixed(3)}` : '');

// Non-FT INPUT_SHAPING_X/Y/Z (M593) only implements ZV.
export const formatM593 = (axis: Axis, { fHz, zeta }: ShaperParams) =>
  `M593 ${axis.toUpperCase()} F${fHz.toFixed(1)} D${zeta.toFixed(3)}`;

export const buildGcode = (
  results: Partial<Record<Axis, ShaperParams>>,
  { saveToEeprom }: { saveToEeprom: boolean }
) => {
  const axes = (['x', 'y', 'z'] as const).filter((axis) => results[axis]);
  if (!axes.length) return '';

  const lines: string[] = ['; Fixed-Time Motion (FT_MOTION) input shaping'];
  for (const axis of axes) lines.push(formatM493(axis, results[axis]!));
  if (saveToEeprom) lines.push('M500 ; save settings to EEPROM');

  const zvAxes = axes.filter((axis) => results[axis]!.type === 'zv');
  if (zvAxes.length) {
    lines.push('', '; Classic INPUT_SHAPING_[XYZ] (without FT_MOTION) only supports ZV');
    for (const axis of zvAxes) lines.push(formatM593(axis, results[axis]!));
    if (saveToEeprom) lines.push('M500');
  }
  return lines.join('\n');
};
