import { expect, test } from '@playwright/test';

// GPLv3 section 5(d) and the attribution term in NOTICE.
test('footer shows author, license, no warranty, source and credits', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByTestId('legal-notices');
  await expect(footer).toContainText('Marlin USB Resonance Tester by David Buezas');
  await expect(footer).toContainText('no warranty');
  await expect(footer.getByRole('link', { name: 'GPL-3.0-or-later' })).toHaveAttribute(
    'href',
    /\/blob\/main\/LICENSE$/
  );
  await expect(footer.getByRole('link', { name: 'source' })).toHaveAttribute(
    'href',
    'https://github.com/dbuezas/usb-Input-shaper-calibrator'
  );
  await expect(footer.getByRole('link', { name: 'credits' })).toHaveAttribute(
    'href',
    /\/blob\/main\/NOTICE$/
  );
});
