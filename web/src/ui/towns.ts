/**
 * The dialog placing towns by their name: a list typed or pasted, one town
 * per line with an optional weight, checked against the communes of France
 * before the points are placed.
 */

import type { LatLon } from '../geo';
import { matchTowns, parseTownList, type Town, type TownMatch } from '../places';
import { openDialog } from './dialogs';
import { fmt, h } from './dom';

export interface PlacedTown {
  name: string;
  ll: LatLon;
  weight: number;
}

const townLabel = (t: Town) => `${t.name} — ${t.dept}${t.population ? ` (${fmt(t.population, 0)} hab.)` : ''}`;

/** `inMap` says whether a position falls on the map. Resolves with the towns to place, or null. */
export async function townsDialog(inMap: (ll: LatLon) => boolean): Promise<PlacedTown[] | null> {
  const text = h('textarea', { rows: 8, placeholder: 'Clisson ; 3\nSaint-Pierre (44) 2\nLes Pieux' });
  const searchBtn = h('button', { type: 'button', class: 'small' }, 'Chercher les communes');
  const progress = h('span', { class: 'hint' });
  const table = h('table', { class: 'towns' });
  type Row = { match: TownMatch; use: HTMLInputElement; pick: HTMLSelectElement | null; weight: HTMLInputElement; tr: HTMLTableRowElement };
  let rows: Row[] = [];

  const stale = (msg: string) => text.setCustomValidity(msg);
  stale('Cliquez d\'abord « Chercher les communes ».');
  text.addEventListener('input', () => {
    rows = [];
    table.replaceChildren();
    stale('La liste a changé : cliquez « Chercher les communes ».');
  });

  let round = 0;
  const search = async () => {
    const reqs = parseTownList(text.value);
    if (!reqs.length) return;
    const mine = ++round;
    searchBtn.disabled = true;
    progress.textContent = `Recherche… 0 / ${reqs.length}`;
    try {
      const matches = await matchTowns(reqs, (n) => {
        if (mine === round) progress.textContent = `Recherche… ${n} / ${reqs.length}`;
      });
      if (mine !== round) return;
      rows = matches.map((m) => row(m));
      table.replaceChildren(
        h('tr', {}, h('th', {}, ''), h('th', {}, 'Saisi'), h('th', {}, 'Commune'), h('th', {}, 'Poids')),
        ...rows.map((r) => r.tr),
      );
      const found = rows.filter((r) => r.use.checked).length;
      progress.textContent = `${found} commune(s) à placer sur ${reqs.length}.`;
      stale('');
    } catch (e) {
      if (mine === round) progress.textContent = (e as Error).message;
    } finally {
      if (mine === round) searchBtn.disabled = false;
    }
  };
  searchBtn.addEventListener('click', () => void search());

  function row(match: TownMatch): Row {
    // Those on the map first, then the most populated.
    const c = match.candidates.slice().sort((a, b) => Number(inMap(b)) - Number(inMap(a)) || (b.population ?? 0) - (a.population ?? 0));
    match = { ...match, candidates: c };
    const use = h('input', { type: 'checkbox' });
    const weight = h('input', { type: 'number', step: 1, min: -999, max: 999, value: String(match.request.weight) });
    const note = h('div', { class: 'hint' });
    let pick: HTMLSelectElement | null = null;
    const cell = h('td');
    const check = () => {
      const t = pick ? c[pick.selectedIndex] : undefined;
      const notes: string[] = [];
      if (!match.exact && t) notes.push('nom approché : vérifiez');
      if (match.exact && c.length > 1) notes.push(`${c.length} communes de ce nom`);
      if (t && !inMap(t)) notes.push('hors de la carte');
      note.textContent = notes.join(' · ');
      return t;
    };
    if (c.length) {
      pick = h('select', {}, ...c.map((t) => h('option', {}, townLabel(t))));
      pick.addEventListener('change', () => {
        const t = check();
        use.checked = !!t && inMap(t);
      });
      cell.append(pick);
    } else cell.append(h('span', { class: 'hint' }, 'introuvable'));
    cell.append(note);
    const t = check();
    use.checked = !!t && match.exact && inMap(t);
    use.disabled = !t;
    const tr = h('tr', {}, h('td', {}, use), h('td', {}, match.request.name + (match.request.dept ? ` (${match.request.dept})` : '')), cell, h('td', {}, weight));
    return { match, use, pick, weight, tr };
  }

  const body = h('div', { class: 'towns-dlg' },
    h('p', { class: 'hint' }, 'Une ville par ligne. Ajoutez si besoin son département entre parenthèses, et un poids en fin de ligne : « Clisson ; 3 », « Saint-Pierre (44) 2 ».'),
    text,
    h('div', { class: 'row' }, searchBtn, progress),
    table,
    h('p', { class: 'hint' }, 'Les villes sont placées à la position de leur mairie (geo.api.gouv.fr), reportée sur la carte par le calage GPS : à quelques centaines de mètres près du rond imprimé.'),
  );
  const ok = await openDialog('Placer des villes par leur nom', body, [
    { label: 'Annuler', value: false },
    { label: 'Placer les villes cochées', value: true, primary: true },
  ], { wide: true, onOpen: () => text.focus() });
  if (!ok) return null;
  return rows.flatMap((r) => {
    const t = r.pick ? r.match.candidates[r.pick.selectedIndex] : undefined;
    if (!r.use.checked || !t) return [];
    return [{ name: t.name, ll: t, weight: Math.round(parseFloat(r.weight.value) || 0) }];
  });
}
