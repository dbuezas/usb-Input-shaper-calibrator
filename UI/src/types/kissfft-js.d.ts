declare module 'kissfft-js' {
  export class FFTR {
    constructor(size: number);
    forward(real: Float32Array): Float32Array;
    inverse(cpx: Float32Array): Float32Array;
    dispose(): void;
  }

  export class FFT {
    constructor(size: number);
    forward(cpx: Float32Array): Float32Array;
    inverse(cpx: Float32Array): Float32Array;
    dispose(): void;
  }
}
