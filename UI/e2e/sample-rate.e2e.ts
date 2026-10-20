import { expect, test, type Page } from '@playwright/test';

// The simulator's X axis resonates at 55 Hz (see `resonators` in src/screens/MeasureScreen/simulation-port.ts).
// If the UI used the wrong sample rate, the peak would show at 110 Hz (1600 Hz data read as 3200 Hz).
const RESONANCE_HZ = 55;

const readNumber = async (page: Page, testId: string) =>
  Number((await page.getByTestId(testId).textContent()) || NaN);

const startSimulation = async (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByRole('tab', { name: 'Measure axis' }).click();
  await page.getByRole('button', { name: 'Simulate' }).click();

  // Sweep 1-200 Hz in 5 s instead of 20 s.
  const sweep = page.getByRole('slider');
  await sweep.focus();
  await sweep.press('Home'); // 0.5 s
  for (let i = 0; i < 9; i++) await sweep.press('ArrowRight'); // +0.5 s each
  return errors;
};

const expectSensor = async (page: Page, sampleRate: number) => {
  await expect(page.getByTestId('expected-sample-rate')).toHaveText(String(sampleRate));
  // relative error of the measured sample rate (updated every 0.5 s)
  await expect
    .poll(
      async () =>
        Math.abs((await readNumber(page, 'measured-sample-rate')) - sampleRate) / sampleRate,
      {
        timeout: 15_000,
      }
    )
    .toBeLessThan(0.1);
  await expect
    .poll(async () => Math.abs((await readNumber(page, 'historic-peak')) - RESONANCE_HZ), {
      timeout: 30_000,
    })
    .toBeLessThan(3);
};

test('ADXL345 at 3200 Hz', async ({ page }) => {
  const errors = await startSimulation(page);
  await expectSensor(page, 3200);
  expect(errors).toEqual([]);
});

test('LIS2DW12 at 1600 Hz, switched while running', async ({ page }) => {
  const errors = await startSimulation(page);
  await page.getByRole('button', { name: /LIS2DW12/ }).click();
  await expectSensor(page, 1600);

  // The shaper screen works with the shorter 1600 Hz spectrum.
  await page.getByRole('tab', { name: 'Optimize shaper' }).click();
  await page.getByRole('button', { name: 'Save as X' }).click();
  await expect(page.locator('textarea')).toContainText('M493 X');
  expect(errors).toEqual([]);
});
