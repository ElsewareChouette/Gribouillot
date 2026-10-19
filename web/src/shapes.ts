/**
 * Geometry of the items: spiral construction, hit-testing and bounds.
 * Hit-testing works in screen pixels so that thin items stay easy to pick at
 * any zoom level.
 */

import {
  angleInArc,
  angleOf,
  angleTo,
  dist,
  distToSegment,
  mid,
  norm360,
  normalVector,
  polar,
  pt,
  rad2deg,
  seg,
  segLength,
  sub,
  translated,
  withLength,
  type Pt,
  type Rect,
  type Seg,
} from './geom';
import { POINT_SIZE, type ArcItem, type Item, type PixmapItem } from './model';

/* --------------------------------------------------------------- spiral */

export interface ArcGeom {
  c: Pt;
  r: number;
  start: number;
  span: number;
}

/** Radius of the arc drawn around side `i`: this side plus the previous ones. */
export function spiralArcRadius(i: number, sides: Seg[]): number {
  if (segLength(sides[i]) === 0) return 0;
  let r = 0;
  for (let k = 0; k <= i; k++) r += segLength(sides[k]);
  return r;
}

/** Start and span angles of the arc between side A and side B. */
export function spiralArcAngles(a: Seg, b: Seg): { start: number; span: number } {
  if (segLength(a) === 0 || segLength(b) === 0) return { start: 0, span: 0 };
  const flip = seg(a.p2, a.p1);
  const start = angleOf(flip);
  let span = angleTo(a, b);
  if (span > 180) span = angleTo(flip, b) - 180; // the spiral goes clockwise
  return { start, span };
}

export function spiralSides(centers: Pt[]): Seg[] {
  return centers.map((c, i) => seg(c, centers[(i + 1) % 4]));
}

export function spiralArcs(centers: Pt[]): ArcGeom[] {
  const sides = spiralSides(centers);
  return sides.map((s, i) => ({
    c: s.p2,
    r: spiralArcRadius(i, sides),
    ...spiralArcAngles(s, sides[(i + 1) % 4]),
  }));
}

/**
 * Complete the base of a spiral from the sides given so far
 * (port of Item_spiralDrawer::computeSpiralBase).
 * @param clicks number of centers picked up by the user (2, 3 or 4)
 * @returns the 4 sides, or an error message
 */
export function completeSpiralBase(sides: Seg[], clicks: number, clockwise: boolean): Seg[] | string {
  const s = sides.slice();
  switch (clicks) {
    case 2: {
      // Square base.
      let nV = normalVector(s[0]);
      if (clockwise) {
        nV = withLength(nV, -segLength(nV));
        s[3] = seg(nV.p2, nV.p1);
        s[1] = normalVector(seg(s[0].p2, s[0].p1));
      } else {
        s[3] = seg(nV.p2, nV.p1);
        s[1] = translated(nV, sub(s[0].p2, s[0].p1));
      }
      s[2] = seg(s[1].p2, s[3].p1);
      return s;
    }
    case 3:
      // Trapezium base (may be a rectangle).
      s[3] = translated(seg(s[1].p2, s[1].p1), sub(s[0].p1, s[0].p2));
      s[2] = seg(s[1].p2, s[3].p1);
      return s;
    case 4: {
      s[3] = seg(s[2].p2, s[0].p1);
      const turns = [angleTo(s[1], s[2]), angleTo(s[2], s[3]), angleTo(s[3], s[0])];
      const convex = clockwise ? turns.every((t) => t >= 180) : turns.every((t) => t <= 180);
      return convex ? s : "La base donnée n'est pas convexe : impossible de tracer une spirale.";
    }
    default:
      return 'Il faut au moins 2 clics pour tracer une spirale.';
  }
}

/* ----------------------------------------------------------- arc helper */

/**
 * Span angle of an arc being drawn from `first` (center -> start point) to the
 * mouse direction `second`, following the direction the user started to turn
 * (port of Item_arcDrawer::mouseMoveEvent).
 */
export class ArcSpanTracker {
  span = 0;
  private clockwise = false;

