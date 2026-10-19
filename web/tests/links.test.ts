import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/constructions';
import { dist, pt, type Pt } from '../src/geom';
import { itemIntersections } from '../src/intersections';
import { itemSource, linksFor, propagate, uniqueIds } from '../src/links';
import type { Item, Layer, PointItem, Source, StrokeItem } from '../src/model';

const style = { color: '#000000', width: 2 };
const point = (id: string, p: Pt): PointItem => ({ kind: 'point', id, ...style, p, weight: 0 });

/** The items a recipe makes from these sources, as the construction tool does. */
function construct(recipe: keyof typeof RECIPES, sources: Source[], ids: string[], find: (id: string) => StrokeItem): StrokeItem[] {
  const inputs = sources.map((s) => (s.k === 'num' ? s.v : s.k === 'pt' ? s.p : s.k === 'item' ? (find(s.id).kind === 'point' ? (find(s.id) as PointItem).p : find(s.id)) : s.p));
  const res = RECIPES[recipe].build(inputs);
  if ('fail' in res) throw new Error(res.fail);
  const links = linksFor(recipe, sources, res.shapes.length);
  return res.shapes.map((sh, i) => ({ ...sh, id: ids[i], ...style, link: links.shapes[i] }) as StrokeItem);
}

function figure() {
  const a = point('a', pt(0, 0)), b = point('b', pt(10, 0));
  const all = new Map<string, StrokeItem>([['a', a], ['b', b]]);
  const find = (id: string) => all.get(id)!;
  const [line] = construct('line', [itemSource(a), itemSource(b)], ['line'], find);
  all.set('line', line);
  const [circle] = construct('circleCenter', [itemSource(a), itemSource(b)], ['circle'], find);
  all.set('circle', circle);
  // The crossing of the line and the circle on the side of B.
  const cross = itemIntersections(line, circle).find((p) => p.x > 0)!;
  const ip: PointItem = {
    ...point('cross', cross),
    link: { ...linksFor('@point', [], 1).shapes[0], sources: [{ k: 'snap', kind: 'intersection', ids: ['line', 'circle'], frozen: [line, circle], p: cross }] },
  };
  const layers: Layer[] = [{ id: 'l', name: 'l', visible: true, opacity: 100, items: [a, b, line, circle, ip] }];
  return layers;
}

const get = (layers: Layer[], id: string) => layers.flatMap((l) => l.items).find((i) => i.id === id)! as StrokeItem;
const move = (layers: Layer[], id: string, p: Pt): Layer[] => layers.map((l) => ({ ...l, items: l.items.map((i) => (i.id === id && i.kind === 'point' ? { ...i, p } : i)) }));

describe('linked constructions', () => {
  it('moving a point moves what is built on it, and what is built on that', () => {
    // B dragged by small steps, a quarter turn around A, to 20 px from it.
    let layers = figure();
    for (let i = 1; i <= 20; i++) {
      const a = (i / 20) * (Math.PI / 2), r = 10 + i / 2;
      const res = propagate(move(layers, 'b', pt(r * Math.cos(a), r * Math.sin(a))), ['b']);
      expect(res.stale).toBe(0);
      layers = res.layers;
    }
    const circle = get(layers, 'circle') as Extract<Item, { kind: 'circle' }>;
    expect(circle.r).toBeCloseTo(20);
    const line = get(layers, 'line') as Extract<Item, { kind: 'line' }>;
    expect(Math.abs(line.p1.x)).toBeLessThan(1e-9); // now vertical, through A and B
    const cross = (get(layers, 'cross') as PointItem).p;
    expect(dist(cross, pt(0, 20))).toBeLessThan(1e-6); // the crossing followed B
  });

  it('keeps the id, style and weight of the items, and shares untouched layers', () => {
    const before = figure();
    const other: Layer = { id: 'o', name: 'o', visible: true, opacity: 100, items: [point('z', pt(5, 5))] };
    const { layers } = propagate([...move(before, 'b', pt(20, 0)), other], ['b']);
    expect(layers[1]).toBe(other);
    expect(get(layers, 'circle')).toMatchObject({ id: 'circle', color: '#000000', width: 2 });
  });

  it('nothing depends on a point: the layers are unchanged', () => {
    const before = figure();
    expect(propagate(before, ['z']).layers).toBe(before);
  });

  it('a construction impossible after the move is left as it was', () => {
    const a = point('a', pt(0, 0)), b = point('b', pt(10, 0)), c = point('c', pt(0, 10));
    const all = new Map<string, StrokeItem>([['a', a], ['b', b], ['c', c]]);
    const [circle] = construct('circle3', [itemSource(a), itemSource(b), itemSource(c)], ['circle'], (id) => all.get(id)!);
    const layers: Layer[] = [{ id: 'l', name: 'l', visible: true, opacity: 100, items: [a, b, c, circle] }];
    const res = propagate(move(layers, 'c', pt(20, 0)), ['c']); // the 3 points aligned
    expect(res.stale).toBe(1);
    expect(get(res.layers, 'circle')).toEqual(circle);
  });

  it('a deleted source still gives its last value', () => {
    const before = figure();
    const noLine = before.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== 'line') }));
    const { layers } = propagate(move(noLine, 'b', pt(0, 20)), ['b']);
    // The crossing of the old line with the new circle of radius 20, on the side of B.
    expect(dist((get(layers, 'cross') as PointItem).p, pt(20, 0))).toBeLessThan(1e-6);
  });

  it('imported items get new ids, their links follow', () => {
    const imported = figure();
    const out = uniqueIds(imported, new Set(['a', 'line']));
    const items = out[0].items as StrokeItem[];
    const [a, , line] = items;
    expect(a.id).not.toBe('a');
    expect(line.id).not.toBe('line');
    expect(line.link!.sources[0]).toMatchObject({ k: 'item', id: a.id });
    const cross = items[4];
    expect(cross.link!.sources[0]).toMatchObject({ ids: [line.id, 'circle'] });
  });
});
