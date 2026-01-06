import {
  BATCH_SIZE,
  FIXED_SAMPLE_RATE,
  SIMULATION_AMPLITUDE,
  SIMULATION_MAX_FREQUENCY,
  SIMULATION_MIN_FREQUENCY,
} from '@/constants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clampInt16 = (v: number) => Math.max(-32768, Math.min(32767, v | 0));

const randomNormal = () => {
  // Box–Muller transform
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

export class SimulationPort {
  readable: ReadableStream<Uint8Array>;

  private sweepSeconds: number;

  private sweepMinFrequencyHz = SIMULATION_MIN_FREQUENCY;
  private sweepMaxFrequencyHz = SIMULATION_MAX_FREQUENCY;

  private isOpen = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private pumpPromise: Promise<void> | null = null;

  private t = 0;
  private simulationFrequency = SIMULATION_MIN_FREQUENCY;

  // Simple 2nd-order resonator (biquad) state to emulate a printer axis response.
  // Each axis gets its own resonance frequency.
  private readonly resonators = {
    q: 8,
    x: { f0Hz: 55, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 },
    y: { f0Hz: 61, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 },
    z: { f0Hz: 22, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 },
  };

  // Used to carry a partially-written 6-byte frame across chunks.
  private pendingFrame: Uint8Array | null = null;
  private pendingFrameIndex = 0;

  constructor(options?: { sweepSeconds?: number }) {
    this.sweepSeconds = options?.sweepSeconds ?? 3;
    this.readable = this.createReadable();
  }

  setSweepFrequencyRange(rangeHz: { minHz: number; maxHz: number }) {
    const minHz = Number(rangeHz.minHz);
    const maxHz = Number(rangeHz.maxHz);
    if (!Number.isFinite(minHz) || !Number.isFinite(maxHz)) return;
    const lo = Math.max(0, Math.min(minHz, maxHz));
    const hi = Math.max(0, Math.max(minHz, maxHz));
    // Keep a non-zero span to avoid a stuck sweep.
    this.sweepMinFrequencyHz = lo;
    this.sweepMaxFrequencyHz = Math.max(hi, lo + 1e-6);
  }

  setSweepSeconds(seconds: number) {
    // Keep it sane: avoid divide-by-zero / absurdly fast sweeps.
    const next = Number(seconds);
    if (!Number.isFinite(next)) return;
    this.sweepSeconds = Math.max(0.1, next);
  }

  /**
   * Restarts the simulation sweep from t=0.
   *
   * This is useful when the UI changes what axis is being visualized, so the
   * simulation behaves like a fresh acquisition.
   */
  restart(): void {
    this.t = 0;
    this.simulationFrequency = this.sweepMinFrequencyHz;
    this.pendingFrame = null;
    this.pendingFrameIndex = 0;
    this.resetResonator();
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async open(_options: { baudRate: number }): Promise<void> {
    if (this.isOpen) return;
    this.isOpen = true;

    // Each open gets a fresh, unlocked stream (so reconnect / toggling modes works).
    this.readable = this.createReadable();

    // Reset simulation state on each open.
    this.restart();

    this.pumpPromise = this.pump();
  }

  private resetResonator() {
    const { q } = this.resonators;

    const resetAxis = (axis: {
      f0Hz: number;
      b0: number;
      b1: number;
      b2: number;
      a1: number;
      a2: number;
      z1: number;
      z2: number;
    }) => {
      // RBJ biquad cookbook (band-pass, constant skirt gain; peak gain = Q)
      const w0 = (2 * Math.PI * axis.f0Hz) / FIXED_SAMPLE_RATE;
      const cosw0 = Math.cos(w0);
      const sinw0 = Math.sin(w0);
      const alpha = sinw0 / (2 * q);

      const b0 = alpha;
      const b1 = 0;
      const b2 = -alpha;
      const a0 = 1 + alpha;
      const a1 = -2 * cosw0;
      const a2 = 1 - alpha;

      // Normalize so a0 = 1
      axis.b0 = b0 / a0;
      axis.b1 = b1 / a0;
      axis.b2 = b2 / a0;
      axis.a1 = a1 / a0;
      axis.a2 = a2 / a0;
      axis.z1 = 0;
      axis.z2 = 0;
    };

    resetAxis(this.resonators.x);
    resetAxis(this.resonators.y);
    resetAxis(this.resonators.z);
  }

  private resonatorStep(
    input: number,
    axis: { b0: number; b1: number; b2: number; a1: number; a2: number; z1: number; z2: number }
  ): number {
    // Direct Form II Transposed
    const y = axis.b0 * input + axis.z1;
    axis.z1 = axis.b1 * input - axis.a1 * y + axis.z2;
    axis.z2 = axis.b2 * input - axis.a2 * y;
    return y;
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
    const span = this.sweepMaxFrequencyHz - this.sweepMinFrequencyHz;
    this.simulationFrequency += span / this.sweepSeconds / FIXED_SAMPLE_RATE;
    if (this.simulationFrequency > this.sweepMaxFrequencyHz)
      this.simulationFrequency = this.sweepMinFrequencyHz;

    // Phase-accurate integration
    this.t += (2 * Math.PI * this.simulationFrequency) / FIXED_SAMPLE_RATE;

    // Input excitation: swept sine of constant amplitude.
    // The observed signal is the resonator's response, which peaks near 55Hz.
    const drive = Math.sin(this.t) * SIMULATION_AMPLITUDE;

    // Axis responses: different resonance frequencies + gains and independent noise.
    const respX = this.resonatorStep(drive, this.resonators.x) * 1.0;
    const respY = this.resonatorStep(drive, this.resonators.y) * 0.85;
    const respZ = this.resonatorStep(drive, this.resonators.z) * 0.65;

    // Add purely random noise (independent per axis).
    // Noise level is fixed relative to the configured simulation amplitude,
    // so low-amplitude parts of the sweep still have the same noise floor.
    const noiseStd = SIMULATION_AMPLITUDE * 0.12;
    const valueX = clampInt16(
      Math.round(SIMULATION_AMPLITUDE * 0.2 + respX + randomNormal() * noiseStd)
    );
    const valueY = clampInt16(
      Math.round(SIMULATION_AMPLITUDE * 0.2 + respY + randomNormal() * noiseStd)
    );
    const valueZ = clampInt16(
      Math.round(SIMULATION_AMPLITUDE * 0.2 + respZ + randomNormal() * noiseStd)
    );

    const simulatedData = new Int16Array([valueX, valueY, valueZ]);

    const frame = new Uint8Array(6);
    frame[0] = 255;

    // Pack as X in bits 0..12, Y in 13..25, Z in 26..38
    // to match the decoder in `serial-worker.ts`.
    const packed =
      (BigInt(simulatedData[0]) & 0x1fffn) |
      ((BigInt(simulatedData[1]) & 0x1fffn) << 13n) |
      ((BigInt(simulatedData[2]) & 0x1fffn) << 26n);

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