  update(first: Seg, second: Seg): number {
    const a = angleTo(first, second);
    if (Math.abs(this.span) < 60 && a > 300) this.clockwise = true;
    else if (Math.abs(this.span) > 300 && a < 60) this.clockwise = false;
    this.span = this.clockwise ? -(360 - a) : a;
    return this.span;
  }
}

/* --------------------------------------------------------------- pixmap */

export interface ImageSize {
  w: number;
  h: number;
}

/** The 4 corners of a picture in scene coordinates. */
export function pixmapCorners(p: PixmapItem, size: ImageSize): Pt[] {
  const cx = size.w / 2, cy = size.h / 2;
  const r = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return [
    [0, 0],
    [size.w, 0],
    [size.w, size.h],
    [0, size.h],
  ].map(([x, y]) => {
    const lx = (x - cx) * p.scale, ly = (y - cy) * p.scale;
    return { x: p.x + cx + lx * cos - ly * sin, y: p.y + cy + lx * sin + ly * cos };
  });
}

export function pixmapCenter(p: PixmapItem, size: ImageSize): Pt {
  return { x: p.x + size.w / 2, y: p.y + size.h / 2 };
}

function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/* ---------------------------------------------------------- hit-testing */

/** Distance in screen pixels from p to the arc outline, or Infinity if outside its span. */
function arcDistance(p: Pt, a: ArcGeom, zoom: number): number {
  const d = dist(p, a.c);
  const ang = norm360(rad2deg(Math.atan2(-(p.y - a.c.y), p.x - a.c.x)));
  if (!angleInArc(ang, a.start, a.span)) return Infinity;
  return Math.abs(d - a.r) * zoom;
}

/** Approximate distance from p to the ellipse outline, in scene units. */
function ellipseDistance(p: Pt, f1: Pt, f2: Pt, dSum: number): number {
  const d1 = dist(p, f1), d2 = dist(p, f2);
  const f = d1 + d2 - dSum;
  if (d1 === 0 || d2 === 0) return Math.abs(f);
  const g = {
    x: (p.x - f1.x) / d1 + (p.x - f2.x) / d2,
    y: (p.y - f1.y) / d1 + (p.y - f2.y) / d2,
  };
  const gl = Math.hypot(g.x, g.y);
  return gl > 1e-9 ? Math.abs(f) / gl : Math.abs(f) / 2;
}

/**
 * Distance in screen pixels from the scene point p to the item, used to pick
 * the item under the mouse. Pictures return 0 inside and Infinity outside.
 */
export function itemDistance(item: Item, p: Pt, zoom: number, sizeOf: (file: string) => ImageSize | undefined): number {
  switch (item.kind) {
    case 'point':
      return Math.max(0, dist(p, item.p) * zoom - POINT_SIZE / 2);
    case 'segment':
    case 'line':
      return distToSegment(p, item.p1, item.p2) * zoom;
    case 'circle':
      return Math.abs(dist(p, item.c) - item.r) * zoom;
    case 'arc':
      return arcDistance(p, item, zoom);
    case 'ellipse':
      return ellipseDistance(p, item.f1, item.f2, item.dSum) * zoom;
    case 'spiral':
      return Math.min(...spiralArcs(item.centers).map((a) => arcDistance(p, a, zoom)));
    case 'pixmap': {
      const size = sizeOf(item.file);
      if (!size) return Infinity;
      return insidePolygon(p, pixmapCorners(item, size)) ? 0 : Infinity;
    }
  }
}

/** Pick tolerance in screen pixels. */
export function pickTolerance(item: Item): number {
  if (item.kind === 'pixmap') return 0;
  if (item.kind === 'point') return 4;
  return item.width / 2 + 5;
}

