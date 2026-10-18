import { describe, expect, it } from 'vitest';
import { angleOf, angleTo, circumcenter, extendLine, intersect, normalVector, pt, seg, tangencyPoints, withLength } from '../src/geom';
import { ArcSpanTracker, completeSpiralBase, spiralArcs, spiralSides } from '../src/shapes';

describe('Qt-compatible line geometry', () => {
  it('measures angles counter-clockwise on screen (y down)', () => {
    expect(angleOf(seg(pt(0, 0), pt(1, 0)))).toBe(0);
    expect(angleOf(seg(pt(0, 0), pt(0, -1)))).toBe(90); // upwards on screen
    expect(angleOf(seg(pt(0, 0), pt(1, 1)))).toBeCloseTo(315);
    expect(angleTo(seg(pt(0, 0), pt(1, 0)), seg(pt(0, 0), pt(0, 1)))).toBeCloseTo(270);
  });

  it('builds normal vectors like QLineF::normalVector', () => {
    const n = normalVector(seg(pt(1, 1), pt(4, 5)));
    expect(n.p1).toEqual(pt(1, 1));
    expect(n.p2).toEqual(pt(1 + 4, 1 - 3));
  });

  it('intersects infinite lines', () => {
    expect(intersect(seg(pt(0, 0), pt(1, 1)), seg(pt(0, 2), pt(2, 0)))).toEqual(pt(1, 1));
    expect(intersect(seg(pt(0, 0), pt(1, 0)), seg(pt(0, 1), pt(1, 1)))).toBeNull();
  });

  it('extends lines to the 100 000 px square of the desktop version', () => {
    // Same result as the "Line" of formations-gribouillot/mes-solutions/Lumiere.xml
    const l = extendLine(pt(6305.13, 1256.54), pt(4736.86, 3495.22))!;
    const xs = [l.p1.x, l.p2.x].sort((a, b) => a - b);
    expect(Math.abs(l.p1.y) === 50000 || Math.abs(l.p2.y) === 50000 || xs[0] === -50000).toBe(true);
    const h = extendLine(pt(10, 20), pt(11, 20))!;
    expect([h.p1, h.p2].map((p) => p.y)).toEqual([20, 20]);
    expect([h.p1.x, h.p2.x].sort((a, b) => a - b)).toEqual([-50000, 50000]);
  });

  it('finds the circle through 3 points', () => {
    const c = circumcenter(pt(0, 10), pt(10, 0), pt(-10, 0))!;
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(circumcenter(pt(0, 0), pt(1, 1), pt(2, 2))).toBeNull();
  });

  it('computes tangency points', () => {
    const t = tangencyPoints(pt(0, 0), 5, pt(10, 0))!;
    for (const p of t) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(5);
      // radius ⟂ tangent
      expect(p.x * (10 - p.x) + p.y * (0 - p.y)).toBeCloseTo(0);
    }
    expect(tangencyPoints(pt(0, 0), 5, pt(1, 0))).toBeNull();
  });

  it('keeps negative lengths like QLineF::setLength', () => {
    expect(withLength(seg(pt(0, 0), pt(2, 0)), -3).p2).toEqual(pt(-3, 0));
  });
});

describe('arc drawing helper', () => {
  it('follows the direction the user starts to turn', () => {
    const t = new ArcSpanTracker();
    const first = seg(pt(0, 0), pt(10, 0));
    expect(t.update(first, seg(pt(0, 0), pt(10, -1)))).toBeCloseTo(5.71, 1); // counter-clockwise
    const t2 = new ArcSpanTracker();
    expect(t2.update(first, seg(pt(0, 0), pt(10, 1)))).toBeCloseTo(-5.71, 1); // clockwise
    expect(t2.update(first, seg(pt(0, 0), pt(-10, 1)))).toBeCloseTo(-174.29, 1);
  });
});

describe('4 centers spiral', () => {
  it('grows by the length of the sides', () => {
    const centers = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
    const arcs = spiralArcs(centers);
    expect(arcs.map((a) => a.r)).toEqual([10, 20, 30, 40]);
    expect(arcs.every((a) => Math.abs(Math.abs(a.span) - 90) < 1e-9)).toBe(true);
  });

  it('completes a square base from 2 centers', () => {
    const sides = [seg(pt(0, 0), pt(10, 0)), seg(pt(10, 0), pt(10, -10))];
    const base = completeSpiralBase(sides, 2, false);
    expect(typeof base).not.toBe('string');
    const s = base as ReturnType<typeof spiralSides>;
    expect(s[2].p2.x).toBeCloseTo(0);
    expect(Math.abs(s[2].p2.y)).toBeCloseTo(10);
  });

  it('rejects a concave base', () => {
    const sides = [seg(pt(0, 0), pt(10, 0)), seg(pt(10, 0), pt(10, -10)), seg(pt(10, -10), pt(8, -2))];
    expect(typeof completeSpiralBase(sides, 4, false)).toBe('string');
  });
});
