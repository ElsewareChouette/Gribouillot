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
