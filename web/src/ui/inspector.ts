/**
 * The « Objet » tab: everything about the selected object — its name, how it
 * was built and what is built on it, its measures, its GPS position, its
 * style — and what can be done with it.
 */

import type { App } from '../app';
import { errorPolygon, isLineLike, isZone, zoneCrossings } from '../analysis';
import { describeSelection } from '../describe';
import { precisionMeters } from '../units';
import { decimalLatLon, dmsLatLon, formatLatLon, meridianAngle } from '../geo';
import { dist, mid, type Pt } from '../geom';
import { ITEM_LABELS, isStroke, type Item } from '../model';
import { googleUrl } from '../monuments';
import { builtOn, nameOf, recipeText, usedBy } from '../names';
import { geoportailUrl, osmUrl, townAt } from '../places';
import { arcLength } from '../shapes';
import { fmt, h } from './dom';

/** Commune names of the selected positions, looked up once each. */
const townNames = new Map<string, string>();

const WIDTHS = [1, 2, 3, 5, 7, 9, 12];

function box(title: string, ...content: (Node | string | null)[]): HTMLElement {
  return h('div', { class: 'insp-box' }, h('h4', {}, title), ...content);
}

function row(label: string, value: Node | string): HTMLElement {
  return h('div', { class: 'insp-row' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));
}

const link = (label: string, url: string, title?: string) => h('a', { href: url, target: '_blank', rel: 'noopener', title }, label);

/** A clickable name: selects that object and shows it. */
function chip(app: App, it: Item): HTMLElement {
  return h('button', {
    type: 'button', class: 'chip', title: `Sélectionner ${nameOf(it)}`,
    onclick: () => {
      app.setSelection([it.id]);
      app.showItem(it.id);
    },
  }, nameOf(it));
}

export function inspector(app: App): HTMLElement {
  const sel = app.selectedItems();
  if (!sel.length) {
    return h('div', { class: 'insp-empty' },
      h('p', {}, 'Aucun objet sélectionné.'),
      h('p', { class: 'hint' }, 'Avec l\'outil Sélection (J), cliquez un objet de la carte pour voir ici sa construction, ses mesures et sa position GPS. Ctrl+clic pour en sélectionner plusieurs ; Ctrl+K pour retrouver un objet par son nom.'));
  }
  if (sel.length > 1) return many(app, sel.map((s) => s.item));
  return one(app, sel[0].item, sel[0].layer.id === app.currentLayerId, sel[0].layer.name);
}

function many(app: App, items: Item[]): HTMLElement {
  const editable = items.filter((i) => app.inCurrentLayer(i.id)).length;
  return h('div', { class: 'inspector' },
    h('div', { class: 'insp-head' }, h('b', {}, `${items.length} objets sélectionnés`)),
    h('div', { class: 'chips' }, ...items.slice(0, 40).map((i) => chip(app, i))),
    box('Mesure', h('p', {}, describeSelection(items, (px) => app.sheetText(px), (p) => app.gps(p), (a, b) => app.distanceText(a, b)))),
    errorBox(app, items),
    zonesBox(app, items),
    box('Actions',
      h('div', { class: 'insp-actions' },
        h('button', { type: 'button', class: 'small', title: 'Un point sur chaque intersection (I)', onclick: () => app.addIntersections() }, 'Points d\'intersection'),
        editable ? h('button', { type: 'button', class: 'small', onclick: () => void app.chooseStyle() }, 'Couleur et épaisseur…') : null,
        editable ? h('button', { type: 'button', class: 'small danger', onclick: () => app.deleteSelection() }, `Supprimer (${editable})`) : null),
      editable < items.length ? h('p', { class: 'hint' }, `${items.length - editable} objet(s) d'autres calques : en lecture seule.`) : null),
  );
}

