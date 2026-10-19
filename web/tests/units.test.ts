import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS, groundText, paperText, parseLength, type LengthContext } from '../src/units';

// The Zarquos scan: 127 m per pixel, a 1:1 000 000 map, scale in km.
const c: LengthContext = { units: DEFAULT_UNITS, mPerPx: 127, plain: 'km' };
const px = (s: string, ctx = c) => {
  const r = parseLength(s, ctx);
  if ('error' in r) throw new Error(`${s}: ${r.error}`);
  return r;
};

describe('lengths', () => {
  it('a plain number is in the unit of the map scale', () => {
    expect(px('127').px).toBeCloseTo(1000);
    expect(px('12,7').px).toBeCloseTo(100);
    expect(px('12,7').expr).toBeUndefined();
  });

  it('ground units, game units, sheet units', () => {
    expect(px('127 km').px).toBeCloseTo(1000);
    expect(px('127000 m').px).toBeCloseTo(1000);
    expect(px('560606 mesures').px * 127).toBeCloseTo(560606 * 0.33, 3); // ≈ 185 km
    expect(px('560 606 mesures').px).toBeCloseTo(px('560606 mesures').px);
    expect(px('18,5 cm').px * 127).toBeCloseTo(185000); // 18.5 cm of map = 185 km
    expect(px('2,6 mm de carte').px * 127).toBeCloseTo(2600);
    expect(px('100 px').px).toBeCloseTo(100);
  });

  it('formulas, kept as typed', () => {
    const r = px('86164/46241860 * 300000 km');
    expect(r.px * 127).toBeCloseTo((86164 / 46241860) * 3e8, 3); // ≈ 559 km
    expect(r.expr).toBe('86164/46241860 * 300000 km');
    expect(px('1 km + 500 m').px * 127).toBeCloseTo(1500);
    expect(px('2 × (3 km - 1 km)').px * 127).toBeCloseTo(4000);
    expect(px('8000 mesures').px * 127).toBeCloseTo(2640);
  });

  it('errors in words', () => {
    expect(parseLength('3 km km', c)).toHaveProperty('error');
    expect(parseLength('2 km * 3 km', c)).toHaveProperty('error');
    expect(parseLength('1 / 0', c)).toHaveProperty('error');
    expect(parseLength('abc', c)).toHaveProperty('error');
    expect(parseLength('(2 km', c)).toHaveProperty('error');
  });

  it('without a scale: pixels only', () => {
    const none: LengthContext = { units: DEFAULT_UNITS, mPerPx: 0, plain: 'px' };
    expect(px('250', none).px).toBe(250);
    expect(px('2 * 125', none).px).toBe(250);
    expect(parseLength('3 km', none)).toHaveProperty('error');
  });

  it('written on the ground and on the sheet', () => {
    expect(groundText(185000)).toBe('185,0 km');
    expect(groundText(18500)).toBe('18,50 km');
    expect(groundText(650)).toBe('650 m');
    expect(groundText(6.93)).toBe('6,93 m');
    expect(paperText(185000, DEFAULT_UNITS)).toBe('18,50 cm');
    expect(paperText(2640, DEFAULT_UNITS)).toBe('2,64 mm');
    expect(paperText(6.93, DEFAULT_UNITS)).toBe('0,007 mm');
  });
});

describe('directions', async () => {
  const { parseAzimuth } = await import('../src/units');
  it('degrees, cardinal points, bearings', () => {
    expect(parseAzimuth('210')).toBe(210);
    expect(parseAzimuth('-90°')).toBe(270);
    expect(parseAzimuth('sud')).toBe(180);
    expect(parseAzimuth('nord-est')).toBe(45);
    expect(parseAzimuth('SW')).toBe(225);
    expect(parseAzimuth('Sud-Ouest')).toBe(225);
    expect(parseAzimuth('ouest')).toBe(270);
    expect(parseAzimuth('NNO')).toBe(337.5);
    expect(parseAzimuth('N 30° E')).toBe(30);
    expect(parseAzimuth('S 12 O')).toBe(192);
    expect(parseAzimuth('N 10 W')).toBe(350);
    expect(parseAzimuth('est')).toBe(90);
    expect(parseAzimuth('par là')).toHaveProperty('error');
  });
});
