import { describe, expect, it } from 'vitest';
import { clipSegment, pt } from '../src/geom';
import { kindCounts, nearLine, nearPoint, readMonuments, searchQuery } from '../src/monuments';

const ms = readMonuments({
  kinds: ['église', 'croix de chemin', 'château'],
  monuments: [
    ['PA1', 'Église Notre-Dame', 'Clisson', '44', 47.0870, -1.2820, [0], 1910, 'C'],
    ['PA2', 'Croix', 'Clisson', '44', 47.0960, -1.2820, [1], 1995, 'I'], // 1 km north
    ['PA3', 'Château de Clisson', 'Clisson', '44', 47.0870, -1.2160, [2, 0], 1924, 'C'], // 5 km east
  ],
});

describe('monuments', () => {
  it('near a point, the closest first', () => {
    const found = nearPoint(ms, { lat: 47.0870, lon: -1.2820 }, 1.5);
    expect(found.map((f) => f.m.ref)).toEqual(['PA1', 'PA2']);
    expect(found[1].km).toBeCloseTo(1.0, 1);
    expect(nearPoint(ms, { lat: 47.0870, lon: -1.2820 }, 6)).toHaveLength(3);
  });

  it('along a line, in its order, with the distance to it', () => {
    // A line going west to east, 500 m south of the church.
    const line = [{ lat: 47.0825, lon: -1.30 }, { lat: 47.0825, lon: -1.20 }];
    const found = nearLine(ms, line, 1);
    expect(found.map((f) => f.m.ref)).toEqual(['PA1', 'PA3']);
    expect(found[0].km).toBeCloseTo(0.5, 1);
    expect(found[1].along).toBeGreaterThan(found[0].along);
  });

  it('natures, counted once per monument', () => {
    expect(kindCounts(nearPoint(ms, { lat: 47.087, lon: -1.282 }, 6))).toEqual([['église', 2], ['château', 1], ['croix de chemin', 1]]);
  });

  it('what to search: the title and the town, once', () => {
    expect(searchQuery(ms[0])).toBe('Église Notre-Dame Clisson');
    expect(searchQuery(ms[2])).toBe('Château de Clisson');
  });

  it('a line clipped to the map', () => {
    const s = clipSegment(pt(-50000, 50), pt(50000, 50), { x: 0, y: 0, w: 200, h: 100 })!;
    expect([s.p1.x, s.p2.x]).toEqual([0, 200]);
    expect(clipSegment(pt(-50000, 500), pt(50000, 500), { x: 0, y: 0, w: 200, h: 100 })).toBeNull();
  });
});
