import { serialChannel, type RawDataMessage } from './messages';
import SerialWorker from './serial-worker?worker';
import { SERIAL_BAUD_RATE, BATCH_SIZE } from '../../constants';
const serialWorker = new SerialWorker();

export interface DataSource {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  setSelectedAxis(axis: 'x' | 'y' | 'z'): void;
}

export type SerialLikePort = {
  readable?: ReadableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

export class SerialDataSource implements DataSource {
  private port: SerialPort | SerialLikePort;
  private reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>> | undefined;
  private onData: (data: Int16Array) => void;
  private onFrequency: (freq: number) => void;
  private onStatus: (status: string) => void;

  constructor(
    port: SerialPort | SerialLikePort,
    onData: (data: Int16Array) => void,
    onFrequency: (freq: number) => void,
    onStatus: (status: string) => void
  ) {
    this.port = port;
    this.onData = onData;
    this.onFrequency = onFrequency;
    this.onStatus = onStatus;

    // Set up worker message listener
    serialChannel.addEventListener('message', (e: MessageEvent<RawDataMessage>) => {
      const { data, frequency: workerFrequency } = e.data;
      this.onData(data);
      this.onFrequency(workerFrequency);
    });
  }

  async start(): Promise<boolean> {
    try {
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

      void startReading();
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
      this.reader = undefined;
      await this.port.close();
      this.onStatus('Disconnected');
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  setSelectedAxis(axis: 'x' | 'y' | 'z'): void {
    serialWorker.postMessage({ type: 'setSelectedAxis', axis });
  }
}
