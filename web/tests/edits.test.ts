import { describe, expect, it } from 'vitest';
import * as edits from '../src/edits';
import type { Item, Layer } from '../src/model';

const point = (id: string): Item => ({ kind: 'point', id, color: '#000000', width: 3, p: { x: 0, y: 0 }, weight: 0 });
const layer = (id: string, items: Item[] = []): Layer => ({ id, name: id, visible: true, opacity: 100, items });

describe('edits', () => {
  const layers = [layer('a', [point('1'), point('2')]), layer('b'), layer('c')];

  it('leave the original layers untouched', () => {
    const before = JSON.stringify(layers);
    edits.replaceItems(layers, 'a', ['1'], [point('3')]);
    edits.moveLayer(layers, 'a', 2);
    edits.patchLayer(layers, 'b', { visible: false });
    expect(JSON.stringify(layers)).toBe(before);
  });

  it('replace items: removed ones go, new ones on top', () => {
    const out = edits.replaceItems(layers, 'a', ['1'], [point('3')]);
    expect(out[0].items.map((i) => i.id)).toEqual(['2', '3']);
    expect(out[1]).toBe(layers[1]); // other layers are shared, not copied
  });

  it('move a layer, null when it does not move', () => {
    expect(edits.moveLayer(layers, 'a', 2)!.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(edits.moveLayer(layers, 'c', 0)!.map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(edits.moveLayer(layers, 'b', 1)).toBeNull();
  });

  it('insert a layer above another one, or at the top', () => {
    expect(edits.insertLayer(layers, layer('n'), 'a').map((l) => l.id)).toEqual(['a', 'n', 'b', 'c']);
    expect(edits.insertLayer(layers, layer('n'), null).map((l) => l.id)).toEqual(['a', 'b', 'c', 'n']);
  });

  it('unique layer names', () => {
    expect(edits.uniqueLayerName(layers, 'd')).toBe('d');
    expect(edits.uniqueLayerName([...layers, layer('a_2')], 'a')).toBe('a_3');
  });
});
