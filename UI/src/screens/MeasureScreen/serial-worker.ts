import {
  serialChannel,
  spectrogramChannel,
  type RawDataMessage,
  type SpectrumSliceMessage,
} from './messages';
import { CircularBuffer } from './circular-buffer';
import {
  REPORT_HZ_EVERY_MS,
  AXIS_REPORT_RATE_HZ,
  BUFFER_SIZE,
  DEFAULT_SAMPLE_RATE,
  hopSizeForRate,
  windowSizeForRate,
} from '@/constants';
import {
  decodeSample,
  decodeSampleRate,
  PACKET_SIZE,
  SAMPLE_MARKER,
  SAMPLE_RATE_MARKER,
} from './serial-protocol';

import { FFTR } from 'kissfft-js';

interface SensorData {
  x: number;
  y: number;
  z: number;
}

interface WorkerMessage {
  type: 'rawData' | 'reset' | 'setSelectedAxis';
  data?: Uint8Array;
  axis?: 'x' | 'y' | 'z';
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);

  for (let i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return window;
}

function windowSum(w: Float32Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s;
}

class SpectralProcessor {
  windowSize: number;
  hopSize: number;
  buffer: Int16Array;
  bufferIndex: number;
  windows: Float32Array;
  windowSum: number;
  fftr: FFTR;
  timeDomain: Float32Array;
  magnitudes: Float32Array;

  constructor(sampleRate: number) {
    this.windowSize = windowSizeForRate(sampleRate);
    this.hopSize = hopSizeForRate(sampleRate);
    this.buffer = new Int16Array(this.windowSize);
    this.bufferIndex = 0;
    this.windows = hannWindow(this.windowSize);
    this.windowSum = windowSum(this.windows);
    this.fftr = new FFTR(this.windowSize);
    this.timeDomain = new Float32Array(this.windowSize);
    const halfBins = this.windowSize / 2 + 1;
    this.magnitudes = new Float32Array(halfBins);
  }

  addSample(value: number): void {
    // Ensure the write stays in integer space as long as possible.
    // (JS numbers are float64, but bitwise ops keep them as int32.)
    this.buffer[this.bufferIndex] = value | 0;
    this.bufferIndex = (this.bufferIndex + 1) % this.windowSize;

    if (this.bufferIndex % this.hopSize === 0) {
      this.computeSpectrogram();
    }
  }

  computeSpectrogram(): void {
    for (let i = 0; i < this.windowSize; i++) {
      const idx = (this.bufferIndex + i) % this.windowSize;
      this.timeDomain[i] = this.buffer[idx] * this.windows[i];
    }
    const frequencyDomain = this.fftr.forward(this.timeDomain);

    // Magnitude spectrum (for existing waterfall/scatter)
    const halfBins = this.windowSize / 2 + 1;
    const scale = 2 / this.windowSum;

    // DC bin (no doubling in one-sided spectrum)
    this.magnitudes[0] =
      Math.sqrt(frequencyDomain[0] * frequencyDomain[0] + frequencyDomain[1] * frequencyDomain[1]) *
      (scale * 0.5);

    // Non-DC, non-Nyquist bins
    for (let i = 1; i < halfBins - 1; i++) {
      const re = frequencyDomain[i * 2];
      const im = frequencyDomain[i * 2 + 1];
      this.magnitudes[i] = Math.sqrt(re * re + im * im) * scale;
    }

    // Nyquist bin (no doubling in one-sided spectrum)
    const nyquist = halfBins - 1;
    this.magnitudes[nyquist] =
      Math.sqrt(
        frequencyDomain[nyquist * 2] * frequencyDomain[nyquist * 2] +
          frequencyDomain[nyquist * 2 + 1] * frequencyDomain[nyquist * 2 + 1]
      ) *
      (scale * 0.5);

    spectrogramChannel.postMessage({
      type: 'spectrumSlice',
      spectrum: this.magnitudes,
    } satisfies SpectrumSliceMessage);
  }
}

class DataProcessor {
  buffer: CircularBuffer;
  sampleCount: number;
  intervalStartTime: number;
  frequency: number;
  lastData: SensorData;
  processor: SpectralProcessor | null;
  selectedAxis: 'x' | 'y' | 'z';
  lastSent: number;
  rawFrame: Int16Array;
  sampleRate: number;

