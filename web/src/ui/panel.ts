/**
 * The side panel, in 2 tabs: the layers with the selected object below them
 * (inspector.ts), and the map (background, scale, GPS calibration).
 */

import type { App } from '../app';
import { knownAnchors } from '../calibrations';
import { groupOf, layerName, SUBLAYERS } from '../enigmas';
import { unitPerPx, type Group, type Layer } from '../model';
import { CALIBRATE_DEF, GEOREF_DEF } from '../tools';
import { colorPopup, confirmDialog, popupMenu, promptText } from './dialogs';
import { $, fmt, h } from './dom';
import { icon } from './icons';
import { inspector } from './inspector';

type Tab = 'layers' | 'map';
let tab: Tab = 'layers';
let tabsEl: HTMLElement;
let body: HTMLElement;
/** The selection the panel showed last, to bring a newly selected object into view. */
let shownSelection = '';

const WIDTH_KEY = 'gribouillot.panelWidth';
const MIN_WIDTH = 300, MAX_WIDTH = 720;

export function buildPanel(app: App): void {
  tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  body = h('div', { class: 'panel-body' });
  const panel = $('#panel');
  // Its width: dragged by its left edge, remembered.
  const setWidth = (w: number) => panel.style.setProperty('--panel-w', `${Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)))}px`);
  try {
    const saved = parseFloat(localStorage.getItem(WIDTH_KEY) ?? '');
    if (saved) setWidth(saved);
  } catch {
    /* private mode */
  }
  const grip = h('div', { class: 'panel-resize', title: 'Glisser pour élargir ou rétrécir le panneau (double-clic : largeur par défaut)', role: 'separator', 'aria-orientation': 'vertical' });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const right = panel.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => setWidth(right - ev.clientX);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(WIDTH_KEY, String(panel.getBoundingClientRect().width));
      } catch {
        /* private mode */
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    panel.style.removeProperty('--panel-w');
    try {
      localStorage.removeItem(WIDTH_KEY);
    } catch {
      /* private mode */
    }
  });
  panel.append(grip, tabsEl, body);
  void app;
}

export function showTab(app: App, t: Tab): void {
  tab = t;
  refreshPanel(app, true);
}

/** What the map still lacks: without its scale the measures are in pixels, without its calibration no GPS. */
function missingOnMap(app: App): string[] {
  const p = app.project!;
  return [p.mapFile ? null : 'carte', unitPerPx(p.scale) ? null : 'échelle', app.georef() ? null : 'calage GPS'].filter((x): x is string => !!x);
}

/**
 * The panel, in 2 tabs: the layers of the énigme with the selected object
 * below them, and the map (scale, units, GPS calibration).
 */
export function refreshPanel(app: App, force = false): void {
  const p = app.project;
  // Selecting an object shows it, under the layers.
  const selection = [...app.selection].join(' ');
  const fresh = !!selection && selection !== shownSelection;
  shownSelection = selection;
  if (fresh && tab === 'map' && app.toolId !== 'georef' && app.toolId !== 'calibrate') tab = 'layers';
  const missing = p ? missingOnMap(app) : [];
  const tabs: [Tab, string, Node | null][] = [
    ['layers', p && app.groups().length ? 'Énigmes' : 'Calques', null],
    ['map', 'Carte', missing.length ? h('span', { class: 'todo', title: `À renseigner : ${missing.join(', ')}` }, '!') : null],
  ];
  tabsEl.replaceChildren(...tabs.map(([id, label, mark]) => h('button', {
    type: 'button', role: 'tab', class: `tab${tab === id ? ' on' : ''}`, 'aria-selected': String(tab === id),
    onclick: () => showTab(app, id),
  }, label, mark)));

  const active = document.activeElement;
  // Don't rebuild while the user is typing in a field of the panel, or moving a slider
  // (a list or a color picker, once chosen, may be rebuilt: what it changed must show).
  const typing = active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && ['text', 'search', 'number', 'range'].includes(active.type));
  if (!force && typing && body.contains(active)) return;
  const scroll = body.scrollTop;
  body.replaceChildren();
  if (!p) return;
  if (tab === 'map') {
    body.append(mapTab(app));
    body.scrollTop = scroll;
    return;
  }
  const object = objectSection(app);
  body.append(layersTab(app), object);
  body.scrollTop = scroll;
  // A newly selected object is brought into view, if it is below what shows.
  if (fresh && object.offsetTop - body.offsetTop > scroll + body.clientHeight - 120) object.scrollIntoView({ block: 'start' });
}

