import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportProjectZip, importProject } from '../src/io';
import { emptyLayer, emptyProject } from '../src/model';

describe('GPS anchors in the exported project', () => {
  it('go to a side file, and come back', async () => {
    const p = emptyProject('Essai');
    p.layers = [emptyLayer('calque_1')];
    p.anchors = [{ id: 'g1', name: 'Clisson', p: { x: 2572, y: 3437 }, lat: 47.087, lon: -1.282 }];
    const zip = await exportProjectZip(p, async () => null);
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['Essai/Essai.grib', 'Essai/Essai.web.json', 'Essai/calque_1.xml']);
    const back = await importProject([{ path: 'essai.zip', blob: zip }]);
    expect(back!.project.anchors).toMatchObject([{ name: 'Clisson', p: { x: 2572, y: 3437 }, lat: 47.087, lon: -1.282 }]);
  });

  it('no side file without anchors', async () => {
    const zip = await exportProjectZip(emptyProject('Vide'), async () => null);
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())))).toEqual(['Vide/Vide.grib']);
  });
});

describe('links in the layer files', () => {
  it('ids and links survive an export and an import, the desktop attributes stay the same', async () => {
    const { parseLayerXml, writeLayerXml } = await import('../src/legacy');
    const layer = emptyLayer('l');
    layer.items = [
      { kind: 'point', id: 'a', color: '#000000', width: 3, p: { x: 1, y: 2 }, weight: 0 },
      { kind: 'circle', id: 'c', color: '#ff0000', width: 2, c: { x: 1, y: 2 }, r: 5, link: { recipe: 'circleCenter', group: 'k1', seq: 1, out: 0, sources: [{ k: 'item', id: 'a', frozen: { kind: 'point', id: 'a', color: '#000000', width: 3, p: { x: 1, y: 2 }, weight: 0 } }, { k: 'pt', p: { x: 6, y: 2 } }] } },
    ];
    const xml = writeLayerXml(layer);
    expect(xml).toContain('<Circle x="1" y="2" radius="5" color="#ff0000" penWidth="2" wid="c" link="');
    const back = parseLayerXml('l', xml).layer.items;
    expect(back).toEqual(layer.items);
  });
});
