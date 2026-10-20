# Marlin USB Resonance Tester

Measure your 3D printer’s mechanical resonance over **USB** (ADXL345 or LIS2DW12 on an RP2040 or STM32F103 “USB accelerometer” board) and use the built-in web UI to:

- Download the firmware for your board and flash it
- Stream accelerometer samples over the browser’s **Web Serial** API
- View a live spectrogram / peak frequency
- Simulate data without hardware
- Optimise **Marlin FT_MOTION** input shaper coefficients from measured max-hold spectra

Live app (GitHub Pages): https://dbuezas.github.io/usb-Input-shaper-calibrator/

Source repository: https://github.com/dbuezas/usb-Input-shaper-calibrator

## What’s in this repo

- `src/main.cpp`: firmware that reads an ADXL345 / LIS2DW12 over SPI and streams packed samples over USB serial.
- `platformio.ini`: PlatformIO configuration (RP2040 with the Earle Philhower Arduino core, STM32F103 Bluepill).
- `scripts/build-firmware.sh`: builds the firmware for every supported board into `UI/src/assets/firmware/` (the files the web UI offers). CI runs it before building the UI; the files are not in git.
- `UI/`: React + Vite web app (deployed to GitHub Pages via `.github/workflows/deploy.yaml`).

## Requirements

- A Chromium-based browser with Web Serial support: **Chrome**, **Edge**, **Opera**.
- Hardware (optional), one of: Mellow FLY ADXL345 USB-C, BIGTREETECH S2DW, FYSETC Portable Input Shaper, a Raspberry Pi Pico + ADXL345, or an STM32F103 Bluepill + ADXL345.

## Quick start (recommended)

1. Open the web app.
2. **Install firmware** → pick your board and download its firmware.
3. Flash it as shown there (RP2040: hold **BOOT** while plugging in, then drag-and-drop the UF2 onto the `RPI-RP2` drive).
4. **Measure axis** → click **Connect** and pick the serial device.
5. Use **Simulate** if you want to try the UI without hardware.
6. **Optimize shaper** → run **Auto optimise** to get suggested shaper taps.

## Building the firmware (PlatformIO)

This is only needed if you want to build your own UF2 instead of using the one bundled in the UI.

For RP2040 boards, pick your board in `src/configuration.h` (`BOARD`) first.

```sh
pio run                          # generic RP2040 boards (env `pico`)
pio run -e pico_rp2040           # Raspberry Pi Pico: status LED + SMPS PWM mode (less noise)
pio run -e bluepill_f103c8       # STM32F103 Bluepill
pio run -e bluepill_f103c8_boot8k  # Bluepill with an 8 KiB bootloader, upload via DFU
```

The firmware:

- Targets RP2040 (`board = pico`) and STM32F103 Bluepill
- Reads the ADXL345 or LIS2DW12 via bit-banged SPI on RP2040 and hardware SPI on the Bluepill (`SPI_BITBANG` in `src/main.cpp`)
- Streams samples over USB serial at `230400` baud (UI expects the same)
- Sends samples at the sensor's own rate (ADXL345: 3200 Hz, LIS2DW12: 1600 Hz) and reports that rate to the UI every second

### Tests

The firmware runs on the host against a simulated ADXL345 / LIS2DW12 (SPI at the pin level), so no hardware is needed:

```sh
pio test -e native_fly -e native_btt -e native_fysetc -e native_bluepill
```

GitHub Actions runs these tests and builds the firmware for every board on each push and pull request; the files are attached to the run as the `firmware` artifact.

## Running the UI locally

Needs [PlatformIO](https://platformio.org/install/cli): the UI bundles the firmware files, so build them once first (and again after firmware changes).

```sh
cd UI
pnpm install
pnpm firmware   # runs ../scripts/build-firmware.sh
pnpm dev
```

Then open the printed local URL.

### Tests

```sh
pnpm lint
pnpm test       # unit tests (serial protocol)
pnpm test:e2e   # browser tests with the simulator (3200 Hz and 1600 Hz sensors)
```

The browser tests use Playwright. On macOS 13 they use the installed Google Chrome; elsewhere run `pnpm exec playwright install chromium` first.

## Notes / troubleshooting

- **USB-C ↔ USB-C cables:** some boards don’t have CC resistors and won’t enumerate. Use **USB-A → USB-C** (or an A-port adapter) if connection is flaky.
- If **Connect** stays on “Connecting”, check you flashed the UF2, selected the right port, and the device is streaming.

## Screenshots

<img width="1340" height="932" alt="image" src="https://github.com/user-attachments/assets/adb6fe45-afc1-471d-9e54-13eefaf6a75f" />

<img width="1325" height="923" alt="image" src="https://github.com/user-attachments/assets/4f365fb0-5500-4c54-bbc3-064b1a167f6e" />

## License

Copyright (C) 2025-2026 David Buezas. Contributions by other authors are listed in the git history.

This project is free software under the [GNU General Public License v3.0 or later](LICENSE), with one additional term under GPLv3 section 7(b): modified versions must keep the attribution “Based on Marlin USB Resonance Tester by David Buezas” (with a link to this repository) in the legal notices shown in their user interface. See [NOTICE](NOTICE).

## Credits

- [Marlin](https://github.com/MarlinFirmware/Marlin): input shaper math (`UI/src/screens/ShaperScreen/input-shaper.ts` is a port of `shaping.cpp`).
- [Klipper](https://github.com/Klipper3d/klipper), Dmitry Butyugin: shaper scoring (`UI/src/screens/ShaperScreen/shaper-scores/klipper.ts` follows `shaper_calibrate.py`).
- Scott Lahteine ([@thinkyhead](https://github.com/thinkyhead)): Marlin FT Motion parity and the M493/M593 G-code output (#5).
- [@Nuck-TH](https://github.com/Nuck-TH): hardware SPI, STM32F103 Bluepill support and the Pico SMPS noise fix (#3).
