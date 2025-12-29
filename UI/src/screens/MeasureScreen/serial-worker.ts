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
  FIXED_SAMPLE_RATE,
  WINDOW_SIZE,
  HOP_SIZE,
} from '@/constants';

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

function fft(re: number[], im: number[]): void {
  const N = re.length;
  if (N <= 1) return;

  const re_even: number[] = [];
  const im_even: number[] = [];
  const re_odd: number[] = [];
  const im_odd: number[] = [];

  for (let i = 0; i < N; i += 2) {
    re_even.push(re[i]);
    im_even.push(im[i]);
    re_odd.push(re[i + 1]);
    im_odd.push(im[i + 1]);
  }

  fft(re_even, im_even);
  fft(re_odd, im_odd);

  for (let k = 0; k < N / 2; k++) {
    const angle = (-2 * Math.PI * k) / N;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const re_temp = re_odd[k] * cos - im_odd[k] * sin;
    const im_temp = re_odd[k] * sin + im_odd[k] * cos;

    re[k] = re_even[k] + re_temp;
    im[k] = im_even[k] + im_temp;
    re[k + N / 2] = re_even[k] - re_temp;
    im[k + N / 2] = im_even[k] - im_temp;
  }
}

function hannWindow(size: number): number[] {
  const window = new Array<number>(size);

  for (let i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return window;
}

function windowSum(w: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s;
}

class SpectralProcessor {
  buffer: number[];
  bufferIndex: number;
  windows: number[];
  windowSum: number;
  re: number[];
  im: number[];
  magnitudes: number[];

  constructor() {
    this.buffer = new Array<number>(WINDOW_SIZE).fill(0);
    this.bufferIndex = 0;
    this.windows = hannWindow(WINDOW_SIZE);
    this.windowSum = windowSum(this.windows);
    this.re = new Array<number>(WINDOW_SIZE);
    this.im = new Array<number>(WINDOW_SIZE);
    const halfBins = WINDOW_SIZE / 2 + 1;
    this.magnitudes = new Array<number>(halfBins);
  }

  addSample(value: number): void {
    this.buffer[this.bufferIndex] = value;
    this.bufferIndex = (this.bufferIndex + 1) % WINDOW_SIZE;

    if (this.bufferIndex % HOP_SIZE === 0) {
      this.computeSpectrogram();
    }
  }

  computeSpectrogram(): void {
    for (let i = 0; i < WINDOW_SIZE; i++) {
      const idx = (this.bufferIndex + i) % WINDOW_SIZE;
      this.re[i] = this.buffer[idx] * this.windows[i];
      this.im[i] = 0;
    }

    fft(this.re, this.im);

    // Magnitude spectrum (for existing waterfall/scatter)
    const halfBins = WINDOW_SIZE / 2 + 1;
    const scale = 2 / this.windowSum;

    // DC bin (no doubling in one-sided spectrum)
    this.magnitudes[0] =
      Math.sqrt(this.re[0] * this.re[0] + this.im[0] * this.im[0]) * (scale * 0.5);

    // Non-DC, non-Nyquist bins
    for (let i = 1; i < halfBins - 1; i++) {
      this.magnitudes[i] = Math.sqrt(this.re[i] * this.re[i] + this.im[i] * this.im[i]) * scale;
    }

    // Nyquist bin (no doubling in one-sided spectrum)
    const nyquist = halfBins - 1;
    this.magnitudes[nyquist] =
      Math.sqrt(this.re[nyquist] * this.re[nyquist] + this.im[nyquist] * this.im[nyquist]) *
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

  constructor() {
    this.buffer = new CircularBuffer(BUFFER_SIZE);
    this.sampleCount = 0;
    this.intervalStartTime = 0;
    this.frequency = 0;
    this.lastData = { x: 0, y: 0, z: 0 };
    this.processor = new SpectralProcessor();
    this.selectedAxis = 'x';
    this.lastSent = 0;
  }

  resetSpectralProcessor(): void {
    this.processor = new SpectralProcessor();
  }

  processRawData(rawData: Uint8Array): void {
    this.buffer.append(rawData);

    // Process buffer, scanning for ALIGN packets and data chunks
    while (this.buffer.available >= 6) {
      const bmarker = this.buffer.getByte(0);
      if (bmarker != 255) {
        this.buffer.consume(1);
        console.log('discard');
        continue;
      }
      const b0 = this.buffer.getByte(1);
      const b1 = this.buffer.getByte(2);
      const b2 = this.buffer.getByte(3);
      const b3 = this.buffer.getByte(4);
      const b4 = this.buffer.getByte(5);
      this.buffer.consume(6);

      const now = performance.now();

      // Initialize interval if needed
      if (this.intervalStartTime === 0) {
        this.intervalStartTime = now;
        this.sampleCount = 0;
      }

      const packed =
        (BigInt(b4) << 32n) |
        (BigInt(b3) << 24n) |
        (BigInt(b2) << 16n) |
        (BigInt(b1) << 8n) |
        BigInt(b0);

      function sign13(v: number) {
        return v & 0x1000 ? v - 0x2000 : v;
      }

      const x = sign13(Number((packed >> 0n) & 0x1fffn));
      const y = sign13(Number((packed >> 13n) & 0x1fffn));
      const z = sign13(Number((packed >> 26n) & 0x1fffn));

      // sign extend

      // Convert to signed 16-bit integers
      this.sampleCount++;

      // Check if interval has elapsed
      if (now - this.intervalStartTime >= REPORT_HZ_EVERY_MS) {
        // Calculate frequency: samples per second
        this.frequency = (this.sampleCount / REPORT_HZ_EVERY_MS) * 1000;

        // Reset for next interval
        this.intervalStartTime = now;
        this.sampleCount = 0;
      }

      // Add to spectrogram processor
      const sample = this.selectedAxis === 'x' ? x : this.selectedAxis === 'y' ? y : z;
      this.processor?.addSample(sample);

      if (++this.lastSent > FIXED_SAMPLE_RATE / AXIS_REPORT_RATE_HZ) {
        this.lastSent = 0;
        serialChannel.postMessage({
          data: new Int16Array([x, y, z]),
          frequency: this.frequency,
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
    serialChannel.postMessage({
      data: new Int16Array([0, 0, 0]),
      frequency: 0,
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
    console.log('selectaxis');
    dataProcessor.selectedAxis = e.data.axis!;
    dataProcessor.resetSpectralProcessor();
  }
};
