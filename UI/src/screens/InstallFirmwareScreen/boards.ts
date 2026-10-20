// Firmware files are built by `scripts/build-firmware.sh` (same board ids).
import flyAdxl345Url from '@/assets/firmware/fly-adxl345.uf2?url';
import bttS2dwUrl from '@/assets/firmware/btt-s2dw.uf2?url';
import fysetcPisUrl from '@/assets/firmware/fysetc-pis.uf2?url';
import rpiPicoAdxl345Url from '@/assets/firmware/rpi-pico-adxl345.uf2?url';
import bluepillUrl from '@/assets/firmware/bluepill.bin?url';
import bluepillBoot8kUrl from '@/assets/firmware/bluepill-boot8k.bin?url';

/** One wire: the pin label on the ADXL345 breakout (e.g. GY-291) -> the board pin, and where that pin is. */
export type WiringRow = { sensorPin: string; boardPin: string; location: string };

export type Board = {
  id: string;
  name: string;
  chip: 'ADXL345' | 'LIS2DW12';
  sampleRate: number;
  /**
   * - uf2: RP2040 in BOOTSEL mode, drag-and-drop the UF2.
   * - stm32: raw .bin at 0x08000000 (ST-Link or the STM32 serial bootloader).
   * - stm32-msc-bootloader: raw .bin copied onto the drive of an 8 KiB USB bootloader.
   */
  flashing: 'uf2' | 'stm32' | 'stm32-msc-bootloader';
  firmwareUrl: string;
  fileName: string;
  /** Sensor wiring, for boards you build yourself. */
  wiring?: WiringRow[];
  /** How to find the locations in `wiring` on the board. */
  wiringHint?: string;
  notes?: string;
};

// Raspberry Pi Pico: physical pin numbers count from pin 1 (top left, next to the USB port).
const ADXL345_ON_PICO: WiringRow[] = [
  { sensorPin: 'VCC', boardPin: '3V3(OUT)', location: 'pin 36' },
  { sensorPin: 'GND', boardPin: 'GND', location: 'pin 38' },
  { sensorPin: 'CS', boardPin: 'GP9', location: 'pin 12' },
  { sensorPin: 'SCL (SCK)', boardPin: 'GP10', location: 'pin 14' },
  { sensorPin: 'SDA (MOSI)', boardPin: 'GP11', location: 'pin 15' },
  { sensorPin: 'SDO (MISO)', boardPin: 'GP12', location: 'pin 16' },
];

// Bluepill: the location is the label printed next to the pin.
const ADXL345_ON_BLUEPILL: WiringRow[] = [
  { sensorPin: 'VCC', boardPin: '3.3V', location: 'label "3.3"' },
  { sensorPin: 'GND', boardPin: 'GND', location: 'label "G"' },
  { sensorPin: 'CS', boardPin: 'PA4', location: 'label "A4"' },
  { sensorPin: 'SCL (SCK)', boardPin: 'PA5', location: 'label "A5"' },
  { sensorPin: 'SDO (MISO)', boardPin: 'PA6', location: 'label "A6"' },
  { sensorPin: 'SDA (MOSI)', boardPin: 'PA7', location: 'label "A7"' },
];

export const BOARDS: Board[] = [
  {
    id: 'fly-adxl345',
    name: 'Mellow FLY ADXL345 USB-C',
    chip: 'ADXL345',
    sampleRate: 3200,
    flashing: 'uf2',
    firmwareUrl: flyAdxl345Url,
    fileName: 'fly-adxl345.uf2',
  },
  {
    id: 'btt-s2dw',
    name: 'BIGTREETECH S2DW',
    chip: 'LIS2DW12',
    sampleRate: 1600,
    flashing: 'uf2',
    firmwareUrl: bttS2dwUrl,
    fileName: 'btt-s2dw.uf2',
  },
  {
    id: 'fysetc-pis',
    name: 'FYSETC Portable Input Shaper (PIS)',
    chip: 'ADXL345',
    sampleRate: 3200,
    flashing: 'uf2',
    firmwareUrl: fysetcPisUrl,
    fileName: 'fysetc-pis.uf2',
  },
  {
    id: 'rpi-pico-adxl345',
    name: 'Raspberry Pi Pico + ADXL345',
    chip: 'ADXL345',
    sampleRate: 3200,
    flashing: 'uf2',
    firmwareUrl: rpiPicoAdxl345Url,
    fileName: 'rpi-pico-adxl345.uf2',
    wiring: ADXL345_ON_PICO,
    wiringHint:
      'With the USB port at the top: pins 1–20 run down the left side, pins 21–40 run up the right side (pin 40 is top right).',
    notes: 'The onboard LED lights while the app is connected.',
  },
  {
    id: 'bluepill',
    name: 'STM32F103 Bluepill + ADXL345',
    chip: 'ADXL345',
    sampleRate: 3200,
    flashing: 'stm32',
    firmwareUrl: bluepillUrl,
    fileName: 'bluepill.bin',
    wiring: ADXL345_ON_BLUEPILL,
    wiringHint: 'The labels are printed on the board next to each pin.',
    notes: 'The onboard LED lights while the app is connected.',
  },
  {
    id: 'bluepill-boot8k',
    name: 'STM32F103 Bluepill + ADXL345, 8 KiB USB bootloader',
    chip: 'ADXL345',
    sampleRate: 3200,
    flashing: 'stm32-msc-bootloader',
    firmwareUrl: bluepillBoot8kUrl,
    fileName: 'bluepill-boot8k.bin',
    wiring: ADXL345_ON_BLUEPILL,
    wiringHint: 'The labels are printed on the board next to each pin.',
    notes: 'The firmware starts at 0x08002000, after the 8 KiB bootloader.',
  },
];

export const DEFAULT_BOARD_ID = BOARDS[0].id;
