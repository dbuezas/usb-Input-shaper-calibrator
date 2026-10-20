import { describe, expect, it } from 'vitest';
import { SUPPORTED_SAMPLE_RATES } from '@/constants';
import {
  decodeSample,
  decodeSampleRate,
  encodeSample,
  encodeSampleRate,
  PACKET_SIZE,
} from './serial-protocol';

const decodeSamplePacket = (packet: Uint8Array) => {
  const out = new Int16Array(3);
  decodeSample(packet[1], packet[2], packet[3], packet[4], packet[5], out);
  return Array.from(out);
};

const decodeRatePacket = (packet: ArrayLike<number>) =>
  decodeSampleRate(packet[1], packet[2], packet[3], packet[4], packet[5]);

describe('sample packets', () => {
  it('round-trips signed 13-bit values', () => {
    const cases = [
      [0, 0, 0],
      [1, -1, 2],
      [4095, -4096, 1234],
      [-4096, 4095, -1],
      [-2048, 2047, -4096],
    ];
    for (const [x, y, z] of cases) {
      const packet = encodeSample(x, y, z);
      expect(packet.length).toBe(PACKET_SIZE);
      expect(packet[0]).toBe(0xff);
      expect(decodeSamplePacket(packet)).toEqual([x, y, z]);
    }
  });

  it('decodes the bytes the firmware sends', () => {
    // x=256 (1g), y=-256, z=0, packed by `send_sample()` in src/main.cpp (same bytes in test/test_firmware)
    expect(decodeSamplePacket(new Uint8Array([0xff, 0x00, 0x01, 0xe0, 0x03, 0x00]))).toEqual([
      256, -256, 0,
    ]);
  });
});

describe('sample-rate packets', () => {
  it('decodes the bytes the firmware sends', () => {
    // `send_sample_rate()` in src/main.cpp (same bytes in test/test_firmware)
    expect(decodeRatePacket([0xfe, 0x52, 0x80, 0x0c, 0x7f, 0xf3])).toBe(3200); // ADXL345
    expect(decodeRatePacket([0xfe, 0x52, 0x40, 0x06, 0xbf, 0xf9])).toBe(1600); // LIS2DW12
  });

  it('round-trips every supported rate', () => {
    for (const rate of SUPPORTED_SAMPLE_RATES)
      expect(decodeRatePacket(encodeSampleRate(rate))).toBe(rate);
  });

  it('rejects damaged or unknown packets', () => {
    expect(decodeRatePacket([0xfe, 0x53, 0x40, 0x06, 0xbf, 0xf9])).toBeUndefined(); // wrong tag
    expect(decodeRatePacket([0xfe, 0x52, 0x40, 0x06, 0xbf, 0xf8])).toBeUndefined(); // bad check byte
    expect(decodeRatePacket(encodeSampleRate(1000))).toBeUndefined(); // unsupported rate
  });

  it('has no 0xFF byte, so older UIs skip it while looking for sample packets', () => {
    for (const rate of SUPPORTED_SAMPLE_RATES) expect(encodeSampleRate(rate)).not.toContain(0xff);
  });
});