/** Bounding box in scene coordinates (lines are clipped to their stored ends). */
export function itemBounds(item: Item, sizeOf: (file: string) => ImageSize | undefined): Rect {
  const fromPts = (pts: Pt[]): Rect => {
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  switch (item.kind) {
    case 'point':
      return { x: item.p.x, y: item.p.y, w: 0, h: 0 };
    case 'segment':
    case 'line':
      return fromPts([item.p1, item.p2]);
    case 'circle':
    case 'arc':
      return { x: item.c.x - item.r, y: item.c.y - item.r, w: 2 * item.r, h: 2 * item.r };
    case 'ellipse': {
      const c = mid(item.f1, item.f2);
      const a = item.dSum / 2;
      return { x: c.x - a, y: c.y - a, w: 2 * a, h: 2 * a };
    }
    case 'spiral': {
      const arcs = spiralArcs(item.centers);
      return fromPts(arcs.flatMap((a) => [
        { x: a.c.x - a.r, y: a.c.y - a.r },
        { x: a.c.x + a.r, y: a.c.y + a.r },
      ]));
    }
    case 'pixmap': {
      const size = sizeOf(item.file);
      return size ? fromPts(pixmapCorners(item, size)) : { x: item.x, y: item.y, w: 0, h: 0 };
    }
  }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function segmentTouchesRect(a: Pt, b: Pt, r: Rect): boolean {
  if (inRect(a, r) || inRect(b, r)) return true;
  const c = [pt(r.x, r.y), pt(r.x + r.w, r.y), pt(r.x + r.w, r.y + r.h), pt(r.x, r.y + r.h)];
  return c.some((p, i) => segmentsCross(a, b, p, c[(i + 1) % 4]));
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, s: Pt) => Math.sign((q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Points along an arc, to test curves against a rectangle. */
function arcPolyline(a: ArcGeom, n = 128): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) out.push(polar(a.c, a.r, a.start + (a.span * k) / n));
  return out;
}

function polylineTouchesRect(pts: Pt[], r: Rect): boolean {
  for (let k = 1; k < pts.length; k++) if (segmentTouchesRect(pts[k - 1], pts[k], r)) return true;
  return false;
}

/** True if the outline of the item crosses or lies in the rectangle (rubber band selection). */
export function itemTouchesRect(item: Item, r: Rect, sizeOf: (file: string) => ImageSize | undefined): boolean {
  if (!rectsIntersect(itemBounds(item, sizeOf), r)) return false;
  switch (item.kind) {
    case 'point':
      return inRect(item.p, r);
    case 'segment':
    case 'line':
      return segmentTouchesRect(item.p1, item.p2, r);
    case 'circle':
      return polylineTouchesRect(arcPolyline({ c: item.c, r: item.r, start: 0, span: 360 }), r);
    case 'arc':
      return polylineTouchesRect(arcPolyline(item), r);
    case 'ellipse': {
      const c = mid(item.f1, item.f2);
      const a = item.dSum / 2;
      const b = Math.sqrt(Math.max(0, a * a - (dist(item.f1, item.f2) / 2) ** 2));
      const rot = Math.atan2(item.f2.y - item.f1.y, item.f2.x - item.f1.x);
      const pts: Pt[] = [];
      for (let k = 0; k <= 128; k++) {
        const t = (k / 128) * 2 * Math.PI;
        const x = a * Math.cos(t), y = b * Math.sin(t);
        pts.push(pt(c.x + x * Math.cos(rot) - y * Math.sin(rot), c.y + x * Math.sin(rot) + y * Math.cos(rot)));
      }
      return polylineTouchesRect(pts, r);
    }
    case 'spiral':
      return spiralArcs(item.centers).some((g) => polylineTouchesRect(arcPolyline(g), r));
    case 'pixmap': {
      const size = sizeOf(item.file);
      if (!size) return false;
      const c = pixmapCorners(item, size);
      return c.some((p) => inRect(p, r)) || polylineTouchesRect([...c, c[0]], r) || insidePolygon(pt(r.x, r.y), c);
    }
  }
}

/** An arc reduced to the part of its circle it covers, e.g. for the status bar. */
export function arcLength(a: ArcItem): number {
  return Math.abs((2 * Math.PI * a.r * a.span) / 360);
}

/** Center position of a selected item, used to draw the optional center point. */
export function itemCenter(item: Item): Pt | null {
  switch (item.kind) {
    case 'circle':
    case 'arc':
      return item.c;
    case 'ellipse':
      return mid(item.f1, item.f2);
    default:
      return null;
  }
}
