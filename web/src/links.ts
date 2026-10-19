/**
 * Linked constructions: an item built by a tool remembers where its inputs
 * came from (links in model.ts). When a point moves, the items depending on
 * it are built again, in creation order, so that the whole figure follows.
 */

import { RECIPES, type Input, type Recipe, type Shape } from './constructions';
import { dist, mid, polar, type Pt } from './geom';
import { centerOf, itemIntersections, type SnapPoint } from './intersections';
import { newId, type Item, type Layer, type Link, type Source, type StrokeItem } from './model';

let counter = 0;
/** A creation order number, increasing even within a millisecond. */
export function nextSeq(): number {
  counter = (counter + 1) % 1000;
  return Date.now() * 1000 + counter;
}

/** An item as a source copy: without its own link, which would nest forever. */
export function frozen(it: StrokeItem): StrokeItem {
  const { link: _link, ...rest } = it;
  return rest as StrokeItem;
}

/** The source of a click: the point or remarkable spot it snapped on, else the position itself. */
export function clickSource(p: Pt, snap: SnapPoint | null, find: (id: string) => Item | undefined): Source {
  if (!snap) return { k: 'pt', p };
  const items = (snap.ids ?? []).map(find).filter((i): i is StrokeItem => !!i && i.kind !== 'pixmap');
  if (items.length !== (snap.ids ?? []).length || !items.length) return { k: 'pt', p };
  if (snap.kind === 'point') return { k: 'item', id: items[0].id, frozen: frozen(items[0]) };
  return { k: 'snap', kind: snap.kind, ids: items.map((i) => i.id), frozen: items.map(frozen), end: snap.end, p: snap.p };
}

export const itemSource = (it: StrokeItem): Source => ({ k: 'item', id: it.id, frozen: frozen(it) });

/** The ids an item's construction depends on. */
export function dependsOn(link: Link): string[] {
  return link.sources.flatMap((s) => (s.k === 'item' ? [s.id] : s.k === 'snap' ? s.ids : []));
}

type Find = (id: string) => StrokeItem | undefined;

/** The position a snapped source stands for now (its last one if it vanished). */
function snapPosition(s: Extract<Source, { k: 'snap' }>, find: Find): Pt {
  const items = s.ids.map((id, i) => find(id) ?? s.frozen[i]);
  const [a, b] = items;
  switch (s.kind) {
    case 'intersection': {
      // The crossing closest to the previous one: lines and circles move little at a time.
      const pts = itemIntersections(a, b);
      return pts.length ? pts.reduce((best, q) => (dist(q, s.p) < dist(best, s.p) ? q : best)) : s.p;
    }
    case 'midpoint':
      return a.kind === 'segment' ? mid(a.p1, a.p2) : s.p;
    case 'end':
      if (a.kind === 'segment') return s.end ? a.p2 : a.p1;
      if (a.kind === 'arc') return polar(a.c, a.r, s.end ? a.start + a.span : a.start);
      return s.p;
    case 'center':
      return centerOf(a) ?? s.p;
  }
}

/** The value of a source for a construction, and the source updated with it. */
function resolve(s: Source, find: Find): { value: Input; source: Source } {
  switch (s.k) {
    case 'pt':
      return { value: s.p, source: s };
    case 'num':
      return { value: s.v, source: s };
    case 'item': {
      const it = find(s.id) ?? s.frozen;
      return { value: it.kind === 'point' ? it.p : it, source: s };
    }
    case 'snap': {
      const p = snapPosition(s, find);
      return { value: p, source: { ...s, p } };
    }
  }
}

