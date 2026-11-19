/**
 * The colors proposed for the drawings: dark ones only. The maps are
 * colorful (green, cream, pink, blue), and a light stroke is lost on them.
 */

/** Dark enough to be read on a map: a contrast of 4.5 at least against white. */
export function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) >= 4.5;
}

export const DARK_COLORS = [
  '#000000', '#444444', '#c01414', '#7a0c1e', '#b85000', '#6b3410', '#8a6d00', '#5f7a00',
  '#1b7a2a', '#0b4d1c', '#0f7a5a', '#00707d', '#1a4fc0', '#0b2a7a', '#6a23bd', '#55007f',
  '#a3164e', '#b0127a',
];
