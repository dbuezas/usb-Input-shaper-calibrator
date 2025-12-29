# Marlin USB Resonance Tester

Measure your 3D printer’s mechanical resonance over **USB** (ADXL345 on an RP2040 “USB accelerometer” board) and use the built-in web UI to:

- Flash the firmware (UF2)
- Stream accelerometer samples over the browser’s **Web Serial** API
- View a live spectrogram / peak frequency
- Simulate data without hardware
- Optimise **Marlin FT_MOTION** input shaper coefficients from measured max-hold spectra

Live app (GitHub Pages): https://dbuezas.github.io/usb-Input-shaper-calibrator/

Source repository: https://github.com/dbuezas/usb-Input-shaper-calibrator

## What’s in this repo

- `src/main.cpp`: RP2040 firmware that reads an ADXL345 over SPI and streams packed samples over USB serial.
- `platformio.ini`: PlatformIO configuration for `board = pico` (Earle Philhower Arduino core).
- `UI/`: React + Vite web app (deployed to GitHub Pages via `.github/workflows/deploy.yaml`).

## Requirements

- A Chromium-based browser with Web Serial support: **Chrome**, **Edge**, **Opera**.
- Hardware (optional): an RP2040 + ADXL345 “USB accelerometer” board (e.g. Mellow Fly ADXL345 USB-C).

## Quick start (recommended)

1. Open the web app.
2. **Install firmware** → download `firmware.uf2`.
3. Put the RP2040 into bootloader mode (hold **BOOT** while plugging in) and drag-and-drop the UF2 onto the `RPI-RP2` drive.
4. **Measure axis** → click **Connect** and pick the serial device.
5. Use **Simulate** if you want to try the UI without hardware.
6. **Optimize shaper** → run **Auto optimise** to get suggested shaper taps.

## Building the firmware (PlatformIO)

This is only needed if you want to build your own UF2 instead of using the one bundled in the UI.

```sh
pio run
```

The firmware:

- Targets RP2040 (`board = pico`)
- Reads the ADXL345 via bit-banged SPI
- Streams samples over USB serial at `230400` baud (UI expects the same)

## Running the UI locally

```sh
cd UI
pnpm install
pnpm dev
```

Then open the printed local URL.

## Notes / troubleshooting

- **USB-C ↔ USB-C cables:** some boards don’t have CC resistors and won’t enumerate. Use **USB-A → USB-C** (or an A-port adapter) if connection is flaky.
- If **Connect** stays on “Connecting”, check you flashed the UF2, selected the right port, and the device is streaming.

## Screenshots

<img width="1340" height="932" alt="image" src="https://github.com/user-attachments/assets/adb6fe45-afc1-471d-9e54-13eefaf6a75f" />

<img width="1325" height="923" alt="image" src="https://github.com/user-attachments/assets/4f365fb0-5500-4c54-bbc3-064b1a167f6e" />
