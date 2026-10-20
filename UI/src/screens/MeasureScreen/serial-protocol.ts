import { SUPPORTED_SAMPLE_RATES } from '@/constants';

// Byte protocol between the firmware (`src/main.cpp`) and the UI. Every packet is 6 bytes:
// - Sample:      0xFF, then x, y, z as signed 13-bit values packed little-endian
//                (x in bits 0..12, y in 13..25, z in 26..38 of the 5 data bytes).
// - Sample rate: 0xFE, 'R', rate in Hz (uint16 little-endian), then the same 2 bytes inverted as a check.
//                The firmware sends it at boot and every second; older firmware never sends it.
export const PACKET_SIZE = 6;
export const SAMPLE_MARKER = 0xff;
export const SAMPLE_RATE_MARKER = 0xfe;
const SAMPLE_RATE_TAG = 0x52; // 'R'

const signExtend13 = (v: number): number => (v << 19) >> 19;

/** Decodes the 5 data bytes of a sample packet into `out` ([x, y, z]). */
export const decodeSample = (
  b0: number,
  b1: number,
  b2: number,
  b3: number,
  b4: number,
  out: Int16Array
) => {
  // Without BigInt, to keep the hot path in 32-bit integer ops.
  const lo = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  const hi = b4 & 0xff;
  out[0] = signExtend13(lo & 0x1fff);
  out[1] = signExtend13((lo >>> 13) & 0x1fff);
  // z straddles the 32-bit boundary: 6 bits from lo, 7 bits from hi.
  out[2] = signExtend13(((lo >>> 26) | (hi << 6)) & 0x1fff);
};

/** Returns the sample rate in a sample-rate packet (bytes after the marker), or undefined if it is not a valid one. */
export const decodeSampleRate = (
  tag: number,
  lo: number,
  hi: number,
  loInv: number,
  hiInv: number
): number | undefined => {
  if (tag !== SAMPLE_RATE_TAG || (lo ^ loInv) !== 0xff || (hi ^ hiInv) !== 0xff) return undefined;
  const rate = lo | (hi << 8);
  return SUPPORTED_SAMPLE_RATES.includes(rate) ? rate : undefined;
};

export const encodeSample = (x: number, y: number, z: number): Uint8Array => {
  const lo = ((x & 0x1fff) | ((y & 0x1fff) << 13) | ((z & 0x3f) << 26)) >>> 0;
  const hi = (z & 0x1fff) >> 6;
  return new Uint8Array([
    SAMPLE_MARKER,
    lo & 0xff,
    (lo >>> 8) & 0xff,
    (lo >>> 16) & 0xff,
    lo >>> 24,
    hi,
  ]);
};

export const encodeSampleRate = (rate: number): Uint8Array => {
  const lo = rate & 0xff;
  const hi = (rate >> 8) & 0xff;
  return new Uint8Array([SAMPLE_RATE_MARKER, SAMPLE_RATE_TAG, lo, hi, lo ^ 0xff, hi ^ 0xff]);
};
