// Global constants for the application

// Spectrogram processing constants
export const FIXED_SAMPLE_RATE = 3200;
export const RESOLUTION_HZ = 10;
export const REPORT_HZ_EVERY_MS = 1000;
export const AXIS_REPORT_RATE_HZ = 10;
export const BUFFER_SIZE = 1024 * 10; // 10KB circular buffer

// Sample rate and frequency constants
export const MAX_DISPLAY_FREQUENCY = FIXED_SAMPLE_RATE / 2;
export const MIN_FREQUENCY_SLIDER = 0;
export const MIN_SLIDER_GAP = 1;

// Serial communication constants
export const SERIAL_BAUD_RATE = 230400;
export const BATCH_SIZE = 1000;

// Simulation constants
export const SIMULATION_MIN_FREQUENCY = 20;
export const SIMULATION_AMPLITUDE = 1000;
export const SIMULATION_MAX_FREQUENCY = 100;
