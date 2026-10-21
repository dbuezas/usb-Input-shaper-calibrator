import { useAtom } from 'jotai';
import { Button } from '@/components/ui/button';
import ShaperSideBar from './ShaperSideBar';
import ShaperPlots from './ShaperPlots';
import SimpleShaper from './SimpleShaper';
import { shaperUiModeAtom } from './atoms';

const MODES = [
  { mode: 'simple', label: 'Simple' },
  { mode: 'advanced', label: 'Advanced' },
] as const;

export default function ShaperScreen() {
  const [uiMode, setUiMode] = useAtom(shaperUiModeAtom);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <div className="border-border grid grid-cols-2 gap-1 rounded-md border p-1">
          {MODES.map(({ mode, label }) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={uiMode === mode ? 'secondary' : 'ghost'}
              className="h-8 px-4"
              aria-pressed={uiMode === mode}
              onClick={() => setUiMode(mode)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {uiMode === 'simple' ? (
        <SimpleShaper />
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:top-6 md:w-80">
            <ShaperSideBar />
          </aside>
          <main className="min-w-0 flex-1">
            <ShaperPlots />
          </main>
        </div>
      )}
    </div>
  );
}
