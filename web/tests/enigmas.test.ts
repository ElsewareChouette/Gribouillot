import { describe, expect, it } from 'vitest';
import { cleanGroups, ENIGMAS, enigmaGroups, rankOf, shownAt, usableFrom } from '../src/enigmas';
import { exportProjectZip, importProject } from '../src/io';
import { emptyLayer, emptyProject } from '../src/model';

describe('énigmes', () => {
  const groups = enigmaGroups();
  const [g530, , g470] = groups;
  g530.layerIds = ['bourges'];
  g470.layerIds = ['roncevaux'];
  const layer = (id: string) => ({ ...emptyLayer(id), id });

  it('in the order of the game', () => {
    expect(ENIGMAS.map((e) => e.code)).toEqual(['530', '780', '470', '580', '600', '500', '420', '560', '650', '520']);
    expect(rankOf(groups, 'roncevaux')).toBe(2);
    expect(rankOf(groups, 'carte')).toBe(-1);
  });

  it('an énigme builds on the previous ones, never on a later one', () => {
    expect(usableFrom(groups, 'bourges', 2)).toBe(true); // 470 uses 530
    expect(usableFrom(groups, 'roncevaux', 0)).toBe(false); // 530 may not use 470
    expect(usableFrom(groups, 'carte', 0)).toBe(true); // out of the énigmes: always
    expect(usableFrom(groups, 'roncevaux', -1)).toBe(true); // drawing out of the énigmes: anything
  });

  it('the state at an énigme shows what came before', () => {
    expect(shownAt(groups, layer('roncevaux'), 0)).toBe(false);
    expect(shownAt(groups, layer('roncevaux'), 2)).toBe(true);
    expect(shownAt(groups, layer('carte'), 0)).toBe(true);
    expect(shownAt(groups, layer('roncevaux'), null)).toBe(true);
  });

  it('deleted layers leave their group', () => {
    expect(cleanGroups(groups, [layer('bourges')])[2].layerIds).toEqual([]);
  });

  it('the groups survive an export and an import, by the names of their layers', async () => {
    const p = emptyProject('Chouette');
    p.layers = [{ ...emptyLayer('530 points'), id: 'a' }, { ...emptyLayer('essais'), id: 'b' }];
    p.groups = enigmaGroups();
    p.groups[0] = { ...p.groups[0], layerIds: ['a'], notes: 'Bourges, centre de la France' };
    const zip = await exportProjectZip(p, async () => null);
    const back = (await importProject([{ path: 'c.zip', blob: zip }]))!.project;
    const g = back.groups![0];
    expect(g.code).toBe('530');
    expect(g.notes).toBe('Bourges, centre de la France');
    expect(back.layers.find((l) => l.id === g.layerIds[0])!.name).toBe('530 points');
    expect(back.groups!.slice(1).every((x) => !x.layerIds.length)).toBe(true);
  });
});
