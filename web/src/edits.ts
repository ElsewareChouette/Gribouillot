/**
 * Changes of the layers, as pure functions: each one returns a new `layers`
 * array and leaves the old one untouched, ready to be kept for undo.
 */

import type { Item, Layer } from './model';

/** Change the items of one layer. */
export function editItems(layers: Layer[], layerId: string, f: (items: Item[]) => Item[]): Layer[] {
  return layers.map((l) => (l.id === layerId ? { ...l, items: f(l.items) } : l));
}

/** Remove some items of a layer and add others at the top. */
export function replaceItems(layers: Layer[], layerId: string, removeIds: Iterable<string>, add: Item[]): Layer[] {
  const rm = new Set(removeIds);
  return editItems(layers, layerId, (items) => [...items.filter((i) => !rm.has(i.id)), ...add]);
}

/** Apply f to the given items of a layer. */
export function updateItems(layers: Layer[], layerId: string, ids: Iterable<string>, f: (item: Item) => Item): Layer[] {
  const set = new Set(ids);
  return editItems(layers, layerId, (items) => items.map((i) => (set.has(i.id) ? f(i) : i)));
}

export function patchLayer(layers: Layer[], id: string, patch: Partial<Omit<Layer, 'id' | 'items'>>): Layer[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

/** Insert a layer just above another one (or at the top). */
export function insertLayer(layers: Layer[], layer: Layer, aboveId: string | null): Layer[] {
  const idx = layers.findIndex((l) => l.id === aboveId);
  const out = [...layers];
  out.splice(idx < 0 ? out.length : idx + 1, 0, layer);
  return out;
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id);
}

/** Move a layer to a new position in the stack (0 = bottom); null if it does not move. */
export function moveLayer(layers: Layer[], id: string, toIndex: number): Layer[] | null {
  const from = layers.findIndex((l) => l.id === id);
  if (from < 0 || from === toIndex) return null;
  const out = [...layers];
  const [l] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, toIndex)), 0, l);
  return out;
}

/** A name not used by the other layers: name, name_2, name_3... */
export function uniqueLayerName(layers: Layer[], name: string): string {
  let n = name;
  for (let i = 2; layers.some((l) => l.name === n); i++) n = `${name}_${i}`;
  return n;
}
