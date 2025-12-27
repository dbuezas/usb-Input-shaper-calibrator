import { useEffect, useRef, useState } from 'react';

export type PlotHover = {
  visible: boolean;
  x: number;
  y: number;
  title?: string;
  lines: string[];
};

export const useRafThrottledHover = () => {
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<PlotHover | null>(null);
  const [hover, setHover] = useState<PlotHover>({ visible: false, x: 0, y: 0, lines: [] });

  const flush = () => {
    rafRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) setHover(next);
  };

  const set = (next: PlotHover) => {
    pendingRef.current = next;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  };

  const hide = () => {
    pendingRef.current = { visible: false, x: 0, y: 0, lines: [] };
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { hover, setHover: set, hideHover: hide };
};

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