function objectSection(app: App): HTMLElement {
  const n = app.selection.size;
  return h('section', { class: 'object' },
    h('div', { class: 'layer-head' }, h('h3', {}, 'Objet'), n > 1 ? h('span', { class: 'badge' }, String(n)) : null),
    n ? inspector(app) : h('p', { class: 'hint' }, 'Cliquez un objet de la carte (outil Sélection, J) pour voir ici sa construction, ses mesures et sa position GPS. Ctrl+K retrouve un objet par son nom.'));
}

/* =============================================================== layers */

/** Set right after a reorder drag, so that it does not count as a click. */
let justDragged = false;

/** The « ⋯ » button of a row or of a heading: what is seldom needed is behind it. */
function moreButton(title: string, open: (btn: HTMLElement) => unknown): HTMLButtonElement {
  const btn: HTMLButtonElement = h('button', {
    type: 'button', class: 'icon-btn more', title, 'aria-label': title, 'aria-haspopup': 'menu',
    onclick: (e: Event) => {
      e.stopPropagation();
      void open(btn);
    },
  }, '⋯');
  btn.addEventListener('dblclick', (e) => e.stopPropagation());
  return btn;
}

/** A menu under a « ⋯ » button, each entry with what it does. */
async function moreMenu(btn: HTMLElement, entries: ([string, () => unknown] | null)[]): Promise<void> {
  const list = entries.filter((e): e is [string, () => unknown] => !!e);
  const r = btn.getBoundingClientRect();
  const chosen = await popupMenu(r.right - 220, r.bottom + 2, list.map(([label], value) => ({ label, value })));
  if (chosen !== null) void list[chosen][1]();
}

