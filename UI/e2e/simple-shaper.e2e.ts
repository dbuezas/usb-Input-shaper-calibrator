import { expect, test } from '@playwright/test';

test('simple shaper mode recommends a shaper and gives G-code', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await page.getByRole('tab', { name: 'Optimize shaper' }).click();
  await expect(page.getByText('No measurement yet')).toBeVisible();

  await page.getByRole('tab', { name: 'Measure axis' }).click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  // Sweep 1-200 Hz in 2 s instead of 20 s.
  const sweep = page.getByRole('slider');
  await sweep.focus();
  await sweep.press('Home');
  for (let i = 0; i < 3; i++) await sweep.press('ArrowRight');
  await expect
    .poll(async () => Number(await page.getByTestId('historic-peak').textContent()), {
      timeout: 30_000,
    })
    .toBeGreaterThan(50);
  await page.waitForTimeout(3000);

  await page.getByRole('tab', { name: 'Optimize shaper' }).click();
  const selected = page.getByTestId('simple-selected');
  await expect(selected).toContainText('Recommended for your printer');
  await expect(page.locator('[data-testid^="shaper-row-"]')).toHaveCount(8);

  // Clean surfaces: less ringing allowed, so the description changes.
  await page.getByRole('button', { name: 'Clean surfaces' }).click();
  await expect(page.getByTestId('priority-description')).toContainText('Least ringing');

  // Picking another row makes it "your pick".
  const recommendedName = (await selected.locator('span').first().textContent()) ?? '';
  const other = page
    .locator('[data-testid^="shaper-row-"]')
    .filter({ hasNotText: recommendedName })
    .first();
  await other.click();
  await expect(selected).toContainText('Your pick');

  await page.getByRole('button', { name: 'Save as X' }).click();
  await expect(page.locator('textarea')).toContainText('M493 X');

  // Advanced shows the full optimiser again.
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByRole('button', { name: 'Full auto tune all shapers' })).toBeVisible();
  expect(errors).toEqual([]);
});
