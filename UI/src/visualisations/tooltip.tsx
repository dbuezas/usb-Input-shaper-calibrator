import type { PlotHover } from './plot-hover';

export const Tooltip = ({ hover }: { hover: PlotHover }) => {
  if (!hover.visible) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-black/80 px-2 py-1 text-left text-xs text-white shadow"
      style={{ left: hover.x + 10, top: hover.y + 10 }}
    >
      {hover.title && <div className="mb-1 font-semibold">{hover.title}</div>}
      {hover.lines.map((l, i) => (
        <div key={i} className="text-white/90">
          {l}
        </div>
      ))}
    </div>
  );
};
