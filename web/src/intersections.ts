/**
 * Remarkable points of the figure: intersections of two items, middle and
 * ends of segments, centers of circles. They are where clicks snap, and the
 * intersections can be added as points.
 */

import { angleInArc, angleOf, dist, intersect, mid, polar, pt, seg, type Pt } from './geom';
import type { Item } from './model';
import { spiralArcs } from './shapes';

/** A piece of a figure: a segment (lines are long segments) or an arc (360° for a circle). */
type Curve =
  | { kind: 'seg'; a: Pt; b: Pt }
  | { kind: 'arc'; c: Pt; r: number; start: number; span: number }
  | { kind: 'ellipse'; f1: Pt; f2: Pt; dSum: number };

const EPS = 1e-9;

function curvesOf(it: Item): Curve[] {
  switch (it.kind) {
    case 'segment':
    case 'line':
      return [{ kind: 'seg', a: it.p1, b: it.p2 }];
    case 'circle':
      return [{ kind: 'arc', c: it.c, r: it.r, start: 0, span: 360 }];
    case 'arc':
      return [{ kind: 'arc', c: it.c, r: it.r, start: it.start, span: it.span }];
    case 'spiral':
      return spiralArcs(it.centers).filter((a) => a.r > 0).map((a) => ({ kind: 'arc' as const, ...a }));
    case 'ellipse':
      return [{ kind: 'ellipse', f1: it.f1, f2: it.f2, dSum: it.dSum }];
    default:
      return [];
  }
}

/** Parameter of p along the segment a→b (0 at a, 1 at b). */
function along(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return l2 === 0 ? 0 : ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
}

const onSeg = (p: Pt, s: { a: Pt; b: Pt }) => {
  const t = along(p, s.a, s.b);
  return t >= -EPS && t <= 1 + EPS;
};

function onArc(p: Pt, a: { c: Pt; start: number; span: number }): boolean {
  if (Math.abs(a.span) >= 360) return true;
  const ang = angleOf(seg(a.c, p));
  // A little tolerance, for the intersections falling on the ends of the arc.
  return angleInArc(ang, a.start, a.span) || angleInArc(ang + 1e-7, a.start, a.span) || angleInArc(ang - 1e-7, a.start, a.span);
}

/** Points where the infinite line through a and b crosses the circle. */
function lineCircle(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: a.x - c.x, y: a.y - c.y };
  const A = d.x * d.x + d.y * d.y, B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - r * r;
  if (A === 0) return [];
  const disc = B * B - 4 * A * C;
  if (disc < -EPS * A * r * r) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const ts = s === 0 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  return ts.map((t) => pt(a.x + t * d.x, a.y + t * d.y));
}

function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d === 0 || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = pt(c1.x + (a * (c2.x - c1.x)) / d, c1.y + (a * (c2.y - c1.y)) / d);
  if (h === 0) return [m];
  const ox = (h * (c2.y - c1.y)) / d, oy = (h * (c2.x - c1.x)) / d;
  return [pt(m.x + ox, m.y - oy), pt(m.x - ox, m.y + oy)];
}

/** Points where the infinite line through a and b crosses the ellipse. */
function lineEllipse(a: Pt, b: Pt, e: { f1: Pt; f2: Pt; dSum: number }): Pt[] {
  const c = mid(e.f1, e.f2);
  const half = dist(e.f1, e.f2) / 2;
  const A = e.dSum / 2;
  const B = Math.sqrt(Math.max(0, A * A - half * half));
  if (A <= 0 || B <= 0) return [];
  const th = Math.atan2(e.f2.y - e.f1.y, e.f2.x - e.f1.x);
  const cos = Math.cos(th), sin = Math.sin(th);
  // In the frame of the ellipse, scaled to a unit circle.
  const local = (p: Pt) => pt((((p.x - c.x) * cos + (p.y - c.y) * sin)) / A, ((-(p.x - c.x) * sin + (p.y - c.y) * cos)) / B);
  const back = (q: Pt) => pt(c.x + q.x * A * cos - q.y * B * sin, c.y + q.x * A * sin + q.y * B * cos);
  return lineCircle(local(a), local(b), pt(0, 0), 1).map(back);
}

