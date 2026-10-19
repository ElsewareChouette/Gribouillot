/**
 * What is around a point or along a line: the historical monuments (base
 * Mérimée), filtered by nature, and the named places of the IGN map.
 */

import { formatLatLon, type LatLon } from '../geo';
import { googleUrl, kindCounts, loadMonuments, nearLine, nearPoint, popUrl, searchQuery, type Found, type Monument } from '../monuments';
import { geoportailUrl, PLACES_MAX_KM, placesNear, type Place } from '../places';
import { openDialog } from './dialogs';
import { fmt, h } from './dom';

export type Around =
  | { kind: 'point'; ll: LatLon; what: string }
  | { kind: 'line'; pts: LatLon[]; what: string };

export interface NearbyActions {
  /** Add named points at these positions (one undo step). */
  place: (spots: { ll: LatLon; name: string }[]) => void;
}

const RADII = [0.25, 0.5, 1, 2, 5, 10, 20];
const SHOWN = 200;
/** The game was published in 1993: what was protected by then is told apart. */
const GAME_YEAR = 1993;

const km = (v: number) => `${fmt(v, v < 10 ? 2 : 1)} km`;
const link = (label: string, url: string, title?: string) => h('a', { href: url, target: '_blank', rel: 'noopener', title }, label);

/**
 * Toggle buttons, one per nature with its count: only the natures turned on
 * are shown (all of them when none is). The counts ignore that choice.
 */
function fillChips(box: HTMLElement, counts: [string, number][], on: Set<string>, changed: () => void): void {
  for (const k of [...on]) if (!counts.some(([c]) => c === k)) on.delete(k);
  box.replaceChildren(...counts.slice(0, 40).map(([k, n]) => h('button', {
    type: 'button', class: `chip${on.has(k) ? ' on' : ''}`, title: on.has(k) ? 'Retirer ce filtre' : 'Ne garder que cette nature (plusieurs possibles)',
    onclick: () => {
      if (on.has(k)) on.delete(k);
      else on.add(k);
      changed();
    },
  }, `${k} (${n})`)));
  if (on.size) box.append(h('button', { type: 'button', class: 'chip clear', onclick: () => { on.clear(); changed(); } }, 'toutes les natures'));
}

