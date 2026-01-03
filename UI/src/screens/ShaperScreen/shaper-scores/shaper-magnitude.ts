export const shaperMagnitudeAtHzFromTaps = (a: number[], t: number[], freqHz: number) => {
  const w = 2 * Math.PI * freqHz;
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    const phase = -w * (t[i] ?? 0);
    re += (a[i] ?? 0) * Math.cos(phase);
    im += (a[i] ?? 0) * Math.sin(phase);
  }
  return Math.sqrt(re * re + im * im);
};
