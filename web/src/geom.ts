/**
 * Plane geometry helpers.
 *
 * Scene coordinates are the pixels of the background map: x to the right,
 * y DOWNWARDS. Angles follow the Qt conventions of the desktop version so
 * that saved projects stay compatible: degrees, counter-clockwise as seen on
 * screen (i.e. as if the y axis pointed upwards).
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Seg {
  p1: Pt;
  p2: Pt;
}

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const samePt = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

export const seg = (p1: Pt, p2: Pt): Seg => ({ p1, p2 });
export const segLength = (s: Seg): number => dist(s.p1, s.p2);
export const isNullSeg = (s: Seg): boolean => samePt(s.p1, s.p2);
export const dx = (s: Seg): number => s.p2.x - s.p1.x;
export const dy = (s: Seg): number => s.p2.y - s.p1.y;

/** Normalizes an angle in degrees to [0, 360). */
export function norm360(a: number): number {
  let r = a % 360;
  if (r < 0) r += 360;
  if (r === 0 || Math.abs(r - 360) < 1e-9) return 0; // also turns -0 into 0
  return r;
}

/** QLineF::angle(): direction of the segment, counter-clockwise on screen. */
export function angleOf(s: Seg): number {
  return norm360(rad2deg(Math.atan2(-dy(s), dx(s))));
}

/** QLineF::angleTo(): counter-clockwise angle from s to other, in [0, 360). */
export function angleTo(s: Seg, other: Seg): number {
  return norm360(angleOf(other) - angleOf(s));
}

/** QLineF::setAngle(): same origin and length, new direction. */
export function withAngle(s: Seg, angle: number): Seg {
  const len = segLength(s);
  const r = deg2rad(angle);
  return seg(s.p1, { x: s.p1.x + Math.cos(r) * len, y: s.p1.y - Math.sin(r) * len });
}

/** QLineF::setLength(): same origin and direction, new length. */
export function withLength(s: Seg, len: number): Seg {
  const old = segLength(s);
  if (old <= 0) return s;
  return seg(s.p1, add(s.p1, mul(sub(s.p2, s.p1), len / old)));
}

/** QLineF::normalVector(): same origin and length, rotated by 90° (clockwise in y-down). */
export function normalVector(s: Seg): Seg {
  return seg(s.p1, { x: s.p1.x + dy(s), y: s.p1.y - dx(s) });
}

export function translated(s: Seg, v: Pt): Seg {
  return seg(add(s.p1, v), add(s.p2, v));
}

export const segCenter = (s: Seg): Pt => mid(s.p1, s.p2);

/** Intersection of the two infinite lines, or null when they are parallel. */
export function intersect(a: Seg, b: Seg): Pt | null {
  const ax = dx(a), ay = dy(a), bx = dx(b), by = dy(b);
  const den = ay * bx - ax * by;
  if (den === 0 || !Number.isFinite(den)) return null;
  const cx = a.p1.x - b.p1.x, cy = a.p1.y - b.p1.y;
  const na = (by * cx - bx * cy) / den;
  return { x: a.p1.x + ax * na, y: a.p1.y + ay * na };
}

/** Point at Qt angle `angle` (degrees) on the circle (center, radius). */
export function polar(center: Pt, radius: number, angle: number): Pt {
  const r = deg2rad(angle);
  return { x: center.x + radius * Math.cos(r), y: center.y - radius * Math.sin(r) };
}

/** Distance from p to the segment [a, b]. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, mul(ab, t)));
}

/** Orthogonal distance from p to the infinite line (a, b). */
export function distToLine(p: Pt, a: Pt, b: Pt): number {
  const l = dist(a, b);
  if (l === 0) return dist(p, a);
  return Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / l;
}

/** Orthogonal projection of p on the infinite line (a, b). */
export function projectOnLine(p: Pt, a: Pt, b: Pt): Pt {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  return add(a, mul(ab, dot(sub(p, a), ab) / l2));
}

/**
 * Pseudo-infinite line through 2 points, as stored by the desktop version:
 * the segment is extended up to a virtual 100 000 x 100 000 px square
 * centered on the origin. Returns null when both points are identical.
 */
export const LINE_EXTENT = 50000;

export function extendLine(a: Pt, b: Pt): Seg | null {
  if (samePt(a, b)) return null;
  const s = seg(a, b);
  const E = LINE_EXTENT;
  const left = seg(pt(-E, -E), pt(-E, E));
  const right = seg(pt(E, -E), pt(E, E));
  const top = seg(pt(-E, -E), pt(E, -E));
  const bottom = seg(pt(-E, E), pt(E, E));
  const angle = angleTo(s, seg(pt(0, 0), pt(1, 1)));
  let e0: Pt | null, e1: Pt | null;
  if (angle < 90 || (angle > 180 && angle < 270)) {
    e0 = intersect(s, top);
    e1 = intersect(s, bottom);
  } else {
    e0 = intersect(s, left);
    e1 = intersect(s, right);
  }
  return seg(e0 ?? a, e1 ?? b);
}

/**
 * Center of the circle passing through 3 points, or null when they are aligned
 * or not distinct.
 */
export function circumcenter(a: Pt, b: Pt, c: Pt): Pt | null {
  if (samePt(a, b) || samePt(b, c) || samePt(a, c)) return null;
  const s1 = seg(a, b);
  const s2 = seg(a, c);
  const n1 = normalVector(seg(segCenter(s1), s1.p2));
  const n2 = normalVector(seg(segCenter(s2), s2.p2));
  return intersect(n1, n2);
}

/** The 2 tangency points seen from an external point, or null if p is inside. */
export function tangencyPoints(center: Pt, radius: number, p: Pt): [Pt, Pt] | null {
  const d = dist(center, p);
  if (d <= radius) return null;
  const theta = Math.atan2(p.y - center.y, p.x - center.x);
  const phi = Math.acos(radius / d);
  return [theta - phi, theta + phi].map((a) => ({
    x: center.x + radius * Math.cos(a),
    y: center.y + radius * Math.sin(a),
  })) as [Pt, Pt];
}

/** True if Qt angle `a` lies within the arc going from `start` by `span` degrees. */
export function angleInArc(a: number, start: number, span: number): boolean {
  if (Math.abs(span) >= 360) return true;
  const rel = span >= 0 ? norm360(a - start) : norm360(start - a);
  return rel <= Math.abs(span);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