function crossCurves(u: Curve, v: Curve): Pt[] {
  if (u.kind === 'seg' && v.kind === 'seg') {
    const p = intersect(seg(u.a, u.b), seg(v.a, v.b));
    return p && onSeg(p, u) && onSeg(p, v) ? [p] : [];
  }
  if (u.kind === 'seg' && v.kind === 'arc') return lineCircle(u.a, u.b, v.c, v.r).filter((p) => onSeg(p, u) && onArc(p, v));
  if (u.kind === 'arc' && v.kind === 'seg') return crossCurves(v, u);
  if (u.kind === 'arc' && v.kind === 'arc') return circleCircle(u.c, u.r, v.c, v.r).filter((p) => onArc(p, u) && onArc(p, v));
  if (u.kind === 'seg' && v.kind === 'ellipse') return lineEllipse(u.a, u.b, v).filter((p) => onSeg(p, u));
  if (u.kind === 'ellipse' && v.kind === 'seg') return crossCurves(v, u);
  return []; // ellipse with a circle or an ellipse: not handled
}

/** Intersection points of two items. */
export function itemIntersections(a: Item, b: Item): Pt[] {
  const out: Pt[] = [];
  for (const u of curvesOf(a)) for (const v of curvesOf(b)) out.push(...crossCurves(u, v));
  return out;
}

/** The points of `pts`, without the duplicates closer than `tol`. */
export function dedupe(pts: Pt[], tol = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.some((q) => dist(p, q) <= tol)) out.push(p);
  return out;
}

/** All the intersection points of a group of items, 2 by 2. */
export function allIntersections(items: Item[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push(...itemIntersections(items[i], items[j]));
  return dedupe(out);
}

export type SnapKind = 'point' | 'intersection' | 'midpoint' | 'end' | 'center';

export const SNAP_LABELS: Record<SnapKind, string> = {
  point: 'point',
  intersection: 'intersection',
  midpoint: 'milieu',
  end: 'extrémité',
  center: 'centre',
};

export interface SnapPoint {
  p: Pt;
  kind: SnapKind;
  /** The items it belongs to (2 for an intersection). */
  ids: string[];
  /** Which end: 0 for the first one, 1 for the other. */
  end?: number;
}

/** Remarkable points of items near the mouse: their intersections, middles and ends. */
export function remarkablePoints(near: Item[]): SnapPoint[] {
  const out: SnapPoint[] = [];
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const p of itemIntersections(near[i], near[j])) out.push({ p, kind: 'intersection', ids: [near[i].id, near[j].id] });
    }
  }
  for (const it of near) {
    const ids = [it.id];
    if (it.kind === 'segment') {
      out.push({ p: mid(it.p1, it.p2), kind: 'midpoint', ids }, { p: it.p1, kind: 'end', ids, end: 0 }, { p: it.p2, kind: 'end', ids, end: 1 });
    } else if (it.kind === 'arc') {
      out.push({ p: polar(it.c, it.r, it.start), kind: 'end', ids, end: 0 }, { p: polar(it.c, it.r, it.start + it.span), kind: 'end', ids, end: 1 });
    }
  }
  return out;
}

/** The intersections of a group of items, with the 2 items of each one. */
export function crossings(items: Item[]): SnapPoint[] {
  const out: SnapPoint[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      for (const p of itemIntersections(items[i], items[j])) {
        if (!out.some((q) => dist(q.p, p) <= 1e-6)) out.push({ p, kind: 'intersection', ids: [items[i].id, items[j].id] });
      }
    }
  }
  return out;
}

/** Center of a circle, an arc or an ellipse, to snap on. */
export function centerOf(it: Item): Pt | null {
  if (it.kind === 'circle' || it.kind === 'arc') return it.c;
  if (it.kind === 'ellipse') return mid(it.f1, it.f2);
  return null;
}
