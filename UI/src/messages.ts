export interface RawDataMessage {
  frequency: number;
  data: Int16Array;
}

export interface SpectrumSliceMessage {
  type: 'spectrumSlice';
  spectrum: number[];
}

export interface WelchPsdSliceMessage {
  type: 'welchPsdSlice';
  psd: number[];
}

export interface SetSelectedAxisMessage {
  type: 'setSelectedAxis';
  axis: 'x' | 'y' | 'z';
}

export type WindowFunctionType = 'hann' | 'hamming' | 'blackman' | 'rectangular';

export interface SetWindowFunctionMessage {
  type: 'setWindowFunction';
  window: WindowFunctionType;
}

export const serialChannel = new BroadcastChannel('serial');
export const spectrogramChannel = new BroadcastChannel('spectrogram');
