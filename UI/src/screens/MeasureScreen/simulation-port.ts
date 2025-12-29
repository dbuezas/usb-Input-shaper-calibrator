import {
  BATCH_SIZE,
  FIXED_SAMPLE_RATE,
  SIMULATION_AMPLITUDE,
  SIMULATION_MAX_FREQUENCY,
  SIMULATION_MIN_FREQUENCY,
  SIMULATION_SWEEP_S,
} from '../../constants';

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

  private isOpen = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private pumpPromise: Promise<void> | null = null;

  private t = 0;
  private simulationFrequency = SIMULATION_MIN_FREQUENCY;

  // Simple 2nd-order resonator (biquad) state to emulate a printer axis response.
  // We drive the system with a swept sine (input), then observe a resonant response
  // centered at RESONANCE_HZ.
  private readonly resonance = {
    // Target resonance frequency (Hz)
    f0Hz: 55,
    // Controls peak sharpness; higher Q => narrower peak.
    q: 8,
    // Biquad coefficients (band-pass, constant skirt gain; peak gain = Q)
    b0: 0,
    b1: 0,
    b2: 0,
    a1: 0,
    a2: 0,
    // Direct Form 2 Transposed states per axis
    x: { z1: 0, z2: 0 },
    y: { z1: 0, z2: 0 },
    z: { z1: 0, z2: 0 },
  };

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

  // eslint-disable-next-line @typescript-eslint/require-await
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

    this.resetResonator();

    this.pumpPromise = this.pump();
  }

  private resetResonator() {
    const { f0Hz, q } = this.resonance;

    // RBJ biquad cookbook (band-pass, constant skirt gain; peak gain = Q)
    const w0 = (2 * Math.PI * f0Hz) / FIXED_SAMPLE_RATE;
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
    this.resonance.b0 = b0 / a0;
    this.resonance.b1 = b1 / a0;
    this.resonance.b2 = b2 / a0;
    this.resonance.a1 = a1 / a0;
    this.resonance.a2 = a2 / a0;

    this.resonance.x.z1 = 0;
    this.resonance.x.z2 = 0;
    this.resonance.y.z1 = 0;
    this.resonance.y.z2 = 0;
    this.resonance.z.z1 = 0;
    this.resonance.z.z2 = 0;
  }

  private resonatorStep(input: number, state: { z1: number; z2: number }): number {
    const { b0, b1, b2, a1, a2 } = this.resonance;

    // Direct Form II Transposed
    const y = b0 * input + state.z1;
    state.z1 = b1 * input - a1 * y + state.z2;
    state.z2 = b2 * input - a2 * y;
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
    this.simulationFrequency +=
      (SIMULATION_MAX_FREQUENCY - SIMULATION_MIN_FREQUENCY) /
      SIMULATION_SWEEP_S /
      FIXED_SAMPLE_RATE;
    if (this.simulationFrequency > SIMULATION_MAX_FREQUENCY)
      this.simulationFrequency = SIMULATION_MIN_FREQUENCY;

    // Phase-accurate integration
    this.t += (2 * Math.PI * this.simulationFrequency) / FIXED_SAMPLE_RATE;

    // Input excitation: swept sine of constant amplitude.
    // The observed signal is the resonator's response, which peaks near 55Hz.
    const drive = Math.sin(this.t) * SIMULATION_AMPLITUDE;

    // Axis responses: slightly different gains and independent noise, but same resonance.
    // This mimics how a printer's accelerometer axes respond differently.
    const respX = this.resonatorStep(drive, this.resonance.x) * 1.0;
    const respY = this.resonatorStep(drive, this.resonance.y) * 0.85;
    const respZ = this.resonatorStep(drive, this.resonance.z) * 0.65;

    // Add purely random noise (independent per axis).
    // Noise level is fixed relative to the configured simulation amplitude,
    // so low-amplitude parts of the sweep still have the same noise floor.
    const noiseStd = SIMULATION_AMPLITUDE * 0.12;
    const valueX = clampInt16(Math.round(respX + randomNormal() * noiseStd));
    const valueY = clampInt16(Math.round(respY + randomNormal() * noiseStd));
    const valueZ = clampInt16(Math.round(respZ + randomNormal() * noiseStd));

    const simulatedData = new Int16Array([valueX, valueY, valueZ]);

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