/** Build a construction again from its sources. Null if it fails now. */
function rebuild(recipe: Recipe | undefined, sources: Source[], find: Find): { shapes: Shape[]; center?: Pt; sources: Source[] } | null {
  const inputs: Input[] = [];
  const updated: Source[] = [];
  for (const s of sources) {
    const r = resolve(s, find);
    updated.push(r.source);
    let v = r.value;
    // A position constrained by its step (e.g. onto the reference line) is constrained again.
    const step = recipe?.steps[inputs.length];
    if (step?.take === 'point' && step.onto && typeof v === 'object' && !('kind' in v)) v = step.onto(v, inputs);
    inputs.push(v);
  }
  if (!recipe) {
    // '@point': a point on a remarkable spot.
    const p = inputs[0];
    return typeof p === 'object' && !('kind' in p) ? { shapes: [{ kind: 'point', p, weight: 0 }], sources: updated } : null;
  }
  const res = recipe.build(inputs);
  return 'fail' in res ? null : { shapes: res.shapes, center: res.center, sources: updated };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface Propagation {
  layers: Layer[];
  /** Items whose construction failed with the new positions: left as they were. */
  stale: number;
}

/**
 * The layers once the items depending on `changed` (and on what changes in
 * turn) have been built again. Unchanged layers are shared.
 */
export function propagate(layers: Layer[], changed: Iterable<string>): Propagation {
  const byId = new Map<string, StrokeItem>();
  const groups = new Map<string, StrokeItem[]>();
  for (const l of layers) {
    for (const it of l.items) {
      if (it.kind === 'pixmap') continue;
      byId.set(it.id, it);
      if (it.link) {
        const g = groups.get(it.link.group);
        if (g) g.push(it);
        else groups.set(it.link.group, [it]);
      }
    }
  }
  const dirty = new Set(changed);
  const replaced = new Map<string, StrokeItem>();
  const find: Find = (id) => byId.get(id);
  let stale = 0;
  const ordered = [...groups.values()].sort((a, b) => a[0].link!.seq - b[0].link!.seq);
  for (const group of ordered) {
    const link = group[0].link!;
    if (!dependsOn(link).some((id) => dirty.has(id))) continue;
    const res = rebuild(link.recipe === '@point' ? undefined : RECIPES[link.recipe as keyof typeof RECIPES], link.sources, find);
    for (const it of group) {
      const l = it.link!;
      const shape = !res ? undefined : l.out === -1 ? (res.center ? ({ kind: 'point', p: res.center, weight: 0 } as Shape) : undefined) : res.shapes[l.out];
      if (!shape || (shape.kind !== it.kind && !(it.kind === 'arc' && shape.kind === 'circle'))) {
        stale++;
        continue;
      }
      // A point keeps its weight and its name; any item keeps its id and style.
      const geometry = shape.kind === 'point' && it.kind === 'point' ? { p: shape.p } : shape;
      const next = { ...it, ...geometry, link: { ...l, sources: res!.sources } } as StrokeItem;
      if (same(frozen(next), frozen(it))) continue;
      byId.set(it.id, next);
      replaced.set(it.id, next);
      dirty.add(it.id);
    }
  }
  if (!replaced.size) return { layers, stale };
  return {
    layers: layers.map((l) => (l.items.some((i) => replaced.has(i.id)) ? { ...l, items: l.items.map((i) => replaced.get(i.id) ?? i) } : l)),
    stale,
  };
}

/** The link of each shape of a new construction. */
export function linksFor(recipe: string, sources: Source[], count: number): { shapes: Link[]; center: Link } {
  const group = newId('k');
  const seq = nextSeq();
  return {
    shapes: Array.from({ length: count }, (_, out) => ({ recipe, group, seq, out, sources })),
    center: { recipe, group, seq, out: -1, sources },
  };
}

/**
 * The items of imported layers with ids unique against `taken` (which gets
 * them), the links following the renamed items.
 */
export function uniqueIds(layers: Layer[], taken: Set<string>): Layer[] {
  const rename = new Map<string, string>();
  let changed = false;
  const ids = layers.map((l) => l.items.map((it) => {
    const id = taken.has(it.id) ? newId() : it.id;
    changed ||= id !== it.id;
    taken.add(id);
    if (!rename.has(it.id)) rename.set(it.id, id);
    return id;
  }));
  if (!changed) return layers;
  const fix = (s: Source): Source => (s.k === 'item' ? { ...s, id: rename.get(s.id) ?? s.id } : s.k === 'snap' ? { ...s, ids: s.ids.map((id) => rename.get(id) ?? id) } : s);
  return layers.map((l, li) => ({
    ...l,
    items: l.items.map((it, ii) => {
      const id = ids[li][ii];
      if (it.kind === 'pixmap' || !it.link) return { ...it, id };
      return { ...it, id, link: { ...it.link, sources: it.link.sources.map(fix) } } as Item;
    }),
  }));
}
