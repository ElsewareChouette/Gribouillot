import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitGeoref, fromLambert, kmBetween, parseLatLon, toLambert, type Anchor } from '../src/geo';
import { pt } from '../src/geom';

describe('Lambert-93', () => {
  it('origin of the projection', () => {
    const p = toLambert({ lat: 46.5, lon: 3 });
    expect(p.x).toBeCloseTo(700000, 3);
    expect(p.y).toBeCloseTo(6600000, 3);
  });

  it('round trip', () => {
    for (const ll of [{ lat: 48.8566, lon: 2.3522 }, { lat: 43.2965, lon: 5.3698 }, { lat: 48.3904, lon: -4.4861 }]) {
      const back = fromLambert(toLambert(ll));
      expect(back.lat).toBeCloseTo(ll.lat, 9);
      expect(back.lon).toBeCloseTo(ll.lon, 9);
    }
  });

  it('agrees with PROJ (EPSG:4326 -> EPSG:2154) to the millimeter', () => {
    const ref: [number, number, number, number][] = [
      [48.853, 2.3499, 652296.9731, 6861636.3585],
      [48.3904, -4.4861, 146632.9785, 6836262.3267],
      [48.5734, 7.7521, 1050362.6954, 6840899.6472],
    ];
    for (const [lat, lon, x, y] of ref) {
      const p = toLambert({ lat, lon });
      expect(p.x).toBeCloseTo(x, 2);
      expect(p.y).toBeCloseTo(y, 2);
    }
  });
});

/** A map at 1:1 000 000 scanned at 250 dpi, slightly turned: 1 px = 101.6 m. */
const k = 101.6, turn = 0.02;
const toMap = (lat: number, lon: number) => {
  const l = toLambert({ lat, lon });
  const x = (l.x - 100000) / k, y = (7200000 - l.y) / k;
  return pt(x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn));
};
const towns: [string, number, number][] = [
  ['Paris', 48.8566, 2.3522], ['Marseille', 43.2965, 5.3698], ['Brest', 48.3904, -4.4861],
  ['Strasbourg', 48.5734, 7.7521], ['Bordeaux', 44.8378, -0.5792], ['Lille', 50.6292, 3.0573],
  ['Toulouse', 43.6047, 1.4442], ['Lyon', 45.764, 4.8357],
];
const anchors = (n: number, noise = 0): Anchor[] =>
  towns.slice(0, n).map(([name, lat, lon], i) => {
    const p = toMap(lat, lon);
    return { id: name, name, lat, lon, p: pt(p.x + (i % 2 ? noise : -noise), p.y + (i % 3 ? noise : 0)) };
  });

describe('georeferencing', () => {
  it('needs 2 anchors', () => {
    expect(fitGeoref(anchors(1))).toBeNull();
    const g = fitGeoref(anchors(2))!;
    expect(g.model).toBe('similarity');
    expect(g.rms).toBeNull();
  });

  it('a map in Lambert-93 is found exactly, both ways', () => {
    const g = fitGeoref(anchors(5))!;
    expect(g.rms!).toBeLessThan(0.01);
    const p = toMap(47.2184, -1.5536); // Nantes, not an anchor
    const ll = g.toLatLon(p);
    expect(ll.lat).toBeCloseTo(47.2184, 4);
    expect(ll.lon).toBeCloseTo(-1.5536, 4);
    const back = g.toPx(ll);
    expect(back.x).toBeCloseTo(p.x, 2);
    expect(back.y).toBeCloseTo(p.y, 2);
  });

  it('the errors of a badly placed anchor show up', () => {
    const a = anchors(6);
    a[3] = { ...a[3], p: pt(a[3].p.x + 20, a[3].p.y) }; // 2 km off
    const g = fitGeoref(a)!;
    const worst = g.checks.map((c) => c!.km).indexOf(g.max!);
    expect(worst).toBe(3);
    expect(g.max!).toBeGreaterThan(1.5);
  });

  it('a noisy scan: kilometric precision', () => {
    const g = fitGeoref(anchors(8, 5))!;
    expect(g.rms!).toBeGreaterThan(0.1);
    expect(g.rms!).toBeLessThan(2);
  });
});

describe('reading coordinates', () => {
  const near = (s: string, lat: number, lon: number) => {
    const ll = parseLatLon(s);
    expect(ll, s).not.toBeNull();
    expect(ll!.lat).toBeCloseTo(lat, 4);
    expect(ll!.lon).toBeCloseTo(lon, 4);
  };

  it('decimal degrees, with dots or commas', () => {
    near('45.12345, 1.23456', 45.12345, 1.23456);
    near('45,12345, 1,23456', 45.12345, 1.23456);
    near('45,12345 -1,23456', 45.12345, -1.23456);
    near('45,5 ; 2,25', 45.5, 2.25);
  });

  it('degrees, minutes, seconds and letters', () => {
    near('45°07\'24"N 1°14\'02"W', 45 + 7 / 60 + 24 / 3600, -(1 + 14 / 60 + 2 / 3600));
    near('48° 51′ 24″ N, 2° 21′ 08″ E', 48 + 51 / 60 + 24 / 3600, 2 + 21 / 60 + 8 / 3600);
    near('2.35 E 48.85 N', 48.85, 2.35);
  });

  it('latitude and longitude swapped, for France', () => {
    near('2.3522, 48.8566', 48.8566, 2.3522);
  });

  it('nonsense', () => {
    expect(parseLatLon('Paris')).toBeNull();
    expect(parseLatLon('45.1')).toBeNull();
    expect(parseLatLon('95, 400')).toBeNull();
  });
});