function one(app: App, it: Item, editable: boolean, layerName: string): HTMLElement {
  const find = (id: string) => app.findItem(id)?.item;
  const out = h('div', { class: 'inspector' });

  /* Name */
  if (isStroke(it)) {
    const name = h('input', { type: 'text', value: it.label ?? '', placeholder: 'sans nom', disabled: !editable, 'aria-label': 'Nom' });
    name.addEventListener('change', () => app.updateItem(it.id, { label: name.value.trim() || undefined }, 'renommer'));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
    out.append(h('div', { class: 'insp-head' }, h('span', { class: 'kind' }, ITEM_LABELS[it.kind]), name));
    if (it.place) out.append(h('p', { class: 'insp-place' }, h('span', { class: 'k' }, 'Lieu '), h('b', {}, it.place), h('span', { class: 'hint' }, it.label ? '' : ' — non écrit sur la carte : donnez-lui un nom ci-dessus pour l\'y écrire')));
  } else out.append(h('div', { class: 'insp-head' }, h('b', {}, `Image ${it.file}`)));
  if (!editable) {
    out.append(h('p', { class: 'hint readonly' }, `Calque « ${layerName} » : en lecture seule. `,
      h('button', { type: 'button', class: 'link', onclick: () => { const hit = app.findItem(it.id); if (hit) app.setCurrentLayer(hit.layer.id); } }, 'En faire le calque courant')));
  }

  /* Construction */
  if (isStroke(it)) {
    const recipe = it.link ? recipeText(it.link, find, (px) => app.formatLength(px)) : null;
    const on = builtOn(it, find);
    const by = usedBy(app.project!.layers, it.id);
    out.append(box('Construction',
      h('p', {}, recipe ?? (it.link ? 'Construit' : 'Tracé libre : il ne dépend d\'aucun autre objet.')),
      on.length ? h('div', { class: 'insp-deps' }, h('span', { class: 'k' }, 'Dépend de'), ...on.map((x) => chip(app, x))) : null,
      by.length ? h('div', { class: 'insp-deps' }, h('span', { class: 'k' }, 'Utilisé par'), ...by.map((x) => chip(app, x))) : null,
      on.length ? h('details', { class: 'insp-chain' }, h('summary', {}, 'Toute la chaîne de construction'), chain(app, it)) : null,
      it.link && editable ? h('button', {
        type: 'button', class: 'small', title: 'Ne plus suivre les objets dont il dépend : il reste où il est',
        onclick: () => app.updateItem(it.id, { link: undefined }, 'détacher'),
      }, 'Détacher') : null,
      it.kind === 'point' && !it.link && editable ? h('p', { class: 'hint' }, 'Glissez ce point avec l\'outil Sélection : ce qui est construit dessus suit.') : null,
    ));
  }

  /* Measures */
  const len = (px: number) => app.sheetText(px);
  const g = app.georef();
  /** Azimuth of a direction (dx, dy of the sheet), clockwise from the north. */
  const azimuth = (dx: number, dy: number, at: { x: number; y: number }, both: boolean) => {
    const sheet = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const two = (a: number) => (both ? `${fmt(a % 180, 1)}° / ${fmt((a % 180) + 180, 1)}°` : `${fmt(a, 1)}°`);
    const rows = [row('Azimut (haut de la feuille)', two(sheet))];
    if (g) rows.push(row('Azimut (nord géographique)', two((sheet - meridianAngle(g, at) + 360) % 360)));
    return rows;
  };
  const measures: HTMLElement[] = [];
  switch (it.kind) {
    case 'point': {
      measures.push(row('Position', `${fmt(it.p.x, 1)} ; ${fmt(it.p.y, 1)} px`));
      // A crossing is less precise when the lines meet at a small angle.
      const cross = it.link?.recipe === '@point' && it.link.sources[0]?.k === 'snap' && it.link.sources[0].kind === 'intersection' ? it.link.sources[0] : null;
      const angle = cross ? crossingAngle(cross.ids.map((id, i) => find(id) ?? cross.frozen[i]), it.p) : null;
      if (angle !== null && angle < 89) measures.push(row('Précision', `${app.precisionText(1 / Math.sin((angle * Math.PI) / 180))} — droites à ${fmt(angle, 1)}°`));
      else measures.push(row('Précision', app.precisionText()));
      break;
    }
    case 'segment':
      measures.push(h('div', { class: 'insp-dist' }, app.distanceText(it.p1, it.p2).replace(' · ', '\n')), ...azimuth(it.p2.x - it.p1.x, it.p2.y - it.p1.y, it.p1, false));
      break;
    case 'line':
      measures.push(...azimuth(it.p2.x - it.p1.x, it.p2.y - it.p1.y, mid(it.p1, it.p2), true));
      break;
    case 'circle':
      measures.push(row('Rayon', len(it.r)), row('Circonférence', app.formatLength(2 * Math.PI * it.r)));
      break;
    case 'arc':
      measures.push(row('Rayon', len(it.r)), row('Angle', `${fmt(Math.abs(it.span), 2)}°`), row('Longueur', app.formatLength(arcLength(it))));
      break;
    case 'ellipse':
      measures.push(row('Somme des distances', len(it.dSum)), row('Distance des foyers', len(dist(it.f1, it.f2))));
      break;
    case 'pixmap':
      measures.push(row('Échelle', fmt(it.scale, 3)), row('Rotation', `${fmt(((it.rotation % 360) + 360) % 360, 1)}°`));
      break;
  }
  if (measures.length) out.append(box('Mesures', ...measures));

  /* GPS */
  const at = it.kind === 'point' ? it.p : it.kind === 'circle' || it.kind === 'arc' ? it.c : null;
  if (g && at) {
    const ll = g.toLatLon(at);
    const key = decimalLatLon(ll, 4);
    const town = h('span', {}, townNames.get(key) ?? '…');
    if (!townNames.has(key)) {
      townNames.set(key, '…');
      townAt(ll).then((t) => {
        townNames.set(key, t ? `${t.name} (${t.dept})` : 'hors de France');
        town.textContent = townNames.get(key)!;
      }, () => {
        townNames.delete(key);
        town.textContent = '(commune inconnue : pas de connexion)';
      });
    }
    out.append(box(it.kind === 'point' ? 'Position GPS' : 'Position GPS du centre',
      h('p', {}, h('b', {}, formatLatLon(ll))),
      h('p', { class: 'hint' }, `${dmsLatLon(ll)} · à ± ${fmt(Math.max(g.rms ?? 0.5, 0.1), 1)} km`),
      row('Commune', town),
      h('div', { class: 'insp-actions' },
        h('button', { type: 'button', class: 'small primary-soft', title: 'Monuments historiques, lieux-dits et sites alentour', onclick: () => void app.aroundSelection() }, 'Autour de ce point…'),
        h('button', { type: 'button', class: 'small', title: 'Copier les coordonnées décimales', onclick: () => void navigator.clipboard?.writeText(decimalLatLon(ll)).then(() => app.status(`Copié : ${decimalLatLon(ll)}`)) }, 'Copier')),
      h('div', { class: 'insp-links' }, link('Géoportail', geoportailUrl(ll)), link('OpenStreetMap', osmUrl(ll)), link('Google Maps', googleUrl(decimalLatLon(ll)))),
    ));
  } else if (g && (it.kind === 'segment' || it.kind === 'line')) {
    out.append(box('Alentours', h('button', { type: 'button', class: 'small primary-soft', onclick: () => void app.aroundSelection() }, 'Monuments le long de cette droite…')));
  } else if (!g && at) {
    out.append(box('Position GPS', h('p', { class: 'hint' }, 'Calez la carte (onglet « Carte ») pour connaître la position GPS des points.')));
  }

  /* Note */
  if (isStroke(it)) {
    const note = h('textarea', { rows: 2, placeholder: editable ? 'Une citation de l\'énigme, un madit, un doute…' : '', disabled: !editable }, it.note ?? '');
    note.addEventListener('change', () => app.updateItem(it.id, { note: note.value.trim() || undefined }, 'annotation'));
    if (editable || it.note) out.append(box('Annotation', note));
  }

  /* Style */
  if (isStroke(it) && editable) {
    const color = h('input', { type: 'color', value: it.color, title: 'Couleur' });
    color.addEventListener('change', () => app.restyle([it.id], { color: color.value }));
    const width = h('select', { title: 'Épaisseur' }, ...[...new Set([...WIDTHS, it.width])].sort((a, b) => a - b).map((w) => h('option', { value: String(w), selected: w === it.width }, `${w} px`)));
    width.addEventListener('change', () => app.restyle([it.id], { width: parseInt(width.value, 10) }));
    const styleRow = h('div', { class: 'insp-actions' }, color, it.kind === 'point' ? null : width);
    if (it.kind === 'point') {
      const w = h('input', { type: 'number', step: 1, min: -999, max: 999, value: String(it.weight), title: 'Poids du point (centre de masse)' });
      w.style.width = '5em';
      w.addEventListener('change', () => app.updateItem(it.id, { weight: Math.round(parseFloat(w.value) || 0) }, 'poids'));
      styleRow.append(h('label', { class: 'inline' }, 'Poids', w));
    }
    out.append(box('Style', styleRow));
  }

  /* Actions */
  const actions: (HTMLElement | null)[] = [];
  if (it.kind === 'arc' && editable) actions.push(h('button', { type: 'button', class: 'small', onclick: () => void app.editArcAngle() }, 'Changer l\'angle…'));
  if (editable) actions.push(h('button', { type: 'button', class: 'small danger', onclick: () => app.deleteSelection() }, 'Supprimer'));
  actions.push(h('button', { type: 'button', class: 'small', onclick: () => app.showItem(it.id) }, 'Centrer la vue'));
  out.append(h('div', { class: 'insp-actions bottom' }, ...actions));
  return out;
}

