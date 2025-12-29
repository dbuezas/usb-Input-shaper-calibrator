import { useState } from 'react';
import MeasureScreen from '@/screens/MeasureScreen';
import ShaperScreen from '@/screens/ShaperScreen';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Screen = 'measure' | 'shaper';

const screenFromTabValue = (v: string): Screen => (v === 'shaper' ? 'shaper' : 'measure');

function App() {
  const [screen, setScreen] = useState<Screen>('measure');

  return (
    <div className="mx-auto max-w-6xl p-6 font-sans">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">ADXL Resonance Measure</h1>
        <Tabs value={screen} onValueChange={(v) => setScreen(screenFromTabValue(v))}>
          <TabsList>
            <TabsTrigger value="measure">Measure</TabsTrigger>
            <TabsTrigger value="shaper">Shaper</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {screen === 'shaper' ? <ShaperScreen /> : <MeasureScreen />}
    </div>
  );
}

export default App;
