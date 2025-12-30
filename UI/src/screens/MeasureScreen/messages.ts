export interface RawDataMessage {
  frequency: number;
  data: Int16Array;
}

export interface SpectrumSliceMessage {
  type: 'spectrumSlice';
  spectrum: Float32Array;
}

export interface SetSelectedAxisMessage {
  type: 'setSelectedAxis';
  axis: 'x' | 'y' | 'z';
}

export const serialChannel = new BroadcastChannel('serial');
export const spectrogramChannel = new BroadcastChannel('spectrogram');
