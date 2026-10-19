/**
 * Lengths as the hunt speaks of them: on the sheet (mm, cm of the map) or on
 * the ground (m, km, « mesures » of 33 cm), typed as formulas
 * (« 86164/46241860 * 300000 km ») and written both ways.
 *
 * The figures are drawn on the sheet: a length on the ground becomes pixels
 * through the nominal scale of the map (1 : 1 000 000 for the 989), never
 * through the GPS calibration, which only tells how far the ground really is.
 */

import { fmt } from './ui/dom';

export interface MapUnits {
  /** Scale of the paper map: 1 : paper. */
  paper: number;
  /** One « mesure », in meters (the 33 cm foot of the 780). */
  measure: number;
  /** How precisely a position can be read on the sheet, in mm. */
  precisionMm: number;
  /** The north of « vers le sud », « nord-est »…: up on the sheet, or the local meridian. */
  north: 'sheet' | 'meridian';
}

export const DEFAULT_UNITS: MapUnits = { paper: 1_000_000, measure: 0.33, precisionMm: 0.3, north: 'sheet' };

export interface LengthContext {
  units: MapUnits;
  /** Meters on the ground for one pixel, by the nominal scale; 0 when the scale is not set. */
  mPerPx: number;
  /** Unit of a number typed alone: the unit of the map scale, or px without a scale. */
  plain: 'km' | 'm' | 'px';
}

type UnitName = 'm' | 'km' | 'mm' | 'cm' | 'mesure' | 'px';

const UNIT_WORDS: [RegExp, UnitName][] = [
  [/^(mesures?)/i, 'mesure'],
  [/^(km|kilom[eè]tres?)/i, 'km'],
  [/^(mm|millim[eè]tres?)(\s*(de\s+)?carte)?/i, 'mm'],
  [/^(cm|centim[eè]tres?)(\s*(de\s+)?carte)?/i, 'cm'],
  [/^(px|pixels?)/i, 'px'],
  [/^(m|m[eè]tres?)(?![a-z])/i, 'm'],
];

/** Meters on the ground for one of this unit. */
function factor(u: UnitName, c: LengthContext): number {
  switch (u) {
    case 'm':
      return 1;
    case 'km':
      return 1000;
    case 'mesure':
      return c.units.measure;
    case 'mm':
      return c.units.paper / 1000; // 1 mm of map at 1:1 000 000 = 1 km
    case 'cm':
      return c.units.paper / 100;
    case 'px':
      return c.mPerPx || NaN;
  }
}

export interface Length {
  /** Pixels of the sheet. */
  px: number;
  /** The formula as typed, when it is more than a plain number. */
  expr?: string;
}

/** A value with its dimension: 0 for a plain number, 1 for a length. */
interface V {
  v: number;
  d: number;
}

/**
 * Read a length: a number or a formula, with units anywhere
 * (« 560606 mesures », « 18,5 cm », « 1 km + 500 m », « 86164/46241860 * 300000 km »).
 * A number without unit is in the unit of the map scale (px if there is none).
 */
