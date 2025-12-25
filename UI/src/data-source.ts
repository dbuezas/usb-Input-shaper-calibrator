import { serialChannel } from './messages';
import SerialWorker from './serial-worker?worker';
import {
  SERIAL_BAUD_RATE,
  BATCH_SIZE,
  SIMULATION_AMPLITUDE,
  FIXED_SAMPLE_RATE,
  AXIS_REPORT_RATE_HZ,
  SIMULATION_MIN_FREQUENCY,
  SIMULATION_MAX_FREQUENCY,
} from './constants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const serialWorker = new SerialWorker();

export interface DataSource {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  setSelectedAxis(axis: 'x' | 'y' | 'z'): void;
  setRange(minFrequency: number, maxFrequency: number): void;
}

export class SerialDataSource implements DataSource {
  private port: SerialPort | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>> | undefined;
  private onData: (data: Int16Array) => void;
  private onFrequency: (freq: number) => void;
  private onStatus: (status: string) => void;

  constructor(
    onData: (data: Int16Array) => void,
    onFrequency: (freq: number) => void,
    onStatus: (status: string) => void
  ) {
    this.onData = onData;
    this.onFrequency = onFrequency;
    this.onStatus = onStatus;

    // Set up worker message listener
    serialChannel.addEventListener('message', (e: MessageEvent) => {
      const { data, frequency: workerFrequency } = e.data;
      this.onData(data);
      this.onFrequency(workerFrequency);
    });
  }

  async start(): Promise<boolean> {
    try {
      if (!('serial' in navigator)) {
        this.onStatus('Web Serial API not supported');
        return false;
      }

      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: SERIAL_BAUD_RATE });

      this.onStatus('Connected');

      this.reader = this.port.readable?.getReader();
      if (!this.reader) {
        this.onStatus('Failed to get reader');
        return false;
      }

      const startReading = async () => {
        try {
          let buffer_i = 0;
          const buffer = new Uint8Array(BATCH_SIZE);
          while (this.reader) {
            const { done, value } = await this.reader.read();
            if (done) break;
            for (let i = 0; i < value.length; i++) {
              buffer[buffer_i++] = value[i];
              if (buffer_i === BATCH_SIZE) {
                serialWorker.postMessage({ type: 'rawData', data: buffer });
                buffer_i = 0;
              }
            }
          }
        } catch (error) {
          console.error('Read error:', error);
          this.onStatus('Read error');
        } finally {
          this.reader?.releaseLock();
        }
      };

      startReading();
      return true;
    } catch (error) {
      console.error('Connection error:', error);
      this.onStatus('Connection failed');
      return false;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      await this.port?.close();
      this.onStatus('Disconnected');
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  setSelectedAxis(axis: 'x' | 'y' | 'z'): void {
    serialWorker.postMessage({ type: 'setSelectedAxis', axis });
  }

  setRange(minFrequency: number, maxFrequency: number): void {
    serialWorker.postMessage({ type: 'setRange', minFrequency, maxFrequency });
  }
}

export class SimulationDataSource implements DataSource {
  private onData: (data: Int16Array) => void;
  private onFrequency: (freq: number) => void;
  private onStatus: (status: string) => void;
  private isConnected = false;

  constructor(
    onData: (data: Int16Array) => void,
    onFrequency: (freq: number) => void,
    onStatus: (status: string) => void
  ) {
    this.onData = onData;
    this.onFrequency = onFrequency;
    this.onStatus = onStatus;

    // Set up worker message listener for spectrogram data
    serialChannel.addEventListener('message', (e: MessageEvent) => {
      const { data, frequency: workerFrequency } = e.data;
      this.onData(data);
      this.onFrequency(workerFrequency);
    });
  }

  async start(): Promise<boolean> {
    this.stop(); // Clear any existing simulation
    let simulationFrequency = SIMULATION_MIN_FREQUENCY;

    let t = 0;
    this.isConnected = true;
    this.onStatus('Simulation Mode');
    let skipped = 0;

    const buffer = new Uint8Array(6 * BATCH_SIZE);
    while (this.isConnected) {
      for (let i = 0; i < BATCH_SIZE; i++) {
        t += 1 / FIXED_SAMPLE_RATE;

        simulationFrequency += 0.0;
        if (simulationFrequency > SIMULATION_MAX_FREQUENCY)
          simulationFrequency = SIMULATION_MIN_FREQUENCY;
        // Generate simulated sine wave data for each axis
        const v = Math.sin(t * 2 * Math.PI * simulationFrequency) * SIMULATION_AMPLITUDE;
        const simulatedData = new Int16Array([Math.round(v), Math.round(v), Math.round(v)]);

        // Send data through the same pipeline as real USB data
        // Pack the data in the same format as real USB data
        buffer[i * 6 + 0] = 255; // marker

        // Pack x, y, z into 5 bytes (13 bits each)
        const packed =
          (BigInt(simulatedData[2]) & 0x1fffn) |
          ((BigInt(simulatedData[1]) & 0x1fffn) << 13n) |
          ((BigInt(simulatedData[0]) & 0x1fffn) << 26n);

        buffer[i * 6 + 1] = Number((packed >> 0n) & 0xffn);
        buffer[i * 6 + 2] = Number((packed >> 8n) & 0xffn);
        buffer[i * 6 + 3] = Number((packed >> 16n) & 0xffn);
        buffer[i * 6 + 4] = Number((packed >> 24n) & 0xffn);
        buffer[i * 6 + 5] = Number((packed >> 32n) & 0xffn);

        // Send to worker for processing (this will trigger spectrogram updates)

        // Also send directly to UI for immediate display
        if (++skipped > FIXED_SAMPLE_RATE / AXIS_REPORT_RATE_HZ) {
          this.onData(simulatedData);
          skipped = 0;
        }
      }
      serialWorker.postMessage({ type: 'rawData', data: buffer });
      await sleep((1000 * BATCH_SIZE) / FIXED_SAMPLE_RATE);
    }

    return true;
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.onStatus('Disconnected');
  }

  setSelectedAxis(axis: 'x' | 'y' | 'z'): void {
    serialWorker.postMessage({ type: 'setSelectedAxis', axis });
  }

  setRange(minFrequency: number, maxFrequency: number): void {
    serialWorker.postMessage({ type: 'setRange', minFrequency, maxFrequency });
  }
}
