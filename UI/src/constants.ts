// Global constants for the application

// Public links
export const REPO_URL = 'https://github.com/dbuezas/usb-Input-shaper-calibrator';

// === Serial + transport ===

// Used by `src/data-source.ts` when opening the serial port.
export const SERIAL_BAUD_RATE = 230400;

// Bytes per chunk forwarded to the worker:
// - `src/data-source.ts` accumulates raw bytes into `BATCH_SIZE` chunks before posting
//   `{ type: 'rawData', data }` to `src/serial-worker.ts`.
// - `src/simulation-port.ts` also emits `BATCH_SIZE` bytes per tick.
export const BATCH_SIZE = 1000;

// === Streaming / reporting ===

// Fixed sample rate assumed by the DSP pipeline.
// Used in `src/serial-worker.ts` (FFT/PSD scaling) and `src/simulation-port.ts` timing.
export const FIXED_SAMPLE_RATE = 3200;

// How often `src/serial-worker.ts` recomputes the input frequency estimate.
export const REPORT_HZ_EVERY_MS = 100;

// Throttles how often axis data is posted back to the UI from `src/serial-worker.ts`.
export const AXIS_REPORT_RATE_HZ = 10;

// Size (in bytes) of the raw input ring buffer inside `src/serial-worker.ts`.
export const BUFFER_SIZE = 1024 * 10;

// === Spectrogram / FFT sizing ===

// Desired (target) bin resolution used to choose a power-of-two FFT window.
// `WINDOW_SIZE` is derived from this and `FIXED_SAMPLE_RATE`.
const RESOLUTION_HZ = 1;

// Target window length in samples for the desired resolution.
const TARGET_WINDOW_SIZE = FIXED_SAMPLE_RATE / RESOLUTION_HZ;

// FFT size used by `src/serial-worker.ts`.
// Rounded up to a power of two for efficient FFT.
export const WINDOW_SIZE = 2 ** Math.ceil(Math.log2(TARGET_WINDOW_SIZE));

// Actual bin resolution that results from the chosen `WINDOW_SIZE`.
// Used by `src/Spectrogram.tsx` to convert bin index -> Hz (peak readout).
export const ACTUAL_RESOLUTION = FIXED_SAMPLE_RATE / WINDOW_SIZE;

// Step between successive FFT frames.
// Used by `src/serial-worker.ts` to decide when to compute a new spectrogram slice.
export const HOP_SIZE = Math.floor(WINDOW_SIZE / 256);
export const SECONDS_PER_SLICE = HOP_SIZE / FIXED_SAMPLE_RATE;

// FFT bin -> frequency mapping helpers used in `src/Spectrogram.tsx`.
export const MIN_FREQ = FIXED_SAMPLE_RATE / WINDOW_SIZE;
export const MAX_FREQ = FIXED_SAMPLE_RATE / 2;

// === UI ranges ===

// Frequency range slider bounds used in `src/Spectrogram.tsx`.
// (Set lower than Nyquist for convenience/readability.)
export const MAX_FREQUENCY_SLIDER = 200; // could be `FIXED_SAMPLE_RATE / 2`
export const MIN_FREQUENCY_SLIDER = 10;

export const FREQUENCY_SLIDER_RANGE_HZ: [number, number] = [
  MIN_FREQUENCY_SLIDER,
  MAX_FREQUENCY_SLIDER,
];

// === Visualisations ===

// Shared plot padding used by canvas renders and D3 axis overlays.
export const VIS_AXIS_PADDING = {
  left: 44,
  right: 44,
  top: 10,
  bottom: 28,
} as const;

// Default spectrogram plot dimensions.
export const SPECTROGRAM_PLOT_WIDTH = 800;
export const SPECTROGRAM_WATERFALL_HEIGHT = 300;

// Number of historic rows shown in the waterfall.
export const SPECTROGRAM_WATERFALL_SECONDS = 20;

// === Web workers ===

// Number of parallel workers used for expensive computations (e.g. input shaper optimisation).
// Keep this modest to avoid saturating the main thread with message handling.
export const WEB_WORKER_THREADS = Math.max(1, navigator.hardwareConcurrency - 1);

// === Simulation ===

// Sweep parameters for `src/simulation-port.ts`.
export const SIMULATION_MIN_FREQUENCY = 1;
export const SIMULATION_MAX_FREQUENCY = 200;
export const SIMULATION_AMPLITUDE = 1000;

// === Shaper / Optimiser UI bounds ===

// These constants define the min/max shown in the ShaperScreen sliders.
// Keep the optimiser bounds in sync by importing these in the worker.

export const SHAPER_F0_RANGE_HZ: [number, number] = [10, 300];
export const SHAPER_ZETA_RANGE: [number, number] = [0.01, 0.25];
export const SHAPER_VTOL_RANGE: [number, number] = [0.01, 1];

export const SEARCH_F_STEP_HZ = 0.5;
export const SEARCH_ZETA_STEP = 0.01;
export const SEARCH_VTOL_STEP = 0.05;

export const CORNERING_SPEED_RANGE_MM_S: [number, number] = [0.5, 60];
export const CORNERING_JUNCTION_DEVIATION_RANGE_MM: [number, number] = [0, 0.2];
export const CORNERING_JERK_RANGE_MM_S: [number, number] = [0, 50];

export const OPTIMIZER_UPDATE_EVERY_MS = 200;
