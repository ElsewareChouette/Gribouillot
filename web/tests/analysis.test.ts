import { describe, expect, it } from 'vitest';
import { errorPolygon, zoneCrossings } from '../src/analysis';
import { pt } from '../src/geom';
import type { Item } from '../src/model';

const s = { id: 'x', color: '#000000', width: 2 };
const line = (id: string, a: [number, number], b: [number, number]) => ({ kind: 'line', ...s, id, p1: pt(...a), p2: pt(...b) }) as Extract<Item, { kind: 'line' }>;

describe('analysis', () => {
  it('3 lines nearly meeting: a small triangle, its center and size', () => {
    const p = errorPolygon([line('a', [-100, 0], [100, 0]), line('b', [0, -100], [0, 100]), line('c', [-100, -97], [100, 103])])!;
    expect(p.corners).toHaveLength(3);
    expect(p.spread).toBeGreaterThan(3);
    expect(p.spread).toBeLessThan(5);
    expect(Math.hypot(p.center.x, p.center.y)).toBeLessThan(3);
    expect(p.corners[0].ids).toHaveLength(2);
  });

  it('parallel lines: no polygon', () => {
    expect(errorPolygon([line('a', [0, 0], [1, 0]), line('b', [0, 5], [1, 5])])).toBeNull();
  });

  it('a line crossing a zone, or missing it', () => {
    const l = line('l', [-100, 0], [100, 0]);
    const zones = [{ kind: 'circle', ...s, id: 'z1', c: pt(0, 3), r: 5 }, { kind: 'circle', ...s, id: 'z2', c: pt(50, 8), r: 5 }] as Extract<Item, { kind: 'circle' }>[];
    const [a, b] = zoneCrossings(l, zones);
    expect(a.crosses).toBe(true);
    expect(a.margin).toBeCloseTo(2);
    expect(b.crosses).toBe(false);
    expect(b.margin).toBeCloseTo(-3);
  });
});
