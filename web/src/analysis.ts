/**
 * Checking a hypothesis: where lines that should meet at one point really
 * meet (the error triangle), and whether a line crosses the zones it should.
 */

import { dist, distToLine, distToSegment, type Pt } from './geom';
import { crossings, type SnapPoint } from './intersections';
import type { Item } from './model';

type LineLike = Extract<Item, { kind: 'line' | 'segment' }>;
type Zone = Extract<Item, { kind: 'circle' | 'arc' }>;

export const isLineLike = (it: Item): it is LineLike => it.kind === 'line' || it.kind === 'segment';
export const isZone = (it: Item): it is Zone => it.kind === 'circle' || it.kind === 'arc';

export interface ErrorPolygon {
  /** The crossings of the lines 2 by 2, around their center. */
  corners: SnapPoint[];
  center: Pt;
  /** The longest distance between 2 corners, in pixels: the size of the error. */
  spread: number;
}

/**
 * The polygon the lines make where they should meet at one point (a
 * triangle for 3 lines). Null with less than 2 crossings.
 */
export function errorPolygon(lines: LineLike[]): ErrorPolygon | null {
  const corners = crossings(lines);
  if (corners.length < 2) return null;
  const center = {
    x: corners.reduce((s, c) => s + c.p.x, 0) / corners.length,
    y: corners.reduce((s, c) => s + c.p.y, 0) / corners.length,
  };
  // Around the center, to draw the outline.
  corners.sort((a, b) => Math.atan2(a.p.y - center.y, a.p.x - center.x) - Math.atan2(b.p.y - center.y, b.p.x - center.x));
  let spread = 0;
  for (const a of corners) for (const b of corners) spread = Math.max(spread, dist(a.p, b.p));
  return { corners, center, spread };
}

export interface Crossing {
  zone: Zone;
  /** Distance from the center of the zone to the line, in pixels. */
  gap: number;
  /** The line goes through the zone. */
  crosses: boolean;
  /** How far inside (> 0) or outside (< 0) of its edge, in pixels. */
  margin: number;
}

/** For each zone, whether the line crosses it, and by how much. */
export function zoneCrossings(line: LineLike, zones: Zone[]): Crossing[] {
  return zones.map((zone) => {
    const gap = line.kind === 'line' ? distToLine(zone.c, line.p1, line.p2) : distToSegment(zone.c, line.p1, line.p2);
    return { zone, gap, crosses: gap <= zone.r, margin: zone.r - gap };
  });
}
