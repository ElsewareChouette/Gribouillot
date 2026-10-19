/**
 * GPS coordinates on a scanned map.
 *
 * The map is tied to the ground by anchors: points of the map whose latitude
 * and longitude are known (usually towns). Latitudes and longitudes are
 * projected in Lambert-93, the official conic projection of France, where a
 * paper map is close to a plane figure; then a transformation from the map
 * pixels to Lambert-93 is fitted by least squares on the anchors.
 *
 * The precision is measured honestly: each anchor is placed by the
 * transformation fitted on the other ones, and its error is the distance
 * between that position and the true one.
 */

import { pt, type Pt } from './geom';

export interface LatLon {
  lat: number; // degrees, north positive
  lon: number; // degrees, east positive
}

export interface Anchor extends LatLon {
  id: string;
  p: Pt; // position on the map, scene pixels
  name: string;
}

/* ============================================================ Lambert-93 */

const E = 0.0818191910428158; // first eccentricity of GRS80
const N = 0.725607765053267;
const C = 11754255.426096;
const XS = 700000;
const YS = 12655612.049876;
const LON0 = (3 * Math.PI) / 180;

/** Latitude and longitude (WGS84, the same as RGF93 at this scale) -> Lambert-93 meters. */
export function toLambert(ll: LatLon): Pt {
  const phi = (ll.lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const iso = Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2));
  const r = C * Math.exp(-N * iso);
  const g = N * ((ll.lon * Math.PI) / 180 - LON0);
  return pt(XS + r * Math.sin(g), YS - r * Math.cos(g));
}

export function fromLambert(p: Pt): LatLon {
  const dx = p.x - XS, dy = YS - p.y;
  const r = Math.hypot(dx, dy);
  const g = Math.atan2(dx, dy);
  const iso = -Math.log(r / C) / N;
  let phi = 2 * Math.atan(Math.exp(iso)) - Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(phi);
    phi = 2 * Math.atan(Math.pow((1 + E * s) / (1 - E * s), E / 2) * Math.exp(iso)) - Math.PI / 2;
  }
  return { lat: (phi * 180) / Math.PI, lon: ((LON0 + g / N) * 180) / Math.PI };
}

/* ======================================================= least squares */

/** Solve the square system a·x = b (Gauss with partial pivoting), null if singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[best][c])) best = r;
    if (Math.abs(m[best][c]) < 1e-10) return null;
    [m[c], m[best]] = [m[best], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Least squares solution of the rows · x ≈ rhs. */
function leastSquares(rows: number[][], rhs: number[]): number[] | null {
  const k = rows[0].length;
  const ata = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb = new Array<number>(k).fill(0);
  rows.forEach((row, i) => {
    for (let a = 0; a < k; a++) {
      atb[a] += row[a] * rhs[i];
      for (let b = 0; b < k; b++) ata[a][b] += row[a] * row[b];
    }
  });
  return solve(ata, atb);
}

