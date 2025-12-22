export class CircularBuffer {
  buffer: Uint8Array;
  writeIndex: number;
  readIndex: number;
  available: number;

  constructor(size: number) {
    this.buffer = new Uint8Array(size);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
  }

  append(data: Uint8Array): void {
    for (const byte of data) {
      this.buffer[this.writeIndex++] = byte;
      if (this.writeIndex == this.buffer.length) this.writeIndex = 0;
      this.available++;
    }
  }

  getByte(offset: number): number {
    return this.buffer[(this.readIndex + offset) % this.buffer.length];
  }

  consume(count: number): void {
    this.readIndex = (this.readIndex + count) % this.buffer.length;
    this.available -= count;
  }
}
