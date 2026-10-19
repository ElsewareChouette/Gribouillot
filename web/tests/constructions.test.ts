import { describe, expect, it } from 'vitest';
import { RECIPES, spiralShapes, type Construction, type Input, type Shape } from '../src/constructions';
import { dist, pt, seg, type Pt } from '../src/geom';
import type { CircleItem, LineItem, SegmentItem } from '../src/model';
import { completeSpiralBase } from '../src/shapes';

const style = { id: 'x', color: '#000000', width: 2 };
const segment = (a: Pt, b: Pt): SegmentItem => ({ kind: 'segment', ...style, p1: a, p2: b });
const circle = (c: Pt, r: number): CircleItem => ({ kind: 'circle', ...style, c, r });

function shapes(c: Construction): Shape[] {
  if ('fail' in c) throw new Error(`unexpected failure: ${c.fail}`);
  return c.shapes;
}

function only<K extends Shape['kind']>(c: Construction, kind: K): Extract<Shape, { kind: K }> {
  const s = shapes(c);
  expect(s).toHaveLength(1);
  expect(s[0].kind).toBe(kind);
  return s[0] as Extract<Shape, { kind: K }>;
}

/** Direction of a line shape, as a unit vector pointing to +x (or +y). */
function direction(l: LineItem | Extract<Shape, { kind: 'line' }>): Pt {
  let x = l.p2.x - l.p1.x, y = l.p2.y - l.p1.y;
  const n = Math.hypot(x, y);
  x /= n;
  y /= n;
  return x < -1e-12 || (Math.abs(x) < 1e-12 && y < 0) ? pt(-x, -y) : pt(x, y);
}

const build = (id: keyof typeof RECIPES, inputs: Input[]) => RECIPES[id].build(inputs);

describe('recipes', () => {
  it('every recipe asks for at least one input, an item only first', () => {
    for (const r of Object.values(RECIPES)) {
      expect(r.steps.length).toBeGreaterThan(0);
      r.steps.slice(1).forEach((s) => expect(s.take).not.toBe('item'));
    }
  });

  it('segment: nothing for 2 identical points', () => {
    expect(shapes(build('segment', [pt(1, 1), pt(1, 1)]))).toEqual([]);
    expect(only(build('segment', [pt(1, 1), pt(4, 5)]), 'segment')).toEqual({ kind: 'segment', p1: pt(1, 1), p2: pt(4, 5) });
  });

  it('lines are extended to the ±50000 box of the desktop version', () => {
    const l = only(build('horizontal', [pt(10, 20)]), 'line');
    expect(l).toEqual({ kind: 'line', p1: pt(-50000, 20), p2: pt(50000, 20) });
    const v = only(build('vertical', [pt(10, 20)]), 'line');
    expect([v.p1.x, v.p2.x]).toEqual([10, 10]);
  });

  it('circle through 3 points, or a failure when they are aligned', () => {
    const c = build('circle3', [pt(0, 10), pt(10, 0), pt(-10, 0)]);
    const s = only(c, 'circle');
    expect(s.c.x).toBeCloseTo(0);
    expect(s.c.y).toBeCloseTo(0);
    expect(s.r).toBeCloseTo(10);
    expect('center' in c && c.center).toEqual(s.c);
    expect(build('circle3', [pt(0, 0), pt(1, 1), pt(2, 2)])).toEqual({ fail: 'Les 3 points doivent être distincts et non alignés.', alert: false });
  });

  it('parallel and perpendicular through a point', () => {
    const ref = segment(pt(0, 0), pt(10, 5));
    const par = only(build('parallel', [ref, pt(3, 40)]), 'line');
    expect(direction(par).x).toBeCloseTo(direction({ kind: 'line', ...style, p1: ref.p1, p2: ref.p2 }).x);
    const per = only(build('perpendicular', [ref, pt(3, 40)]), 'line');
    const d = direction(per);
    expect(d.x * 10 + d.y * 5).toBeCloseTo(0); // orthogonal to the reference
  });

  it('bisection: perpendicular through the middle', () => {
    const l = only(build('bisection', [segment(pt(0, 0), pt(10, 0))]), 'line');
    expect(l.p1.x).toBeCloseTo(5);
    expect(l.p2.x).toBeCloseTo(5);
  });

  it('tangents from an outside point, a failure from inside', () => {
    const t = shapes(build('tangent', [circle(pt(0, 0), 5), pt(10, 0)]));
    expect(t).toHaveLength(2);
    expect(build('tangent', [circle(pt(0, 0), 5), pt(1, 0)])).toMatchObject({ alert: true });
  });

  it('circle from a segment: radius from the closest end, or diameter', () => {
    const s = segment(pt(0, 0), pt(6, 8));
    expect(only(build('circleFromRadius', [s, pt(5, 7)]), 'circle')).toEqual({ kind: 'circle', c: pt(6, 8), r: 10 });
    expect(only(build('circleFromDiameter', [s]), 'circle')).toEqual({ kind: 'circle', c: pt(3, 4), r: 5 });
  });

  it('ellipse needs a sum larger than the focal distance', () => {
    expect(build('ellipse', [pt(0, 0), pt(10, 0), 10])).toMatchObject({ alert: true });
    expect(only(build('ellipse', [pt(0, 0), pt(10, 0), 12]), 'ellipse').dSum).toBe(12);
  });

  it('arc: Qt angles, a full turn makes a circle, a tiny one nothing', () => {
    const a = only(build('arc', [pt(0, 0), pt(0, -10), 45]), 'arc');
    expect(a.start).toBeCloseTo(90); // up on screen = 90° counter-clockwise
    expect(a.r).toBeCloseTo(10);
    expect(only(build('arc', [pt(0, 0), pt(10, 0), -359.5]), 'circle').r).toBe(10);
    expect(shapes(build('arc', [pt(0, 0), pt(10, 0), 0.2]))).toEqual([]);
  });

  it('arc cut out of a circle replaces it', () => {
    const c = circle(pt(0, 0), 10);
    const res = build('arcFromCircle', [c, pt(10, 0), 90]);
    expect('remove' in res && res.remove).toEqual([c]);
    expect(only(res, 'arc')).toMatchObject({ c: pt(0, 0), r: 10, start: 0, span: 90 });
  });

  it('angle line: the angle is measured from the reference, counter-clockwise', () => {
    const ref = segment(pt(0, 0), pt(100, 0));
    const l = only(build('angleLine', [ref, pt(50, 0), 90]), 'line');
    expect(l.p1.x).toBeCloseTo(50);
    expect(l.p2.x).toBeCloseTo(50);
    const vertex = RECIPES.angleLine.steps[1];
    if (vertex.take !== 'point' || !vertex.onto) throw new Error('vertex step');
    expect(vertex.onto(pt(500, 30), [ref])).toEqual(pt(100, 0)); // kept within the segment
  });
});

