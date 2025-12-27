import { useState } from 'react';
import AnalyzerScreen from '@/screens/AnalyzerScreen';
import ShaperScreen from '@/screens/ShaperScreen';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Screen = 'analyzer' | 'shaper';

const screenFromTabValue = (v: string): Screen => (v === 'shaper' ? 'shaper' : 'analyzer');

function App() {
  const [screen, setScreen] = useState<Screen>('analyzer');

  return (
    <div className="mx-auto max-w-6xl p-6 font-sans">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">ADXL Resonance Analyzer</h1>
        <Tabs value={screen} onValueChange={(v) => setScreen(screenFromTabValue(v))}>
          <TabsList>
            <TabsTrigger value="analyzer">Analyzer</TabsTrigger>
            <TabsTrigger value="shaper">Shaper</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {screen === 'shaper' ? <ShaperScreen /> : <AnalyzerScreen />}
    </div>
  );
}

export default App;
