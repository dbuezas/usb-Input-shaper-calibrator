import {
  BATCH_SIZE,
  FIXED_SAMPLE_RATE,
  SIMULATION_AMPLITUDE,
  SIMULATION_MAX_FREQUENCY,
  SIMULATION_MIN_FREQUENCY,
  SIMULATION_SWEEP_S,
} from './constants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimulationPort {
  readable: ReadableStream<Uint8Array>;

  private isOpen = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private pumpPromise: Promise<void> | null = null;

  private t = 0;
  private simulationFrequency = SIMULATION_MIN_FREQUENCY;

  // Used to carry a partially-written 6-byte frame across chunks.
  private pendingFrame: Uint8Array | null = null;
  private pendingFrameIndex = 0;

  constructor() {
    this.readable = this.createReadable();
  }

  private createReadable(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: async () => {
        await this.close();
      },
    });
  }

  async open(_options: { baudRate: number }): Promise<void> {
    if (this.isOpen) return;
    this.isOpen = true;

    // Each open gets a fresh, unlocked stream (so reconnect / toggling modes works).
    this.readable = this.createReadable();

    // Reset simulation state on each open.
    this.t = 0;
    this.simulationFrequency = SIMULATION_MIN_FREQUENCY;
    this.pendingFrame = null;
    this.pendingFrameIndex = 0;

    this.pumpPromise = this.pump();
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    try {
      await this.pumpPromise;
    } finally {
      this.pumpPromise = null;
      this.controller?.close();
      this.controller = null;
    }
  }

  private makeNextFrame(): Uint8Array {
    // Sweep (frequency changes smoothly, phase stays continuous)
    this.simulationFrequency +=
      (SIMULATION_MAX_FREQUENCY - SIMULATION_MIN_FREQUENCY) /
      SIMULATION_SWEEP_S /
      FIXED_SAMPLE_RATE;
    if (this.simulationFrequency > SIMULATION_MAX_FREQUENCY)
      this.simulationFrequency = SIMULATION_MIN_FREQUENCY;

    // Phase-accurate integration
    this.t += (2 * Math.PI * this.simulationFrequency) / FIXED_SAMPLE_RATE;

    const v = Math.sin(this.t) * SIMULATION_AMPLITUDE;
    const value = Math.round(v);

    const simulatedData = new Int16Array([value, value, value]);

    const frame = new Uint8Array(6);
    frame[0] = 255;

    const packed =
      (BigInt(simulatedData[2]) & 0x1fffn) |
      ((BigInt(simulatedData[1]) & 0x1fffn) << 13n) |
      ((BigInt(simulatedData[0]) & 0x1fffn) << 26n);

    frame[1] = Number((packed >> 0n) & 0xffn);
    frame[2] = Number((packed >> 8n) & 0xffn);
    frame[3] = Number((packed >> 16n) & 0xffn);
    frame[4] = Number((packed >> 24n) & 0xffn);
    frame[5] = Number((packed >> 32n) & 0xffn);

    return frame;
  }

  private nextByte(): number {
    if (!this.pendingFrame || this.pendingFrameIndex >= 6) {
      this.pendingFrame = this.makeNextFrame();
      this.pendingFrameIndex = 0;
    }

    const byte = this.pendingFrame[this.pendingFrameIndex] ?? 0;
    this.pendingFrameIndex++;
    return byte;
  }

  private async pump() {
    const controller = this.controller;
    if (!controller) return;

    const chunkDurationMs = (1000 * BATCH_SIZE) / FIXED_SAMPLE_RATE / 6;

    let nextTime = performance.now();

    while (this.isOpen) {
      const chunk = new Uint8Array(BATCH_SIZE);
      for (let i = 0; i < chunk.length; i++) {
        chunk[i] = this.nextByte();
      }

      controller.enqueue(chunk);

      nextTime += chunkDurationMs;
      const delay = nextTime - performance.now();

      if (delay > 0) {
        await sleep(delay);
      }
    }
  }
}