/** What is done to a layer now and then: its opacity, its name, its énigme, its removal. */
function layerPopover(app: App, l: Layer, btn: HTMLElement, groups: Group[]): void {
  const r = btn.getBoundingClientRect();
  const pop = h('div', { class: 'popup-menu layer-pop', role: 'menu' });
  const close = () => {
    pop.remove();
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', esc, true);
  };
  const outside = (e: Event) => {
    if (!pop.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  const entry = (label: string, run: () => unknown, cls = '') => h('button', {
    type: 'button', role: 'menuitem', class: cls,
    onclick: () => {
      close();
      void run();
    },
  }, label);
  const op = h('input', { type: 'range', min: 0, max: 100, value: String(l.opacity), 'aria-label': 'Opacité du calque' });
  const opv = h('span', { class: 'opv' }, `${l.opacity} %`);
  op.addEventListener('input', () => {
    opv.textContent = `${op.value} %`;
    app.setLayerOpacity(l.id, parseInt(op.value, 10));
  });
  pop.append(
    h('label', { class: 'pop-opacity' }, h('span', {}, 'Opacité'), op, opv),
    entry('Renommer…', () => app.renameLayer(l.id)));
  if (groups.length) {
    pop.append(entry('Changer d\'énigme…', async () => {
      const inside = groupOf(groups, l.id);
      const chosen = await popupMenu(r.right - 220, r.bottom + 2, [
        ...groups.map((g) => ({ label: `${g.id === inside?.id ? '✓ ' : '   '}${g.code}  ${g.title}`, value: g.id })),
        { label: `${inside ? '   ' : '✓ '}Hors énigme`, value: '' },
      ]);
      // null: the menu was closed without a choice.
      if (chosen !== null && chosen !== (inside?.id ?? '')) app.setLayerGroup(l.id, chosen || null);
    }));
  }
  pop.append(entry('Supprimer', () => app.deleteLayer(l.id), 'danger'));
  document.body.append(pop);
  const size = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.right - size.width, window.innerWidth - size.width - 4))}px`;
  pop.style.top = `${Math.max(4, Math.min(r.bottom + 2, window.innerHeight - size.height - 4))}px`;
  setTimeout(() => {
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', esc, true);
  });
}

/**
 * A row of the layer list: its eye, its name, and behind « ⋯ » the rest
 * (opacity, rename, énigme, delete). A click makes it the current layer.
 */
function layerRow(app: App, l: Layer, groups: Group[], drag?: (row: HTMLElement, e: PointerEvent) => void): HTMLElement {
  const current = l.id === app.currentLayerId;
  const eye = h('button', { type: 'button', class: 'icon-btn', title: l.visible ? 'Masquer le calque' : 'Afficher le calque', onclick: (e: Event) => { e.stopPropagation(); app.toggleLayerVisibility(l.id); } },
    h('img', { src: icon(l.visible ? 'visibility-on.png' : 'visibility-off.png'), alt: '' }));
  const name = h('span', { class: 'name' }, l.name);
  const facts = [l.opacity < 100 ? `${l.opacity} %` : '', l.items.length ? String(l.items.length) : ''].filter(Boolean).join(' · ');
  const count = h('span', { class: 'count', title: `${l.items.length} élément(s), opacité ${l.opacity} %` }, facts);
  const more = moreButton(`Calque « ${l.name} » : opacité, renommer, supprimer…`, (btn) => layerPopover(app, l, btn, groups));
  const row = h('li', {
    class: current ? 'current' : '',
    title: current ? 'Le calque où l\'on dessine' : 'Cliquer pour dessiner dans ce calque',
    onclick: () => {
      if (!justDragged) app.setCurrentLayer(l.id);
    },
    ondblclick: () => void app.renameLayer(l.id),
  }, eye, name, count, more);
  if (drag) {
    row.classList.add('draggable');
    name.addEventListener('pointerdown', (e) => drag(row, e));
  }
  if (!l.visible) row.classList.add('hidden-layer');
  return row;
}

const addButton = (title: string, onclick: () => unknown) => h('button', { type: 'button', class: 'add-layer', title, onclick: () => void onclick() }, '+ Calque');

/** What the layers have in common, behind the « ⋯ » of their heading. */
const importEntries = (app: App): [string, () => unknown][] => [
  ['Importer un calque (.xml)…', () => app.pickLayerFiles()],
  ['Ajouter une image dans le calque courant…', () => app.addPicture()],
];

function layersTab(app: App): HTMLElement {
  const p = app.project!;
  const groups = app.groups();
  if (groups.length) return enigmasTab(app, groups);
  const list = h('ul', { class: 'layers' });
  const layers = p.layers;
  // Top of the list = drawn last (on top), like layer panels of drawing software.
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    list.append(layerRow(app, l, groups, (row, e) => reorderDrag(app, list, row, layers.length, l.id, e)));
  }
  return h('div', {},
    h('section', {},
      h('div', { class: 'layer-head' },
        h('h3', { title: 'On dessine dans le calque surligné ; les objets des autres servent de référence. Glisser un calque pour changer l\'ordre.' }, 'Calques'),
        moreButton('Importer, organiser par énigmes…', (btn) => moreMenu(btn, [
          ...importEntries(app),
          ['Organiser par énigmes (530 → 520)', () => app.createEnigmaGroups()],
        ]))),
      list,
      addButton('Nouveau calque, au-dessus du calque courant', () => app.addLayer())));
}

function enigmasTab(app: App, groups: Group[]): HTMLElement {
  const p = app.project!;
  const rank = app.currentRank();
  const g = groups[rank];
  const out = h('div', { class: 'enigmas' });
  if (g) {
    // Only the énigme being worked on: the others are one click away, in the strip above the map.
    const layers = p.layers.filter((l) => g.layerIds.includes(l.id)).reverse();
    const add = async () => {
      // The first usual name not taken yet in this énigme.
      const taken = new Set(layers.map((l) => l.name));
      const suggestion = SUBLAYERS.find((n) => !taken.has(layerName(g, n))) ?? `calque ${layers.length + 1}`;
      const name = await promptText('Nouveau calque', `Nom du calque (il commencera par « ${g.code} »)`, suggestion, 'Par exemple : points, constructions, annotations, hypothèse A, hypothèse B…');
      if (name) app.addGroupLayer(g.id, name.replace(new RegExp(`^${g.code}\\s*`), '') || suggestion);
    };
    out.append(h('section', { class: 'enigma current', style: `--g:${g.color}` },
      h('div', { class: 'layer-head' },
        h('button', {
          type: 'button', class: 'code', title: 'Couleur de l\'énigme (celle de ses nouveaux tracés) : cliquer pour la changer',
          onclick: async (e: Event) => {
            const c = await colorPopup(e.currentTarget as HTMLElement, g.color);
            if (c && c !== g.color) app.updateGroup(g.id, { color: c });
          },
        }, g.code),
        h('span', { class: 'title', title: `Énigme ${rank + 1} sur ${groups.length}. Elle s'appuie sur les précédentes, jamais sur les suivantes : leurs objets ne s'accrochent pas quand on dessine.` }, g.title),
        moreButton(`Énigme ${g.code} : ordre, retirer…`, (btn) => moreMenu(btn, [
          rank > 0 ? ['Plus tôt dans l\'ordre du jeu', () => app.moveGroup(g.id, -1)] : null,
          rank < groups.length - 1 ? ['Plus tard dans l\'ordre du jeu', () => app.moveGroup(g.id, 1)] : null,
          ['Retirer cette énigme (ses calques restent)…', async () => {
            if (await confirmDialog('Retirer l\'énigme', `Retirer le groupe ${g.code} ? Ses ${layers.length} calque(s) restent, hors énigme.`, 'Retirer')) app.deleteGroup(g.id);
          }],
        ]))),
      h('ul', { class: 'layers' }, ...layers.map((l) => layerRow(app, l, groups))),
      addButton(`Ajouter un calque à l'énigme ${g.code} (points, hypothèse A…)`, add)));
  } else {
    out.append(h('section', { class: 'enigma' },
      h('p', { class: 'hint' }, 'Le calque courant est hors énigme. Pour travailler une énigme, cliquez-la dans le bandeau au-dessus de la carte.')));
  }
  const others = p.layers.filter((l) => !groups.some((x) => x.layerIds.includes(l.id))).reverse();
  out.append(h('section', { class: 'others' },
    h('div', { class: 'layer-head' },
      h('h3', { title: 'Cartes, repères, essais : visibles à toutes les étapes' }, 'Hors énigme'),
      moreButton('Importer un calque, une image…', (btn) => moreMenu(btn, importEntries(app)))),
    others.length ? h('ul', { class: 'layers' }, ...others.map((l) => layerRow(app, l, groups))) : null,
    addButton('Nouveau calque hors énigme (visible à toutes les étapes)', () => app.addLayer())));
  return out;
}

