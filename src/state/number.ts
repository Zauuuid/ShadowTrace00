/** Number-field helpers: tolerant parsing (separators, Arabic-Indic digits) and clamping with a flag for the UI. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function parseNumber(s: string): number | null {
  const ascii = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[,\s٬]/g, '').replace('٫', '.');
  if (!/^-?\d+(\.\d+)?$/.test(ascii)) return null;
  const v = Number(ascii);
  return Number.isFinite(v) ? v : null;
}

export function clamp(v: number, min: number, max: number): { value: number; clamped: boolean } {
  const value = Math.max(min, Math.min(max, v));
  return { value, clamped: value !== v };
}