export function parseLength(text: string, c: LengthContext): Length | { error: string } {
  const src = text.trim();
  let i = 0;
  const space = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const number = (): number | null => {
    const m = /^\d+(?:[   ]\d{3})*(?:[.,]\d+)?(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0].replace(/[   ]/g, '').replace(',', '.'));
  };
  const unit = (): UnitName | null => {
    space();
    for (const [re, u] of UNIT_WORDS) {
      const m = re.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        return u;
      }
    }
    return null;
  };
  const withUnit = (x: V): V => {
    const u = unit();
    if (!u) return x;
    if (x.d !== 0) fail('Une unité de trop.');
    const f = factor(u, c);
    if (!Number.isFinite(f)) fail('Les pixels demandent l\'échelle de la carte.');
    return { v: x.v * f, d: 1 };
  };
  const primary = (): V => {
    space();
    if (src[i] === '(') {
      i++;
      const x = sum();
      space();
      if (src[i] !== ')') fail('Parenthèse non fermée.');
      i++;
      return withUnit(x);
    }
    if (src[i] === '-' || src[i] === '−') {
      i++;
      const x = primary();
      return { v: -x.v, d: x.d };
    }
    const n = number();
    if (n === null) fail(i < src.length ? `Je ne comprends pas « ${src.slice(i, i + 12)} ».` : 'Formule incomplète.');
    return withUnit({ v: n!, d: 0 });
  };
  const product = (): V => {
    let x = primary();
    for (;;) {
      space();
      const op = src[i];
      if (op !== '*' && op !== '×' && op !== '/' && op !== '÷' && op !== ':') return x;
      i++;
      const y = primary();
      if (op === '/' || op === '÷' || op === ':') {
        if (y.v === 0) fail('Division par zéro.');
        x = { v: x.v / y.v, d: x.d - y.d };
      } else x = { v: x.v * y.v, d: x.d + y.d };
    }
  };
  // A plain number added to a length is taken in the plain unit.
  const plain = (x: V): V => (x.d === 0 ? { v: x.v * plainFactor(), d: 1 } : x);
  const plainFactor = () => (c.plain === 'px' ? c.mPerPx || 1 : c.plain === 'km' ? 1000 : 1);
  const sum = (): V => {
    let x = product();
    for (;;) {
      space();
      const op = src[i];
      if (op !== '+' && op !== '-' && op !== '−') return x;
      i++;
      let y = product();
      if (x.d !== y.d) {
        if (x.d === 0) x = plain(x);
        else if (y.d === 0) y = plain(y);
        if (x.d !== y.d) fail('On ne peut pas ajouter une longueur et une surface.');
      }
      x = { v: op === '+' ? x.v + y.v : x.v - y.v, d: x.d };
    }
  };
  try {
    if (!src) fail('Saisissez une longueur.');
    let x = sum();
    space();
    if (i < src.length) fail(`Je ne comprends pas « ${src.slice(i, i + 12)} ».`);
    if (x.d === 0) {
      if (c.plain === 'px' && !c.mPerPx) return { px: x.v, ...(isFormula(src) ? { expr: src } : {}) };
      x = plain(x);
    }
    if (x.d !== 1) fail('Ce n\'est pas une longueur (une unité de trop ou en moins).');
    if (!c.mPerPx) fail('Sans échelle de carte, saisissez des pixels (px).');
    return { px: x.v / c.mPerPx, ...(isFormula(src) ? { expr: src } : {}) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** More than a number in the unit of the map: worth keeping as typed. */
const isFormula = (s: string) => !/^\s*\d+(?:[.,]\d+)?\s*$/.test(s);

/** A length on the ground, in m or km. */
export function groundText(m: number, digits?: number): string {
  const a = Math.abs(m);
  if (a >= 1000) return `${fmt(m / 1000, digits ?? (a >= 100_000 ? 1 : 2))} km`;
  return `${fmt(m, digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : 2))} m`;
}

/** A length on the sheet, in mm or cm. */
export function paperText(m: number, u: MapUnits): string {
  const mm = (m / u.paper) * 1000;
  if (Math.abs(mm) >= 100) return `${fmt(mm / 10, 2)} cm`;
  return `${fmt(mm, Math.abs(mm) < 1 ? 3 : 2)} mm`;
}

/** The ground meters a paper precision stands for. */
export const precisionMeters = (u: MapUnits) => (u.precisionMm / 1000) * u.paper;

/* ============================================================ azimuths */

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** A cardinal point in letters: « nord-est » → NE, « sud-ouest » → SO, W → O. */
function compassLetters(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/NORD/g, 'N').replace(/SUD/g, 'S').replace(/OUEST/g, 'O').replace(/EST/g, 'E').replace(/W/g, 'O')
    .replace(/[\s-]+/g, '');
}

/**
 * Read a direction: degrees clockwise from the north (« 210 », « 210° »),
 * a cardinal point (« NE », « sud-ouest », « N-NO »), or a quadrant bearing
 * (« N 30° E », « S 12 O »). Returns degrees in [0, 360).
 */
export function parseAzimuth(text: string): number | { error: string } {
  const t = text.trim().replace(',', '.');
  const num = /^(-?\d+(?:\.\d+)?)\s*°?$/.exec(t);
  if (num) return ((parseFloat(num[1]) % 360) + 360) % 360;
  const letters = compassLetters(t);
  const b = /^([NS])(\d+(?:\.\d+)?)°?([EO])$/.exec(letters);
  if (b) {
    const a = parseFloat(b[2]);
    if (a > 90) return { error: 'Dans « N 30° E », l\'angle ne dépasse pas 90°.' };
    const az = b[1] === 'N' ? (b[3] === 'E' ? a : 360 - a) : b[3] === 'E' ? 180 - a : 180 + a;
    return ((az % 360) + 360) % 360;
  }
  const i = POINTS.indexOf(letters);
  if (i >= 0) return i * 22.5;
  return { error: 'Un azimut en degrés (210), un point cardinal (NE, sud-ouest) ou un cap (N 30° E).' };
}