/**
 * Reorder the layers by dragging a row: the row only moves vertically, within
 * the list, and the other rows make room for it.
 */
function reorderDrag(app: App, list: HTMLElement, row: HTMLElement, count: number, id: string, e: PointerEvent): void {
  if (e.button !== 0 || count < 2) return;
  const handle = e.currentTarget as HTMLElement;
  const rows = Array.from(list.children) as HTMLElement[];
  const from = rows.indexOf(row);
  const rects = rows.map((r) => r.getBoundingClientRect());
  const listRect = list.getBoundingClientRect();
  const own = rects[from];
  const step = own.height + 2; // row height + gap
  const startY = e.clientY;
  let target = from;
  let moved = false;
  handle.setPointerCapture(e.pointerId);

  const move = (ev: PointerEvent) => {
    const dy = Math.max(listRect.top - own.top, Math.min(listRect.bottom - own.bottom, ev.clientY - startY));
    if (!moved && Math.abs(dy) < 4) return;
    if (!moved) {
      moved = true;
      row.classList.add('dragging');
      rows.forEach((r) => r !== row && r.classList.add('shifting'));
    }
    row.style.transform = `translateY(${dy}px)`;
    // Leading edge of the dragged row: a row is passed once this edge crosses its middle.
    const edge = dy > 0 ? own.bottom + dy : own.top + dy;
    target = rects.filter((r, k) => k !== from && r.top + r.height / 2 < edge).length;
    rows.forEach((r, k) => {
      if (r === row) return;
      const shift = from < target && k > from && k <= target ? -step : from > target && k >= target && k < from ? step : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    rows.forEach((r) => {
      r.style.transform = '';
      r.classList.remove('dragging', 'shifting');
    });
    if (!moved) return;
    justDragged = true;
    setTimeout(() => (justDragged = false));
    // The list shows the top layer first: display position -> index in the layers array.
    if (target !== from) app.moveLayer(id, count - 1 - target);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

/* ================================================================== map */

function section(title: string, ...content: (Node | null)[]): HTMLElement {
  return h('section', {}, h('h3', {}, title), ...content);
}

function iconButton(img: string, title: string, onclick: () => unknown): HTMLButtonElement {
  return h('button', { type: 'button', class: 'tool', title, 'aria-label': title, onclick: () => void onclick() }, h('img', { src: icon(img), alt: '' }));
}

function mapTab(app: App): HTMLElement {
  const p = app.project!;
  const s = p.scale;
  const px = h('input', { type: 'number', min: 0, step: 'any', value: s.px ? String(s.px) : '', placeholder: 'px' });
  const val = h('input', { type: 'number', min: 0, step: 'any', value: s.value ? String(s.value) : '', placeholder: 'distance' });
  const unit = h('select', {}, h('option', { value: 'km', selected: s.unit === 'km' }, 'km'), h('option', { value: 'm', selected: s.unit === 'm' }, 'm'));
  px.addEventListener('change', () => app.setScale({ px: parseFloat(px.value) || 0 }));
  val.addEventListener('change', () => app.setScale({ value: parseFloat(val.value) || 0 }));
  unit.addEventListener('change', () => app.setScale({ unit: unit.value as 'km' | 'm' }));
  const k = unitPerPx(s);
  const metersPerPx = k ? (s.unit === 'km' ? k * 1000 : k) : 0;
  const ruler = iconButton(CALIBRATE_DEF.icon, 'Mesurer l\'échelle sur la carte : cliquez les 2 extrémités d\'une distance connue', () => app.setTool('calibrate'));
  ruler.classList.toggle('active', app.toolId === 'calibrate');
  const gray = iconButton('black-white.png', 'Carte en noir et blanc', () => app.toggleGray());
  gray.classList.toggle('active', app.options.gray);
  return h('div', {},
    section('Fond de carte',
      h('div', { class: 'map-row' },
        h('button', { type: 'button', class: 'link', title: p.mapFile ? `Fichier : ${p.mapFile} — cliquer pour renommer` : '', onclick: () => void app.renameMap() }, p.mapName || p.mapFile || 'Aucune carte'),
        h('span', { class: 'spacer' }),
        gray,
        h('button', { type: 'button', class: 'small', onclick: () => void app.session.changeMap() }, p.mapFile ? 'Changer…' : 'Choisir…'))),
    section('Échelle',
      h('div', { class: 'scale-row', title: 'Échelle : une distance mesurée sur la carte (en pixels) et sa valeur réelle' },
        ruler, px, h('span', {}, 'px ='), val, unit),
      h('p', { class: 'hint' }, metersPerPx ? `1 px = ${fmt(metersPerPx, metersPerPx < 10 ? 2 : 1)} m sur la carte` : 'Échelle non définie : les mesures sont en pixels.')),
    unitsSection(app),
    gpsSection(app),
  );
}

function unitsSection(app: App): HTMLElement {
  const u = app.units();
  const num = (v: number, min: number, onchange: (v: number) => void, width = '6em') => {
    const el = h('input', { type: 'number', min, step: 'any', value: String(v) });
    el.style.width = width;
    el.addEventListener('change', () => {
      const x = parseFloat(el.value.replace(',', '.'));
      if (x > min) onchange(x);
    });
    return el;
  };
  const north = h('select', { title: 'Le nord de « vers le sud », « nord-est »…' },
    h('option', { value: 'sheet', selected: u.north === 'sheet' }, 'le haut de la feuille'),
    h('option', { value: 'meridian', selected: u.north === 'meridian' }, 'le méridien local (GPS)'));
  north.addEventListener('change', () => app.setUnits({ north: north.value as 'sheet' | 'meridian' }));
  const m = app.mPerPx();
  const g = app.georef();
  // The scale measured by the calibration, across the middle of the map.
  let measured: string | null = null;
  const map = app.mapPicture();
  if (g && m && map) {
    const c = { x: map.w / 2, y: map.h / 2 };
    // km on the ground for 1000 px = m for 1 px
    const k = (app.terrainKm(c, { x: c.x + 1000, y: c.y })! + app.terrainKm(c, { x: c.x, y: c.y + 1000 })!) / 2;
    measured = `Mesurée par le calage, au centre : 1 px = ${fmt(k, 1)} m sur le terrain (${k >= m ? '+' : '−'}${fmt(Math.abs(k / m - 1) * 100, 1)} % par rapport à l'échelle de la carte).`;
  }
  return section('Unités et précision',
    h('div', { class: 'units-grid' },
      h('span', {}, 'Carte au'), h('span', {}, '1 : ', num(u.paper, 0, (v) => app.setUnits({ paper: v }), '8em')),
      h('span', {}, '1 mesure ='), h('span', {}, num(u.measure, 0, (v) => app.setUnits({ measure: v })), ' m'),
      h('span', {}, 'Précision de lecture'), h('span', {}, '± ', num(u.precisionMm, 0, (v) => app.setUnits({ precisionMm: v })), ' mm'),
      h('span', {}, 'Le nord, c\'est'), north),
    h('p', { class: 'hint' }, m ? `1 px = ${fmt(m, 1)} m = ${fmt((m / u.paper) * 1000, 3)} mm de carte. Précision de lecture : ${app.precisionText()}.` : 'Définissez l\'échelle pour lire les longueurs en km et en mm de carte.'),
    measured ? h('p', { class: 'hint' }, measured) : null,
    h('p', { class: 'hint' }, 'Dans les longueurs saisies : m, km, mesures sur le terrain ; mm, cm sur la carte ; et les formules (86164/46241860 × 300000 km).'));
}

function gpsSection(app: App): HTMLElement {
  const p = app.project!;
  const anchors = p.anchors ?? [];
  const g = app.georef();
  const calibrating = app.toolId === 'georef';
  const pin = iconButton(GEOREF_DEF.icon, 'Caler la carte : cliquez des villes de la carte et donnez leur nom', () => app.setTool(calibrating ? 'select' : 'georef'));
  pin.classList.toggle('active', calibrating);
  const summary = app.georefSummary().replace(/^Calage GPS : /, '').replace(/ — transformation .*$/, '');
  const content: (Node | null)[] = [h('div', { class: 'map-row' }, pin, h('span', { class: 'gps-summary' }, summary))];
  const known = app.knownCalibration();
  if (known) {
    content.push(h('button', {
      type: 'button', class: 'small towns-btn', title: `Remplacer les repères par le calage par défaut de cette carte (${known.anchors.length} villes)`,
      onclick: async () => {
        if (anchors.length && !(await confirmDialog('Calage par défaut', `Remplacer vos ${anchors.length} repère(s) par le calage par défaut de la carte ${known.name} (${known.anchors.length} villes) ?`, 'Remplacer'))) return;
        app.setAnchors(knownAnchors(known));
      },
    }, `Calage par défaut de cette carte (${known.anchors.length} villes)`));
  }
  if (!anchors.length) {
    content.push(h('p', { class: 'hint' }, 'Placez au moins 3 villes bien réparties (mieux : 6 à 10, jusqu\'aux bords de la carte) pour connaître la position GPS de n\'importe quel point. La précision obtenue est affichée.'));
  } else {
    content.push(h('button', { type: 'button', class: 'small towns-btn', onclick: () => app.setTool(calibrating ? 'select' : 'georef') }, calibrating ? 'Terminer le calage' : 'Modifier les repères'));
  }
  if (calibrating && anchors.length) {
    const list = h('ul', { class: 'anchors' });
    anchors.forEach((a, i) => {
      const c = g?.checks[i];
      list.append(h('li', {},
        h('button', { type: 'button', class: 'link', title: 'Centrer la vue sur ce repère', onclick: () => { app.cam.centerOn(a.p); app.viewChanged(); } }, a.name),
        h('span', { class: c && g?.max === c.km && anchors.length > 3 ? 'err worst' : 'err' }, c ? `${fmt(c.km, 1)} km` : ''),
        h('button', { type: 'button', class: 'icon-btn', title: 'Retirer ce repère', onclick: () => app.setAnchors(anchors.filter((x) => x !== a)) }, '✕')));
    });
    content.push(list, h('p', { class: 'hint' }, 'En rouge sur la carte : où les autres repères placent chacun d\'eux. Un écart nettement plus grand que les autres trahit un repère mal placé.'));
  }
  return section('Calage GPS', ...content);
}