/** The angle (0 to 90°) at which 2 items cross at p: their tangents there. */
function crossingAngle(items: Item[], p: Pt): number | null {
  const dir = (it: Item): Pt | null => {
    if (it.kind === 'segment' || it.kind === 'line') return { x: it.p2.x - it.p1.x, y: it.p2.y - it.p1.y };
    if (it.kind === 'circle' || it.kind === 'arc') return { x: -(p.y - it.c.y), y: p.x - it.c.x }; // tangent: across the radius
    return null;
  };
  const [a, b] = items.map(dir);
  if (!a || !b) return null;
  const cos = Math.abs(a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

/** Where the selected lines meet: the error triangle (or polygon) and its size. */
function errorBox(app: App, items: Item[]): HTMLElement | null {
  const lines = items.filter(isLineLike);
  if (lines.length < 3) return null;
  const poly = errorPolygon(lines);
  if (!poly) return box('Triangle d\'erreur', h('p', {}, 'Ces droites ne se coupent pas (parallèles ?).'));
  const g = app.georef();
  const corners = poly.corners.map((c, i) => {
    const next = poly.corners[(i + 1) % poly.corners.length];
    const names = c.ids.map((id) => app.findItem(id)?.item).map((x) => (x ? nameOf(x) : '?')).join(' × ');
    return row(names, poly.corners.length > 2 ? `→ ${app.distanceText(c.p, next.p).split(' · ')[0].replace('carte ', '')}` : '');
  });
  return box('Triangle d\'erreur',
    h('p', {}, `${lines.length} droites, ${poly.corners.length} croisements : ${app.sheetText(poly.spread)} d'un bout à l'autre.`),
    ...corners,
    g ? h('p', { class: 'hint' }, `Centre : ${formatLatLon(g.toLatLon(poly.center))}`) : null,
    // Smaller than what the map lets read: the lines do meet.
    app.mPerPx() && poly.spread < (3 * precisionMeters(app.units())) / app.mPerPx()
      ? h('p', { class: 'hint' }, 'Au niveau de la précision de la carte : les droites se rencontrent, à la lecture près.') : null,
    h('div', { class: 'insp-actions' }, h('button', { type: 'button', class: 'small primary-soft', onclick: () => app.drawErrorPolygon() }, 'Tracer le triangle et son centre')));
}

/** Whether the selected line crosses the selected circles (the zones it should go through). */
function zonesBox(app: App, items: Item[]): HTMLElement | null {
  const lines = items.filter(isLineLike);
  const zones = items.filter(isZone);
  if (lines.length !== 1 || !zones.length) return null;
  const res = zoneCrossings(lines[0], zones);
  const ok = res.filter((r) => r.crosses).length;
  return box('Traversée des zones',
    h('p', {}, `${nameOf(lines[0])} traverse ${ok} zone(s) sur ${res.length}.`),
    ...res.map((r) => row(`${r.crosses ? '✓' : '✗'} ${nameOf(r.zone)}`,
      r.crosses ? `à ${app.formatLength(r.gap)} du centre (marge ${app.formatLength(r.margin)})` : `la manque de ${app.formatLength(-r.margin)}`)),
    h('p', { class: 'hint' }, 'Les zones sont les cercles et arcs sélectionnés avec la droite (Ctrl+clic).'));
}

/** Everything an item is built on, as a tree (shared parts once). */
function chain(app: App, it: Item, seen = new Set<string>()): HTMLElement | null {
  const find = (id: string) => app.findItem(id)?.item;
  const on = builtOn(it, find).filter((x) => !seen.has(x.id));
  if (!on.length) return null;
  for (const x of on) seen.add(x.id);
  return h('ul', { class: 'chain' }, ...on.map((x) => {
    const recipe = x.kind !== 'pixmap' && x.link ? recipeText(x.link, find, (px) => app.formatLength(px)) : null;
    return h('li', {}, chip(app, x), recipe ? h('span', { class: 'hint' }, ` ${recipe}`) : null, chain(app, x, seen));
  }));
}
