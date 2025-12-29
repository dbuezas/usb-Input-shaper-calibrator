import { useState } from 'react';
import InstallFirmwareScreen from '@/screens/InstallFirmwareScreen';
import MeasureScreen from '@/screens/MeasureScreen';
import ShaperScreen from '@/screens/ShaperScreen';
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@/components/ui/stepper';
import { Check, LoaderCircleIcon } from 'lucide-react';
import { REPO_URL } from '@/constants';

type Screen = 'install' | 'measure' | 'shaper';

const steps: { title: string; screen: Screen }[] = [
  {
    title: 'Install firmware',
    screen: 'install',
  },
  {
    title: 'Measure axis',
    screen: 'measure',
  },
  {
    title: 'Optimize shaper',
    screen: 'shaper',
  },
];

const screenFromStep = (step: number): Screen =>
  steps[Math.max(0, Math.min(steps.length - 1, step - 1))].screen;

const stepFromScreen = (screen: Screen): number => {
  const idx = steps.findIndex((s) => s.screen === screen);
  return (idx >= 0 ? idx : 0) + 1;
};

function App() {
  const [screen, setScreen] = useState<Screen>('install');
  const currentStep = stepFromScreen(screen);

  return (
    <div className="mx-auto max-w-7xl p-6 font-sans">
      <header className="mb-6 flex items-center justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Marlin USB Resonance Tester</h1>
          <a
            className="text-muted-foreground mt-1 inline-flex text-xs underline decoration-dotted underline-offset-2"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub repository
          </a>
        </div>

        <Stepper
          value={currentStep}
          onValueChange={(next) => setScreen(screenFromStep(next))}
          indicators={{
            completed: <Check className="size-4" />,
            loading: <LoaderCircleIcon className="size-4 animate-spin" />,
          }}
          className="min-w-90"
        >
          <StepperNav className="items-center gap-2">
            {steps.map((step, index) => (
              <StepperItem key={step.screen} step={index + 1} className="items-center">
                <StepperTrigger className="flex items-center gap-2 px-2">
                  <StepperIndicator>{index + 1}</StepperIndicator>
                  <div className="hidden min-w-0 sm:block">
                    <StepperTitle className="truncate">{step.title}</StepperTitle>
                  </div>
                </StepperTrigger>

                {steps.length > index + 1 && (
                  <StepperSeparator className="group-data-[state=completed]/step:bg-primary" />
                )}
              </StepperItem>
            ))}
          </StepperNav>
        </Stepper>
      </header>

      {screen === 'install' ? (
        <InstallFirmwareScreen />
      ) : screen === 'measure' ? (
        <MeasureScreen />
      ) : (
        <ShaperScreen />
      )}
    </div>
  );
}

export default App;
