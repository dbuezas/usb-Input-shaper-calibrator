import SerialWorker from './serial-worker?worker';
import { serialChannel } from './messages';

const serialWorker = new SerialWorker();

export class SerialService {
  private port: any = null;
  private reader: any = null;
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

    // Set up worker message listener
    serialChannel.addEventListener('message', (e: MessageEvent) => {
      const { data, frequency: workerFrequency } = e.data;
      this.onData(data);
      this.onFrequency(workerFrequency);
    });
  }

  async connect() {
    try {
      if (!('serial' in navigator)) {
        this.onStatus('Web Serial API not supported');
        return false;
      }

      const serialApi = (navigator as any).serial;
      if (!serialApi) {
        this.onStatus('Web Serial API not supported');
        return false;
      }

      const port = await serialApi.requestPort();
      await port.open({ baudRate: 230400 });

      this.port = port;
      this.isConnected = true;
      this.onStatus('Connected');

      const reader = port.readable?.getReader();
      if (!reader) {
        this.onStatus('Failed to get reader');
        return false;
      }
      this.reader = reader;

      const startReading = async () => {
        try {
          const BATCH_SIZE = 1000;
          let buffer_i = 0;
          const buffer = new Uint8Array(BATCH_SIZE);
          while (true) {
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
          if (this.reader) {
            this.reader.releaseLock();
          }
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

  async disconnect() {
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
      this.isConnected = false;
      this.onStatus('Disconnected');
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  setSelectedAxis(axis: 'x' | 'y' | 'z') {
    serialWorker.postMessage({ type: 'setSelectedAxis', axis });
  }

  setRange(minFrequency: number, maxFrequency: number) {
    serialWorker.postMessage({ type: 'setRange', minFrequency, maxFrequency });
  }

  getIsConnected() {
    return this.isConnected;
  }
}
