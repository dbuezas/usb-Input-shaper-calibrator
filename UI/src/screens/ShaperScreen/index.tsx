import ShaperSideBar from './ShaperSideBar';
import ShaperPlots from './ShaperPlots';

export default function ShaperScreen() {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="border-border bg-card w-full rounded-xl border p-5 shadow-sm md:sticky md:top-6 md:h-[calc(100vh-7.5rem)] md:w-80 md:overflow-auto">
        <ShaperSideBar />
      </aside>
      <main className="min-w-0 flex-1">
        <ShaperPlots />
      </main>
    </div>
  );
}
