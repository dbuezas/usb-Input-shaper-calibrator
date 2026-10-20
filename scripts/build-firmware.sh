#!/usr/bin/env bash
# Builds the firmware for every supported board into UI/src/assets/firmware/<board id>.<uf2|bin>.
# The board ids match `BOARDS` in UI/src/screens/InstallFirmwareScreen/boards.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=UI/src/assets/firmware
mkdir -p "$OUT"

# board id, PlatformIO env, BOARD define (RP2040 envs only), output file type
BUILDS=(
  "fly-adxl345      pico                    BOARD_FLY_ADXL345 uf2"
  "btt-s2dw         pico                    BOARD_BTT_LIS2DW  uf2"
  "fysetc-pis       pico                    BOARD_FYSETC_PIS  uf2"
  "rpi-pico-adxl345 pico_rp2040             BOARD_FLY_ADXL345 uf2"
  "bluepill         bluepill_f103c8         -                 bin"
  "bluepill-boot8k  bluepill_f103c8_boot8k  -                 bin"
)

for build in "${BUILDS[@]}"; do
  read -r id env board ext <<<"$build"
  echo "== $id ($env${board:+ $board})"
  if [ "$board" = "-" ]; then
    PLATFORMIO_BUILD_FLAGS="" pio run -e "$env" -s
  else
    PLATFORMIO_BUILD_FLAGS="-DBOARD=$board" pio run -e "$env" -s
  fi
  cp ".pio/build/$env/firmware.$ext" "$OUT/$id.$ext"
done

ls -l "$OUT"
