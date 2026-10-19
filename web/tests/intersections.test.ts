import { describe, expect, it } from 'vitest';
import { pt, type Pt } from '../src/geom';
import { allIntersections, itemIntersections, remarkablePoints } from '../src/intersections';
import type { Item } from '../src/model';

const s = { id: 'x', color: '#000000', width: 2 };
const segment = (a: Pt, b: Pt): Item => ({ kind: 'segment', ...s, p1: a, p2: b });
const line = (a: Pt, b: Pt): Item => ({ kind: 'line', ...s, p1: a, p2: b });
const circle = (c: Pt, r: number): Item => ({ kind: 'circle', ...s, c, r });
const arc = (c: Pt, r: number, start: number, span: number): Item => ({ kind: 'arc', ...s, c, r, start, span });

const sorted = (ps: Pt[]) => ps.map((p) => [Math.round(p.x * 1e6) / 1e6 + 0, Math.round(p.y * 1e6) / 1e6 + 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe('intersections', () => {
  it('two segments, only within both', () => {
    expect(sorted(itemIntersections(segment(pt(0, 0), pt(10, 10)), segment(pt(0, 10), pt(10, 0))))).toEqual([[5, 5]]);
    expect(itemIntersections(segment(pt(0, 0), pt(1, 1)), segment(pt(0, 10), pt(10, 0)))).toEqual([]);
    expect(itemIntersections(segment(pt(0, 0), pt(10, 0)), segment(pt(0, 1), pt(10, 1)))).toEqual([]); // parallel
  });

  it('a line and a circle: 2 points, 1 when tangent, 0 outside', () => {
    const c = circle(pt(0, 0), 5);
    expect(sorted(itemIntersections(line(pt(-50000, 3), pt(50000, 3)), c))).toEqual([[-4, 3], [4, 3]]);
    expect(sorted(itemIntersections(line(pt(-50000, 5), pt(50000, 5)), c))).toEqual([[0, 5]]);
    expect(itemIntersections(line(pt(-50000, 6), pt(50000, 6)), c)).toEqual([]);
  });

  it('two circles', () => {
    expect(sorted(itemIntersections(circle(pt(0, 0), 5), circle(pt(8, 0), 5)))).toEqual([[4, -3], [4, 3]]);
    expect(itemIntersections(circle(pt(0, 0), 5), circle(pt(20, 0), 5))).toEqual([]);
    expect(itemIntersections(circle(pt(0, 0), 5), circle(pt(1, 0), 1))).toEqual([]); // one inside the other
  });

  it('an arc keeps only its own points (Qt angles: 90° is up on screen)', () => {
    const top = arc(pt(0, 0), 5, 0, 180); // upper half: y < 0 on screen
    expect(sorted(itemIntersections(line(pt(-50000, -3), pt(50000, -3)), top))).toEqual([[-4, -3], [4, -3]]);
    expect(itemIntersections(line(pt(-50000, 3), pt(50000, 3)), top)).toEqual([]);
  });

  it('a line and an ellipse', () => {
    const e: Item = { kind: 'ellipse', ...s, f1: pt(-3, 0), f2: pt(3, 0), dSum: 10 }; // a = 5, b = 4
    expect(sorted(itemIntersections(line(pt(0, -50000), pt(0, 50000)), e))).toEqual([[0, -4], [0, 4]]);
    expect(sorted(itemIntersections(e, line(pt(-50000, 0), pt(50000, 0))))).toEqual([[-5, 0], [5, 0]]);
  });

  it('a group: each point once', () => {
    const items = [line(pt(-50000, 0), pt(50000, 0)), line(pt(0, -50000), pt(0, 50000)), circle(pt(0, 0), 2)];
    expect(sorted(allIntersections(items))).toEqual([[-2, 0], [0, -2], [0, 0], [0, 2], [2, 0]]);
  });

  it('remarkable points: middle and ends of a segment', () => {
    const kinds = remarkablePoints([segment(pt(0, 0), pt(10, 0))]).map((r) => `${r.kind} ${r.p.x}`);
    expect(kinds).toEqual(['midpoint 5', 'end 0', 'end 10']);
  });
});
