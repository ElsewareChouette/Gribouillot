/**
 * The dialog naming a place of the map: a commune found by its name, or
 * coordinates typed or pasted.
 */

import { decimalLatLon, formatLatLon, parseLatLon, type LatLon } from '../geo';
import { searchTowns, type Town } from '../places';
import { openDialog } from './dialogs';
import { fmt, h } from './dom';

export type PlaceAnswer = { name: string; ll: LatLon } | 'delete' | null;

export async function placeDialog(title: string, initial?: { name: string; ll: LatLon }): Promise<PlaceAnswer> {
  const search = h('input', { type: 'search', placeholder: 'Nom d\'une commune', autocomplete: 'off' });
  const results = h('ul', { class: 'place-results' });
  const name = h('input', { type: 'text', value: initial?.name ?? '', required: true });
  const coords = h('input', { type: 'text', value: initial ? decimalLatLon(initial.ll) : '', required: true, placeholder: '45.12345, 1.23456' });
  const read = h('p', { class: 'hint' });

  const showRead = () => {
    const ll = parseLatLon(coords.value);
    coords.setCustomValidity(ll || !coords.value ? '' : 'Coordonnées illisibles.');
    read.textContent = ll ? `Lu : ${formatLatLon(ll)}` : 'Degrés décimaux (45.123, 1.234) ou degrés, minutes, secondes (45°07\'24"N 1°14\'02"E).';
  };
  coords.addEventListener('input', showRead);
  showRead();

  const choose = (t: Town) => {
    name.value = t.name;
    coords.value = decimalLatLon(t);
    showRead();
    results.replaceChildren();
  };
  let round = 0;
  const run = async () => {
    const q = search.value.trim();
    if (!q) return;
    const mine = ++round;
    results.replaceChildren(h('li', { class: 'hint' }, 'Recherche…'));
    try {
      const towns = await searchTowns(q);
      if (mine !== round) return;
      results.replaceChildren(...(towns.length
        ? towns.map((t) => h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => choose(t) },
          h('b', {}, t.name), ` — ${t.dept}`, t.population ? ` (${fmt(t.population, 0)} hab.)` : '')))
        : [h('li', { class: 'hint' }, 'Aucune commune de ce nom.')]));
      if (towns.length === 1) choose(towns[0]);
    } catch (e) {
      if (mine === round) results.replaceChildren(h('li', { class: 'hint' }, (e as Error).message));
    }
  };
  // Enter in the search field searches instead of closing the dialog.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  });

  const body = h('div', { class: 'place-dlg' },
    h('label', {}, 'Chercher une commune',
      h('span', { class: 'row' }, search, h('button', { type: 'button', class: 'small', onclick: () => void run() }, 'Chercher'))),
    results,
    h('p', { class: 'hint' }, 'Position de la mairie, d\'après geo.api.gouv.fr (communes actuelles : une commune fusionnée depuis 1993 se trouve sous son nouveau nom, sinon saisissez ses coordonnées).'),
    h('label', {}, 'Nom du lieu', name),
    h('label', {}, 'Latitude, longitude', coords),
    read,
  );
  const buttons: { label: string; value: 'ok' | 'cancel' | 'delete'; primary?: boolean; danger?: boolean }[] = [{ label: 'Annuler', value: 'cancel' }];
  if (initial) buttons.push({ label: 'Retirer ce repère', value: 'delete', danger: true });
  buttons.push({ label: 'OK', value: 'ok', primary: true });
  const r = await openDialog(title, body, buttons, { wide: true, onOpen: () => (initial ? coords : search).focus() });
  if (r === 'delete') return 'delete';
  const ll = parseLatLon(coords.value);
  if (r !== 'ok' || !ll) return null;
  return { name: name.value.trim(), ll };
}