export async function nearbyDialog(target: Around, defaultKm: number, actions: NearbyActions): Promise<void> {
  let radius = RADII.find((r) => r >= defaultKm) ?? RADII[RADII.length - 1];
  const radiusSel = h('select', {}, ...RADII.map((r) => h('option', { value: String(r), selected: r === radius }, km(r))));
  const before = h('input', { type: 'checkbox' });
  const text = h('input', { type: 'search', placeholder: 'Filtrer : nom, commune, nature…' });
  const chips = h('div', { class: 'chips' });
  const count = h('p', { class: 'hint' }, 'Chargement de la base des monuments…');
  const list = h('ul', { class: 'nearby-list' });
  const placeShown = h('button', { type: 'button', class: 'small', disabled: true }, 'Placer les monuments affichés');
  const kinds = new Set<string>();
  let all: Monument[] = [];
  let found: (Found & { along?: number })[] = [];
  let shown: (Found & { along?: number })[] = [];

  const search = () => {
    found = target.kind === 'point' ? nearPoint(all, target.ll, radius) : nearLine(all, target.pts, radius);
    render();
  };

  const render = () => {
    const q = text.value.trim().toLowerCase();
    const base = found.filter((f) => (!before.checked || (f.m.year > 0 && f.m.year <= GAME_YEAR))
      && (!q || `${f.m.title} ${f.m.town} ${f.m.kinds.join(' ')}`.toLowerCase().includes(q)));
    fillChips(chips, kindCounts(base), kinds, render);
    shown = kinds.size ? base.filter((f) => f.m.kinds.some((k) => kinds.has(k))) : base;
    const where = target.kind === 'point' ? `à moins de ${km(radius)}` : `à moins de ${km(radius)} de part et d'autre`;
    count.textContent = `${shown.length} monument(s) historique(s) ${where}${shown.length > SHOWN ? ` — les ${SHOWN} premiers affichés` : ''}.`;
    list.replaceChildren(...shown.slice(0, SHOWN).map(item));
    placeShown.disabled = !shown.length;
    placeShown.textContent = `Placer ${Math.min(shown.length, SHOWN)} monument(s) sur la carte`;
  };

  const item = (f: Found & { along?: number }) => {
    const m = f.m;
    const prot = [m.status === 'C' ? 'classé' : m.status === 'I' ? 'inscrit' : 'protégé', m.year ? `en ${m.year}` : ''].join(' ').trim();
    // Along a line: how far along it (from where it enters the map), and how far from it.
    const dist = f.along === undefined ? km(f.km) : `${km(f.along)} le long · ${km(f.km)} de la droite`;
    return h('li', {},
      h('div', { class: 'nearby-head' }, h('b', {}, m.title), h('span', { class: 'dist' }, dist)),
      h('div', { class: 'hint' }, `${m.kinds.join(', ') || 'monument'} — ${m.town} (${m.dept}) — ${prot}`),
      h('div', { class: 'nearby-links' },
        link('Fiche', popUrl(m.ref), 'La notice du ministère de la Culture (POP)'),
        link('Google', googleUrl(searchQuery(m)), `Chercher « ${searchQuery(m)} »`),
        link('Géoportail', geoportailUrl(m), 'Voir l\'endroit sur la carte de l\'IGN'),
        h('button', { type: 'button', class: 'link', onclick: () => actions.place([{ ll: m, name: m.title }]) }, 'Placer')));
  };

  radiusSel.addEventListener('change', () => {
    radius = parseFloat(radiusSel.value);
    search();
    // The places found are those of the old radius: search again on demand.
    places = null;
    if (placesBox) placesBox.replaceChildren(placesButton());
  });
  before.addEventListener('change', render);
  text.addEventListener('input', render);
  placeShown.addEventListener('click', () => actions.place(shown.slice(0, SHOWN).map((f) => ({ ll: f.m, name: f.m.title }))));
  // Enter in the filter field filters; it does not close the dialog.
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  // The named places of the IGN, around a point only (one search per 500 m).
  let placesBox: HTMLElement | null = null;
  let places: Place[] | null = null;
  const categories = new Set<string>();
  const placeChips = h('div', { class: 'chips' });
  const placeCount = h('p', { class: 'hint' });
  const placeList = h('ul', { class: 'nearby-list' });
  const placesKm = () => Math.min(radius, PLACES_MAX_KM);
  const placesButton = () => h('button', { type: 'button', class: 'small', onclick: () => void searchPlaces() },
    `Chercher les lieux-dits et sites à moins de ${km(placesKm())} (IGN)`);
  const renderPlaces = () => {
    if (!places) return;
    const q = text.value.trim().toLowerCase();
    const base = places.filter((p) => !q || `${p.name} ${p.town} ${p.category}`.toLowerCase().includes(q));
    const counts = new Map<string, number>();
    for (const p of base) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    fillChips(placeChips, [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')), categories, renderPlaces);
    const shownPlaces = categories.size ? base.filter((p) => categories.has(p.category)) : base;
    placeCount.textContent = `${shownPlaces.length} lieu(x) nommé(s) à moins de ${km(placesKm())}, d'après l'IGN.`;
    placeList.replaceChildren(...shownPlaces.map((p) => h('li', {},
      h('div', { class: 'nearby-head' }, h('b', {}, p.name), h('span', { class: 'dist' }, km(p.km))),
      h('div', { class: 'hint' }, `${p.category}${p.town ? ` — ${p.town}` : ''}`),
      h('div', { class: 'nearby-links' },
        link('Google', googleUrl(`${p.name} ${p.town}`)),
        link('Géoportail', geoportailUrl(p)),
        h('button', { type: 'button', class: 'link', onclick: () => actions.place([{ ll: p, name: p.name }]) }, 'Placer')))));
  };
  const searchPlaces = async () => {
    if (target.kind !== 'point' || !placesBox) return;
    const box = placesBox;
    box.replaceChildren(h('p', { class: 'hint' }, 'Recherche…'));
    try {
      places = await placesNear(target.ll, radius, (d, n) => {
        box.replaceChildren(h('p', { class: 'hint' }, `Recherche… ${d} / ${n}`));
      });
      box.replaceChildren(placeChips, placeCount, placeList);
      renderPlaces();
    } catch (e) {
      box.replaceChildren(h('p', { class: 'hint' }, (e as Error).message), placesButton());
    }
  };
  if (target.kind === 'point') placesBox = h('div', {}, placesButton());
  text.addEventListener('input', renderPlaces);

  const where = target.kind === 'point' ? `${target.what} — ${formatLatLon(target.ll)}` : target.what;
  const body = h('div', { class: 'nearby' },
    h('p', { class: 'hint' }, where),
    h('div', { class: 'row' }, h('label', { class: 'check' }, target.kind === 'point' ? 'Rayon' : 'De part et d\'autre', radiusSel),
      h('label', { class: 'check' }, before, `protégés en ${GAME_YEAR} ou avant`), text),
    h('h3', {}, 'Monuments historiques'),
    chips,
    count,
    list,
    h('div', { class: 'row' }, placeShown),
    placesBox ? h('h3', {}, 'Lieux-dits et sites') : null,
    placesBox,
    h('p', { class: 'hint' }, 'Monuments : base Mérimée du ministère de la Culture. Positions à quelques centaines de mètres près, comme le calage de la carte : élargissez le rayon plutôt que de le resserrer.'),
  );
  const loaded = loadMonuments().then((ms) => {
    all = ms;
    search();
  }, (e: Error) => {
    count.textContent = e.message;
  });
  await openDialog(target.kind === 'point' ? 'Autour de ce point' : 'Le long de cette droite', body, [{ label: 'Fermer', value: true, primary: true }], { wide: true });
  await loaded;
}
