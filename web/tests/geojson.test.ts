import { describe, expect, it } from 'vitest';
import { enigmaGroups } from '../src/enigmas';
import { fitGeoref, type Anchor } from '../src/geo';
import { pt } from '../src/geom';
import { toGeoJSON } from '../src/geojson';
import type { Layer } from '../src/model';

// A map where 1 px = 0.001° (north up), around 47° N 2° E.
const anchors: Anchor[] = [[0, 0], [1000, 0], [0, 1000], [1000, 1000]].map(([x, y], i) => ({ id: `a${i}`, name: `a${i}`, p: pt(x, y), lat: 47 - y * 0.001, lon: 2 + x * 0.001 }));
const g = fitGeoref(anchors)!;
const s = { color: '#ff0000', width: 2 };

describe('GeoJSON', () => {
  it('points and lines, longitude first, lines clipped to the map, with their énigme and construction', () => {
    const groups = enigmaGroups();
    groups[0].layerIds = ['l'];
    const layers: Layer[] = [{
      id: 'l', name: '530 points', visible: true, opacity: 100,
      items: [
        { kind: 'point', id: 'b', ...s, p: pt(500, 500), weight: 0, label: 'Bourges', note: 'l\'Ouverture' },
        { kind: 'line', id: 'd', ...s, p1: pt(-50000, 500), p2: pt(50000, 500), label: 'd1', link: { recipe: 'horizontal', group: 'k', seq: 1, out: 0, sources: [{ k: 'item', id: 'b', frozen: { kind: 'point', id: 'b', ...s, p: pt(500, 500), weight: 0 } }] } },
      ],
    }];
    const f = (toGeoJSON(layers, groups, g, { x: 0, y: 0, w: 1000, h: 1000 }, (px) => `${px} px`) as { features: { geometry: { type: string; coordinates: number[] | number[][] }; properties: Record<string, string> }[] }).features;
    expect(f).toHaveLength(2);
    const [lon, lat] = f[0].geometry.coordinates as number[];
    expect(lon).toBeCloseTo(2.5, 2);
    expect(lat).toBeCloseTo(46.5, 2);
    expect(f[0].properties).toMatchObject({ name: 'Bourges', type: 'point', enigme: '530 Ouverture', note: 'l\'Ouverture' });
    const line = f[1].geometry.coordinates as number[][];
    expect(f[1].geometry.type).toBe('LineString');
    expect(line[0][0]).toBeCloseTo(2, 2); // clipped at the left edge of the map
    expect(line[line.length - 1][0]).toBeCloseTo(3, 2);
    expect(f[1].properties.construction).toBe('Horizontale passant par Bourges');
  });
});