describe('spiral', () => {
  it('one item or 4 arcs, with its base', () => {
    const sides = [seg(pt(0, 0), pt(10, 0)), seg(pt(10, 0), pt(10, -10))];
    const base = completeSpiralBase(sides, 2, false);
    if (typeof base === 'string') throw new Error(base);
    expect(spiralShapes(base, { oneItem: true, showBase: false, centersOnly: true }).map((s) => s.kind)).toEqual(['spiral']);
    const four = spiralShapes(base, { oneItem: false, showBase: true, centersOnly: false });
    expect(four.map((s) => s.kind)).toEqual(['arc', 'arc', 'arc', 'arc', 'segment', 'segment', 'segment', 'segment']);
    const first = four[0] as Extract<Shape, { kind: 'arc' }>;
    expect(dist(first.c, pt(10, 0))).toBeLessThan(dist(first.c, pt(100, 100)));
  });
});

describe('directions and carried distances', () => {
  it('half-line and extension: from their origin only', () => {
    const r = only(build('halfLine', [pt(10, 10), pt(20, 10)]), 'segment');
    expect(r.p1).toEqual(pt(10, 10));
    expect(r.p2.x).toBeGreaterThan(50000);
    const e = only(build('extension', [pt(0, 0), pt(10, 0)]), 'segment');
    expect(e.p1).toEqual(pt(10, 0)); // starts at B, goes beyond
    expect(e.p2.x).toBeGreaterThan(10);
  });

  it('azimuths: clockwise from the top of the sheet', () => {
    const south = only(build('azimuthRay', [pt(0, 0), 180]), 'segment');
    expect(south.p2.x).toBeCloseTo(0);
    expect(south.p2.y).toBeGreaterThan(0); // down on screen
    const east = only(build('azimuthRay', [pt(0, 0), 90]), 'segment');
    expect(east.p2.x).toBeGreaterThan(0);
    expect(east.p2.y).toBeCloseTo(0);
    const ne = only(build('azimuthLine', [pt(0, 0), 45]), 'line');
    expect(direction(ne).x).toBeCloseTo(Math.SQRT1_2);
    expect(direction(ne).y).toBeCloseTo(-Math.SQRT1_2); // north-east: right and up
  });

  it('a distance carried along a line, in the chosen sense', () => {
    const ref = { kind: 'line', ...style, p1: pt(-50000, 0), p2: pt(50000, 0) } as LineItem;
    const s = shapes(build('carry', [ref, pt(100, 0), pt(50, 0), 30]));
    expect(s.map((x) => x.kind)).toEqual(['segment', 'point']);
    expect((s[1] as Extract<Shape, { kind: 'point' }>).p).toEqual(pt(70, 0)); // towards the side clicked
  });

  it('center of 3 points', () => {
    expect(only(build('centroid', [pt(0, 0), pt(6, 0), pt(0, 9)]), 'point').p).toEqual(pt(2, 3));
  });
});
