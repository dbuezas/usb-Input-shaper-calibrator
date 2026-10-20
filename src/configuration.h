#pragma once

// ----------------
// Board selection
// ----------------
// Pick exactly one board here. This will auto-configure pins + accel chip.
// Used by the RP2040 envs (`pico`, `pico_rp2040`). The Bluepill envs ignore it.

#define BOARD_FLY_ADXL345 1
#define BOARD_BTT_LIS2DW 2
#define BOARD_FYSETC_PIS 3

#define BOARD BOARD_FLY_ADXL345

// ----------------
// Serial debugging
// ----------------
// Set to 1 to print human-readable debug lines periodically.
// NOTE: This will interfere with the binary streaming protocol.
#define SERIAL_DEBUG_TEXT 0

/////////////////////////////-----------------
