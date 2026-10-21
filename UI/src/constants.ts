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

// Sample rate assumed until the firmware reports its own (older firmware never does).
// See `src/screens/MeasureScreen/serial-protocol.ts`.
export const DEFAULT_SAMPLE_RATE = 3200;

// Sample rates the firmware may report (ADXL345: 3200 Hz, LIS2DW12: 1600 Hz).
// Each is DEFAULT_SAMPLE_RATE / 2^n, so every rate gets the same FFT bin width and slice duration (see below).
export const SUPPORTED_SAMPLE_RATES = [3200, 1600, 800, 400];

// How often `src/serial-worker.ts` recomputes the input frequency estimate.
export const REPORT_HZ_EVERY_MS = 500;

// Throttles how often axis data is posted back to the UI from `src/serial-worker.ts`.
export const AXIS_REPORT_RATE_HZ = 10;

// Size (in bytes) of the raw input ring buffer inside `src/serial-worker.ts`.
export const BUFFER_SIZE = 1024 * 10;

// === Spectrogram / FFT sizing ===

// Desired (target) bin resolution used to choose a power-of-two FFT window.
const RESOLUTION_HZ = 1;

// FFT size at `DEFAULT_SAMPLE_RATE`, rounded up to a power of two for efficient FFT.
const DEFAULT_WINDOW_SIZE = 2 ** Math.ceil(Math.log2(DEFAULT_SAMPLE_RATE / RESOLUTION_HZ));

// Bin width in Hz (bin index -> Hz). The FFT window always covers the same time span,
// so this is the same at every supported sample rate; only the number of bins changes.
export const ACTUAL_RESOLUTION = DEFAULT_SAMPLE_RATE / DEFAULT_WINDOW_SIZE;

// FFT size used by `src/serial-worker.ts` for a sample rate.
export const windowSizeForRate = (sampleRate: number) => sampleRate / ACTUAL_RESOLUTION;

// Step between successive FFT frames (samples).
// Used by `src/serial-worker.ts` to decide when to compute a new spectrogram slice.
export const hopSizeForRate = (sampleRate: number) => windowSizeForRate(sampleRate) / 256;
export const SECONDS_PER_SLICE = hopSizeForRate(DEFAULT_SAMPLE_RATE) / DEFAULT_SAMPLE_RATE;

// Number of spectrum bins at the highest supported rate (the shaper response is computed for all of them).
export const MAX_SPECTRUM_BINS = DEFAULT_WINDOW_SIZE / 2 + 1;

// === UI ranges ===

// Frequency range slider bounds used in `src/Spectrogram.tsx`.
export const FREQUENCY_SLIDER_RANGE_HZ: [number, number] = [10, 200];

// === Visualisations ===

// Shared plot padding used by canvas renders and D3 axis overlays.
export const VIS_AXIS_PADDING = {
  left: 60,
  right: 60,
  top: 10,
  bottom: 38,
} as const;

// Default spectrogram plot dimensions.
export const SPECTROGRAM_WATERFALL_HEIGHT = 250;

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

// Any shaper parameter candidate that doesn't reduce the peak resonance by more
// than this value is discarded.
// this is mostly used to speed up the process and hide ridiculous candidates,
// even if they result in very high suggested max accel.
export const MIN_RESONANCE_REDUCTION_AT_SPECTROGRAM_PEAK = 0.5;

// These constants define the min/max shown in the ShaperScreen sliders.
// Keep the optimiser bounds in sync by importing these in the worker.

// Marlin limits (Marlin/src/module/ft_motion/shaping.h, Configuration_adv.h):
// - M493 A<Hz> must be within FTM_MIN_SHAPE_FREQ..FTM_FS/2.
// - FTM_FS is the trajectory sample rate (Hz). Marlin rounds the tap spacing to whole samples of it.
export const FTM_MIN_SHAPE_FREQ_HZ = 20;
export const DEFAULT_FTM_FS_HZ = 1000;
export const FTM_FS_RANGE_HZ: [number, number] = [100, 5000];

// Highest f0 the sliders / optimiser offer (also capped to FTM_FS/2, see `shaperF0RangeHz`).
const SHAPER_F0_MAX_HZ = 300;
export const shaperF0RangeHz = (ftmFs: number): [number, number] => [
  FTM_MIN_SHAPE_FREQ_HZ,
  Math.min(SHAPER_F0_MAX_HZ, ftmFs / 2),
];
export const SHAPER_ZETA_RANGE: [number, number] = [0.0, 0.25];
export const SHAPER_VTOL_RANGE: [number, number] = [0.0, 1];
// 2HEI computes 0/0 (NaN gains) at vtol = 0 in Marlin, so keep a little above zero.
export const SHAPER_2HEI_MIN_VTOL = 0.005;

export const SEARCH_F_STEP_HZ = 0.5;
export const SEARCH_ZETA_STEP = 0.01;
export const SEARCH_VTOL_STEP = 0.05;

// Simple shaper mode shows the corner rounding at the user's print acceleration.
export const DEFAULT_PRINT_ACCEL = 5000;
export const PRINT_ACCEL_RANGE: [number, number] = [100, 100_000];
// The corner simulation in Simple mode: wall speed (mm/s), leg length (mm) and resonance damping.
export const CORNER_SIM_SPEED_MM_S = 100;
export const CORNER_SIM_LEG_MM = 3;
export const CORNER_SIM_ZETA = 0.1;

export const CORNERING_SPEED_RANGE_MM_S: [number, number] = [0.5, 60];
export const CORNERING_JUNCTION_DEVIATION_RANGE_MM: [number, number] = [0, 0.2];
export const CORNERING_JERK_RANGE_MM_S: [number, number] = [0, 50];

export const OPTIMIZER_UPDATE_EVERY_MS = 200;
