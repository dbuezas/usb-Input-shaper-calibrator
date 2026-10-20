import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Same boards as src/screens/InstallFirmwareScreen/boards.ts (files built by scripts/build-firmware.sh).
const BOARDS = [
  { name: 'Mellow FLY ADXL345 USB-C', file: 'fly-adxl345.uf2', step: 'RPI-RP2' },
  { name: 'BIGTREETECH S2DW', file: 'btt-s2dw.uf2', step: 'RPI-RP2' },
  { name: 'FYSETC Portable Input Shaper (PIS)', file: 'fysetc-pis.uf2', step: 'RPI-RP2' },
  { name: 'Raspberry Pi Pico + ADXL345', file: 'rpi-pico-adxl345.uf2', step: 'RPI-RP2' },
  { name: 'STM32F103 Bluepill + ADXL345', file: 'bluepill.bin', step: '0x08000000' },
  {
    name: 'STM32F103 Bluepill + ADXL345, 8 KiB USB bootloader',
    file: 'bluepill-boot8k.bin',
    step: 'USB bootloader',
  },
];

// The radio's accessible name is "<board name> <chip>, <rate> Hz".
const pickBoard = (page: Page, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('radio', { name: new RegExp(`^${escaped} (ADXL345|LIS2DW12),`) }).click();
};

const UF2_MAGIC_START0 = 0x0a324655; // "UF2\n"

test('each board downloads its own firmware file', async ({ page }) => {
  await page.goto('/');
  for (const board of BOARDS) {
    await pickBoard(page, board.name);
    const link = page.getByTestId('firmware-download');
    await expect(link).toHaveText(board.file);
    await expect(page.getByText(board.step).first()).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe(board.file);
    const downloaded = readFileSync(await download.path());
    const expected = readFileSync(new URL(`../src/assets/firmware/${board.file}`, import.meta.url));
    expect(downloaded.equals(expected)).toBe(true);
    if (board.file.endsWith('.uf2')) expect(downloaded.readUInt32LE(0)).toBe(UF2_MAGIC_START0);
  }
});

test('DIY boards show their wiring with pin locations', async ({ page }) => {
  await page.goto('/');
  const wiring = page.getByTestId('wiring');
  await expect(wiring).toHaveCount(0);

  await pickBoard(page, 'Raspberry Pi Pico + ADXL345');
  await expect(wiring.getByRole('row', { name: 'SDO (MISO) GP12 pin 16' })).toBeVisible();
  await expect(wiring.getByRole('row', { name: 'VCC 3V3(OUT) pin 36' })).toBeVisible();

  await pickBoard(page, 'STM32F103 Bluepill + ADXL345');
  await expect(wiring.getByRole('row', { name: 'SDO (MISO) PA6 label "A6"' })).toBeVisible();
});
