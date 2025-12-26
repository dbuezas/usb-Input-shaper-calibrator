// Global constants for the application

// Spectrogram processing constants
export const FIXED_SAMPLE_RATE = 3200;
const RESOLUTION_HZ = 1;
export const REPORT_HZ_EVERY_MS = 100;
export const AXIS_REPORT_RATE_HZ = 10;
export const BUFFER_SIZE = 1024 * 10; // 10KB circular buffer

const TARGET_WINDOW_SIZE = FIXED_SAMPLE_RATE / RESOLUTION_HZ;
export const WINDOW_SIZE = 2 ** Math.ceil(Math.log2(TARGET_WINDOW_SIZE));
export const ACTUAL_RESOLUTION = FIXED_SAMPLE_RATE / WINDOW_SIZE;
export const HOP_SIZE = Math.floor(WINDOW_SIZE / 256);

export const MIN_FREQ = FIXED_SAMPLE_RATE / WINDOW_SIZE;
export const MAX_FREQ = FIXED_SAMPLE_RATE / 2;

// Sample rate and frequency constants
export const MAX_FREQUENCY_SLIDER = 300; //FIXED_SAMPLE_RATE / 2;
export const MIN_FREQUENCY_SLIDER = 0;

// Serial communication constants
export const SERIAL_BAUD_RATE = 230400;
export const BATCH_SIZE = 1000;

// Simulation constants
export const SIMULATION_MIN_FREQUENCY = 1;
export const SIMULATION_MAX_FREQUENCY = 200;
export const SIMULATION_AMPLITUDE = 1000;
export const SIMULATION_SWEEP_S = 5; // SECONDS