/** Centering and scaling of a point cloud, to keep the systems well conditioned. */
function normalizer(ps: Pt[]): { to: (p: Pt) => Pt; from: (p: Pt) => Pt } {
  const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
  const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
  const k = Math.max(1e-9, ...ps.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  return { to: (p) => pt((p.x - cx) / k, (p.y - cy) / k), from: (p) => pt(p.x * k + cx, p.y * k + cy) };
}

export type ModelId = 'similarity' | 'affine' | 'quadratic';
type Transform = (p: Pt) => Pt;

interface Model {
  id: ModelId;
  /** Fewest anchors that determine it. */
  min: number;
  fit(src: Pt[], dst: Pt[]): Transform | null;
}

/** A model where x and y are fitted separately on the same functions of the source. */
function separable(id: ModelId, min: number, basis: (p: Pt) => number[]): Model {
  return {
    id,
    min,
    fit(src, dst) {
      const ns = normalizer(src), nd = normalizer(dst);
      const rows = src.map((p) => basis(ns.to(p)));
      const d = dst.map((p) => nd.to(p));
      const cx = leastSquares(rows, d.map((p) => p.x));
      const cy = leastSquares(rows, d.map((p) => p.y));
      if (!cx || !cy) return null;
      const dot = (c: number[], v: number[]) => c.reduce((s, ci, i) => s + ci * v[i], 0);
      return (p) => {
        const v = basis(ns.to(p));
        return nd.from(pt(dot(cx, v), dot(cy, v)));
      };
    },
  };
}

export const MODELS: Model[] = [
  {
    // Scale, rotation and translation. Mirrored, since the pixels go down and
    // the northings up: x' = a·x + b·y + c, y' = b·x − a·y + d.
    id: 'similarity',
    min: 2,
    fit(src, dst) {
      const ns = normalizer(src), nd = normalizer(dst);
      const rows: number[][] = [], rhs: number[] = [];
      src.forEach((p0, i) => {
        const p = ns.to(p0), q = nd.to(dst[i]);
        rows.push([p.x, p.y, 1, 0]);
        rhs.push(q.x);
        rows.push([-p.y, p.x, 0, 1]);
        rhs.push(q.y);
      });
      const c = leastSquares(rows, rhs);
      if (!c) return null;
      const [a, b, tx, ty] = c;
      return (p0) => {
        const p = ns.to(p0);
        return nd.from(pt(a * p.x + b * p.y + tx, b * p.x - a * p.y + ty));
      };
    },
  },
  separable('affine', 3, (p) => [1, p.x, p.y]),
  separable('quadratic', 6, (p) => [1, p.x, p.y, p.x * p.x, p.x * p.y, p.y * p.y]),
];

export const MODEL_LABELS: Record<ModelId, string> = {
  similarity: 'similitude (échelle, rotation)',
  affine: 'affine',
  quadratic: 'polynomiale de degré 2',
};

/* ============================================================== georef */

export interface Georef {
  model: ModelId;
  toLatLon(p: Pt): LatLon;
  toPx(ll: LatLon): Pt;
  /**
   * For each anchor, where the other anchors place it, and the distance in km
   * to its true position. Null when the other anchors are too few.
   */
  checks: ({ p: Pt; km: number } | null)[];
  /** Root mean square of the errors (km), null when unknown. */
  rms: number | null;
  max: number | null;
}

/** A simpler model is kept unless a richer one is clearly better. */
const BETTER = 0.8;

/** The transformation that best fits the anchors, null with less than 2 of them. */
export function fitGeoref(anchors: Anchor[]): Georef | null {
  if (anchors.length < 2) return null;
  const px = anchors.map((a) => a.p);
  const lam = anchors.map((a) => toLambert(a));
  let chosen: { model: Model; fwd: Transform; checks: Georef['checks']; rms: number | null } | null = null;
  for (const model of MODELS) {
    if (anchors.length < model.min) break;
    const fwd = model.fit(px, lam);
    if (!fwd) continue;
    let checks: Georef['checks'] = anchors.map(() => null);
    let rms: number | null = null;
    if (anchors.length - 1 >= model.min) {
      checks = anchors.map((_, i) => {
        const others = (arr: Pt[]) => arr.filter((_, k) => k !== i);
        const f = model.fit(others(px), others(lam));
        if (!f) return null;
        const q = f(px[i]);
        return { p: q, km: Math.hypot(q.x - lam[i].x, q.y - lam[i].y) / 1000 };
      });
      const kms = checks.filter((c) => c !== null).map((c) => c.km);
      if (kms.length === anchors.length) rms = Math.sqrt(kms.reduce((s, k) => s + k * k, 0) / kms.length);
    }
    if (!chosen) chosen = { model, fwd, checks, rms };
    else if (rms !== null && (chosen.rms === null || rms < chosen.rms * BETTER)) chosen = { model, fwd, checks, rms };
  }
  if (!chosen) return null;
  const inv = chosen.model.fit(lam, px);
  if (!inv) return null;
  const fwd = chosen.fwd;
  // The checks, back in map pixels, to show them on the map.
  const checks = chosen.checks.map((c) => (c ? { p: inv(c.p), km: c.km } : null));
  const kms = checks.filter((c) => c !== null).map((c) => c.km);
  return {
    model: chosen.model.id,
    toLatLon: (p) => fromLambert(fwd(p)),
    toPx: (ll) => inv(toLambert(ll)),
    checks,
    rms: chosen.rms,
    max: chosen.rms === null ? null : Math.max(...kms),
  };
}

/** Kilometers between 2 positions (along the Lambert-93 plane, enough for France). */
export function kmBetween(a: LatLon, b: LatLon): number {
  const p = toLambert(a), q = toLambert(b);
  return Math.hypot(p.x - q.x, p.y - q.y) / 1000;
}

/* ===================================================== reading, writing */

const frNum = (v: number, digits: number) => v.toFixed(digits).replace('.', ',');

/** « 45,12345° N, 1,23456° E » */
export function formatLatLon(ll: LatLon, digits = 5): string {
  const lat = `${frNum(Math.abs(ll.lat), digits)}° ${ll.lat < 0 ? 'S' : 'N'}`;
  const lon = `${frNum(Math.abs(ll.lon), digits)}° ${ll.lon < 0 ? 'O' : 'E'}`;
  return `${lat}, ${lon}`;
}

/** « 45.12345, 1.23456 », as understood by map sites and GPS apps. */
export function decimalLatLon(ll: LatLon, digits = 5): string {
  return `${ll.lat.toFixed(digits)}, ${ll.lon.toFixed(digits)}`;
}

/** « 45°07'24" N, 1°14'02" E » */
export function dmsLatLon(ll: LatLon): string {
  const dms = (v: number) => {
    let s = Math.round(Math.abs(v) * 3600);
    const d = Math.floor(s / 3600);
    s -= d * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
  };
  return `${dms(ll.lat)} ${ll.lat < 0 ? 'S' : 'N'}, ${dms(ll.lon)} ${ll.lon < 0 ? 'O' : 'E'}`;
}

/**
 * Read coordinates typed or pasted by the user: decimal degrees
 * (« 45.123, 1.234 », « 45,123 1,234 ») or degrees, minutes and seconds
 * (« 45°7'24"N 1°14'2"E »), with N/S/E/O/W letters. Latitude first, unless
 * the letters say otherwise. Null when it can not be read.
 */
export function parseLatLon(text: string): LatLon | null {
  const t = text.trim().toUpperCase().replace(/[−–]/g, '-');
  // Cut in two halves, at the letter ending the first coordinate, or at a ';'.
  let halves: string[] | null = null;
  const letter = /^(.*?[NSEOW])(.*[0-9].*)$/.exec(t);
  if (t.includes(';')) halves = t.split(';');
  else if (letter) halves = [letter[1], letter[2]];
  const nums = (s: string) => (s.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((n) => parseFloat(n.replace(',', '.')));
  const value = (ns: number[]) => {
    if (ns.length < 1 || ns.length > 3) return NaN;
    const sign = ns[0] < 0 ? -1 : 1;
    return sign * (Math.abs(ns[0]) + (ns[1] ?? 0) / 60 + (ns[2] ?? 0) / 3600);
  };
  let parts: { v: number; letter: string }[];
  if (halves && halves.length === 2) {
    parts = halves.map((s) => ({ v: value(nums(s)), letter: /[NSEOW]/.exec(s)?.[0] ?? '' }));
  } else {
    const ns = nums(t);
    if (ns.length % 2 !== 0 || ns.length === 0) return null;
    const k = ns.length / 2;
    parts = [{ v: value(ns.slice(0, k)), letter: '' }, { v: value(ns.slice(k)), letter: '' }];
  }
  if (parts.some((p) => !Number.isFinite(p.v))) return null;
  for (const p of parts) if (p.letter === 'S' || p.letter === 'O' || p.letter === 'W') p.v = -Math.abs(p.v);
  let [lat, lon] = [parts[0].v, parts[1].v];
  if (/[EOW]/.test(parts[0].letter) || /[NS]/.test(parts[1].letter)) [lat, lon] = [lon, lat];
  // Typed the wrong way round, for a place in France?
  else if (!parts[0].letter && !parts[1].letter && Math.abs(lon) > 40 && Math.abs(lat) < 12) [lat, lon] = [lon, lat];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Kilometers between 2 positions along the ellipsoid (Vincenty, GRS80): the distance on the ground. */
export function geodesicKm(p: LatLon, q: LatLon): number {
  const a = 6378137, f = 1 / 298.257222101, b = a * (1 - f);
  const rad = Math.PI / 180;
  const L = (q.lon - p.lon) * rad;
  const U1 = Math.atan((1 - f) * Math.tan(p.lat * rad)), U2 = Math.atan((1 - f) * Math.tan(q.lat * rad));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L, sinSigma = 0, cosSigma = 1, sigma = 0, cos2Alpha = 1, cos2SigmaM = 0;
  for (let i = 0; i < 200; i++) {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) break;
  }
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma = B * sinSigma * (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
    - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return (b * A * (sigma - dSigma)) / 1000;
}

/**
 * Direction of the geographic north on the map at a position: the angle, in
 * degrees clockwise, from the top of the sheet to the local meridian.
 */
export function meridianAngle(g: Georef, p: Pt): number {
  const ll = g.toLatLon(p);
  const n = g.toPx({ lat: ll.lat + 0.05, lon: ll.lon });
  const s = g.toPx({ lat: ll.lat - 0.05, lon: ll.lon });
  return (Math.atan2(n.x - s.x, s.y - n.y) * 180) / Math.PI;
}