  constructor() {
    this.buffer = new CircularBuffer(BUFFER_SIZE);
    this.sampleCount = 0;
    this.intervalStartTime = 0;
    this.frequency = 0;
    this.lastData = { x: 0, y: 0, z: 0 };
    this.sampleRate = DEFAULT_SAMPLE_RATE;
    this.processor = new SpectralProcessor(this.sampleRate);
    this.selectedAxis = 'x';
    this.lastSent = 0;
    this.rawFrame = new Int16Array(3);
  }

  resetSpectralProcessor(): void {
    this.processor = new SpectralProcessor(this.sampleRate);
  }

  setSampleRate(sampleRate: number): void {
    if (sampleRate === this.sampleRate) return;
    this.sampleRate = sampleRate;
    this.resetSpectralProcessor();
    // Restart the measured-rate interval, so it does not mix samples of both rates.
    this.intervalStartTime = 0;
  }

  processRawData(rawData: Uint8Array): void {
    this.buffer.append(rawData);

    // Process buffer, scanning for packet markers (see `serial-protocol.ts`)
    while (this.buffer.available >= PACKET_SIZE) {
      const bmarker = this.buffer.getByte(0);
      if (bmarker === SAMPLE_RATE_MARKER) {
        const sampleRate = decodeSampleRate(
          this.buffer.getByte(1),
          this.buffer.getByte(2),
          this.buffer.getByte(3),
          this.buffer.getByte(4),
          this.buffer.getByte(5)
        );
        if (sampleRate === undefined) {
          this.buffer.consume(1);
          continue;
        }
        this.buffer.consume(PACKET_SIZE);
        this.setSampleRate(sampleRate);
        continue;
      }
      if (bmarker !== SAMPLE_MARKER) {
        this.buffer.consume(1);
        continue;
      }
      decodeSample(
        this.buffer.getByte(1),
        this.buffer.getByte(2),
        this.buffer.getByte(3),
        this.buffer.getByte(4),
        this.buffer.getByte(5),
        this.rawFrame
      );
      this.buffer.consume(PACKET_SIZE);

      const now = performance.now();

      // Initialize interval if needed
      if (this.intervalStartTime === 0) {
        this.intervalStartTime = now;
        this.sampleCount = 0;
      }

      const x = this.rawFrame[0];
      const y = this.rawFrame[1];
      const z = this.rawFrame[2];

      this.sampleCount++;
      const dt = now - this.intervalStartTime;
      // Check if interval has elapsed
      if (dt >= REPORT_HZ_EVERY_MS) {
        // Calculate frequency: samples per second
        this.frequency = (this.sampleCount / dt) * 1000;

        // Reset for next interval
        this.intervalStartTime = now;
        this.sampleCount = 0;
      }

      // Add to spectrogram processor
      const sample = this.selectedAxis === 'x' ? x : this.selectedAxis === 'y' ? y : z;
      this.processor?.addSample(sample);

      if (++this.lastSent > this.sampleRate / AXIS_REPORT_RATE_HZ) {
        this.lastSent = 0;
        serialChannel.postMessage({
          data: this.rawFrame,
          frequency: this.frequency,
          sampleRate: this.sampleRate,
        } satisfies RawDataMessage);
      }
    }
  }

  reset(): void {
    this.buffer = new CircularBuffer(BUFFER_SIZE);
    this.sampleCount = 0;
    this.intervalStartTime = 0;
    this.lastData = { x: 0, y: 0, z: 0 };
    this.frequency = 0;
    // A new connection may be a different device: start from the default until it reports its rate.
    this.setSampleRate(DEFAULT_SAMPLE_RATE);
    serialChannel.postMessage({
      data: new Int16Array([0, 0, 0]),
      frequency: 0,
      sampleRate: this.sampleRate,
    } satisfies RawDataMessage);
  }
}

const dataProcessor = new DataProcessor();

self.onmessage = function (e: MessageEvent<WorkerMessage>) {
  const { type, data } = e.data;

  if (type === 'rawData') {
    dataProcessor.processRawData(data!);
  }
  if (type === 'reset') {
    dataProcessor.reset();
  }
  if (type === 'setSelectedAxis') {
    dataProcessor.selectedAxis = e.data.axis!;
    dataProcessor.resetSpectralProcessor();
  }
};