describe('the Michelin 989 map (Zarquos scan)', () => {
  const data = JSON.parse(readFileSync(join(__dirname, 'fixtures/zarquos-989.json'), 'utf8')) as {
    anchors: { name: string; x: number; y: number; lat: number; lon: number }[];
  };
  const real = data.anchors.map((t): Anchor => ({ id: t.name, name: t.name, p: pt(t.x, t.y), lat: t.lat, lon: t.lon }));

  it('42 towns: half a kilometer', () => {
    const g = fitGeoref(real)!;
    expect(g.rms!).toBeLessThan(0.5);
    expect(g.max!).toBeLessThan(1.2);
  });

  it('10 towns: the announced precision holds on the 32 others', () => {
    const names = ['Ploudalmézeau', 'Étretat', 'Wormhout', 'Brumath', 'Machecoul-Saint-Même', 'Soustons', 'Estagel', 'Trets', 'Colmars', 'Lezoux'];
    const g = fitGeoref(real.filter((a) => names.includes(a.name)))!;
    const errs = real.filter((a) => !names.includes(a.name)).map((a) => kmBetween(g.toLatLon(a.p), a));
    const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    expect(rms).toBeLessThan(g.rms! * 1.2);
    expect(Math.max(...errs)).toBeLessThan(1.5);
  });

  it('a mistaken town stands out', () => {
    // Combronde clicked on the circle of Manzat, its neighbour.
    const wrong = real.map((a) => (a.name === 'Combronde' ? { ...a, p: pt(5066, 4460) } : a));
    const g = fitGeoref(wrong)!;
    expect(wrong[g.checks.findIndex((c) => c!.km === g.max)].name).toBe('Combronde');
    expect(g.max!).toBeGreaterThan(8);
  });
});

describe('lists of towns', () => {
  it('names, departments and weights', async () => {
    const { parseTownList } = await import('../src/places');
    expect(parseTownList('Clisson\n  Nantes ; 3\nSaint-Pierre (44) 2\nLes Pieux, -1\n\nBourg-en-Bresse\t12\nPont-l\'Évêque (14)')).toEqual([
      { name: 'Clisson' },
      { name: 'Nantes', weight: 3 },
      { name: 'Saint-Pierre', dept: '44', weight: 2 },
      { name: 'Les Pieux', weight: -1 },
      { name: 'Bourg-en-Bresse', weight: 12 },
      { name: 'Pont-l\'Évêque', dept: '14' },
    ]);
    expect(parseTownList('Corse (2A) 1')[0]).toEqual({ name: 'Corse', dept: '2A', weight: 1 });
    // The name to write on the map, before « = » or « : » (the code of the 580).
    expect(parseTownList('A = Angers ; 0\nB: Bourges 1\nJ=Jarnac (16) 9')).toEqual([
      { name: 'Angers', weight: 0, label: 'A' },
      { name: 'Bourges', weight: 1, label: 'B' },
      { name: 'Jarnac', dept: '16', weight: 9, label: 'J' },
    ]);
  });

  it('comparable names', async () => {
    const { townKey } = await import('../src/places');
    expect(townKey('St-Étienne')).toBe(townKey('Saint Étienne'));
    expect(townKey('Ste-Foy-lès-Lyon')).toBe('sainte foy les lyon');
    expect(townKey('L’Aiguillon')).toBe(townKey("l'aiguillon"));
  });
});

describe('known maps', () => {
  it('the Zarquos scan is recognized by its size, and its calibration holds on the 42 reference towns', async () => {
    const { knownAnchors, knownMap } = await import('../src/calibrations');
    expect(knownMap({ w: 8460, h: 7569 })).toBeUndefined();
    const known = knownMap({ w: 8460, h: 7570 })!;
    const g = fitGeoref(knownAnchors(known))!;
    const ref = JSON.parse(readFileSync(join(__dirname, 'fixtures/zarquos-989.json'), 'utf8')).anchors as { x: number; y: number; lat: number; lon: number }[];
    const errs = ref.map((t) => kmBetween(g.toLatLon(pt(t.x, t.y)), t));
    expect(Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)).toBeLessThan(0.7);
    expect(Math.max(...errs)).toBeLessThan(1.2);
  });
});

describe('on the ground', () => {
  it('geodesic distances agree with PROJ (GRS80) to the millimeter', async () => {
    const { geodesicKm } = await import('../src/geo');
    expect(geodesicKm({ lat: 47.087, lon: -1.282 }, { lat: 48.5734, lon: 7.7521 })).toBeCloseTo(695.8202847, 6);
    expect(geodesicKm({ lat: 48.3904, lon: -4.4861 }, { lat: 43.2965, lon: 5.3698 })).toBeCloseTo(950.9838967, 6);
    expect(geodesicKm({ lat: 47, lon: 2 }, { lat: 47.0001, lon: 2 })).toBeCloseTo(0.011117084, 8);
  });

  it('the meridians lean on a conic map: north is not up everywhere', async () => {
    const { meridianAngle } = await import('../src/geo');
    const g = fitGeoref(anchors(8))!; // a map in Lambert-93, turned by 0.02 rad
    const turn = (0.02 * 180) / Math.PI;
    // On the central meridian (3° E) north is up, but for the turn of the scan.
    expect(meridianAngle(g, toMap(46.5, 3))).toBeCloseTo(turn, 1);
    // The meridians lean towards the central one (convergence ≈ 0.73 × Δlon):
    // in Brittany north is right of the top of the sheet, in Alsace left of it.
    expect(meridianAngle(g, toMap(48.4, -4.5)) - turn).toBeCloseTo(0.7256 * 7.5, 0);
    expect(meridianAngle(g, toMap(48.6, 7.75)) - turn).toBeCloseTo(-0.7256 * 4.75, 0);
  });
});
