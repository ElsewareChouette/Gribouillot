/**
 * The side panel, in 3 tabs: the layers, the selected object (inspector.ts)
 * and the map (background, scale, GPS calibration).
 */

import type { App } from '../app';
import { knownAnchors } from '../calibrations';
import { SUBLAYERS } from '../enigmas';
import { unitPerPx, type Group, type Layer } from '../model';
import { CALIBRATE_DEF, GEOREF_DEF } from '../tools';
import { confirmDialog, promptText } from './dialogs';
import { $, fmt, h } from './dom';
import { icon } from './icons';
import { inspector } from './inspector';

type Tab = 'layers' | 'object' | 'map';
const TABS: [Tab, string][] = [['layers', 'Calques'], ['object', 'Objet'], ['map', 'Carte']];
const tabLabel = (app: App, t: Tab, label: string) => (t === 'layers' && app.groups().length ? 'Énigmes' : label);

let tab: Tab = 'layers';
/** The tab to go back to when the selection is emptied. */
let before: Tab = 'layers';
let lastSelection = 0;
let tabsEl: HTMLElement;
let body: HTMLElement;

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
  if (t !== 'object') before = t;
  refreshPanel(app, true);
}

export function refreshPanel(app: App, force = false): void {
  const p = app.project;
  // Selecting an object shows it; emptying the selection goes back.
  const n = app.selection.size;
  if (n && !lastSelection && tab !== 'object') {
    before = tab;
    tab = 'object';
  } else if (!n && lastSelection && tab === 'object') tab = before;
  lastSelection = n;

  tabsEl.replaceChildren(...TABS.map(([id, label]) => h('button', {
    type: 'button', role: 'tab', class: `tab${tab === id ? ' on' : ''}`, 'aria-selected': String(tab === id),
    onclick: () => showTab(app, id),
  }, tabLabel(app, id, label), id === 'object' && n ? h('span', { class: 'badge' }, String(n)) : null)));

  const active = document.activeElement;
  // Don't rebuild while the user is typing in a field of the panel, or moving a slider.
  if (!force && active && body.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) return;
  body.replaceChildren();
  if (!p) return;
  if (tab === 'layers') body.append(layersTab(app));
  else if (tab === 'object') body.append(inspector(app));
  else body.append(mapTab(app));
}

/* =============================================================== layers */

/** Set right after a reorder drag, so that it does not count as a click. */
let justDragged = false;

/** A row of the layer list; the current layer shows its opacity, rename and delete. */
function layerRow(app: App, l: Layer, drag?: (row: HTMLElement, e: PointerEvent) => void, groups?: Group[]): HTMLElement {
  const current = l.id === app.currentLayerId;
  const eye = h('button', { type: 'button', class: 'icon-btn', title: l.visible ? 'Masquer le calque' : 'Afficher le calque', onclick: (e: Event) => { e.stopPropagation(); app.toggleLayerVisibility(l.id); } },
    h('img', { src: icon(l.visible ? 'visibility-on.png' : 'visibility-off.png'), alt: '' }));
  const name = h('span', { class: 'name', title: 'Double-clic pour renommer' }, l.name);
  const count = h('span', { class: 'count', title: `${l.items.length} élément(s)` }, String(l.items.length));
  const grip = drag ? h('span', { class: 'grip', title: 'Glisser vers le haut ou le bas pour réordonner' }, '⋮⋮') : null;
  const row = h('li', {
    class: current ? 'current' : '',
    onclick: () => {
      if (!justDragged) app.setCurrentLayer(l.id);
    },
    ondblclick: () => void app.renameLayer(l.id),
  }, grip, eye, name, count);
  if (drag) for (const handle of [grip!, name]) handle.addEventListener('pointerdown', (e) => drag(row, e));
  if (!l.visible) row.classList.add('hidden-layer');
  if (current) {
    const op = h('input', { type: 'range', min: 0, max: 100, value: String(l.opacity), title: 'Opacité du calque' });
    const opv = h('span', { class: 'opv' }, `${l.opacity} %`);
    op.addEventListener('input', () => {
      opv.textContent = `${op.value} %`;
      app.setLayerOpacity(l.id, parseInt(op.value, 10));
    });
    op.addEventListener('change', () => {
      // End of the move: let the panel refresh again.
      op.blur();
      app.onChange();
    });
    op.addEventListener('click', (e) => e.stopPropagation());
    const del = h('button', { type: 'button', class: 'icon-btn', title: 'Supprimer le calque', onclick: (e: Event) => { e.stopPropagation(); void app.deleteLayer(l.id); } },
      h('img', { src: icon('delete-layer.png'), alt: '' }));
    const ren = h('button', { type: 'button', class: 'icon-btn pencil', title: 'Renommer le calque', onclick: (e: Event) => { e.stopPropagation(); void app.renameLayer(l.id); } }, '✎');
    const extra = h('div', { class: 'layer-extra' }, h('span', {}, 'Opacité'), op, opv, ren, del);
    if (groups?.length) {
      // Move the layer into an énigme, or out of them.
      const into = h('select', { title: 'Énigme de ce calque', onclick: (e: Event) => e.stopPropagation() },
        h('option', { value: '' }, 'hors énigme'),
        ...groups.map((g) => h('option', { value: g.id, selected: g.layerIds.includes(l.id) }, `${g.code} ${g.title}`)));
      into.addEventListener('change', () => app.setLayerGroup(l.id, into.value || null));
      extra.append(into);
    }
    row.append(extra);
  }
  return row;
}

function layerActions(app: App): HTMLElement {
  const addBtn = h('button', { type: 'button', class: 'add-layer', onclick: () => app.addLayer() }, h('img', { src: icon('add-layer.png'), alt: '' }), 'Nouveau calque');
  return h('div', { class: 'layer-actions' }, addBtn,
    h('button', { type: 'button', class: 'small', title: 'Importer un fichier de calque (.xml) de Gribouillot', onclick: () => void app.pickLayerFiles() }, 'Importer un calque…'),
    h('button', { type: 'button', class: 'small', title: 'Ajouter une image dans le calque courant', onclick: () => void app.addPicture() }, 'Image…'));
}

function layersTab(app: App): HTMLElement {
  const p = app.project!;
  const groups = app.groups();
  if (groups.length) return enigmasTab(app, groups);
  const list = h('ul', { class: 'layers' });
  const layers = p.layers;
  // Top of the list = drawn last (on top), like layer panels of drawing software.
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    list.append(layerRow(app, l, (row, e) => reorderDrag(app, list, row, layers.length, l.id, e)));
  }
  return h('div', {},
    list,
    layerActions(app),
    h('p', { class: 'hint' }, 'On dessine dans le calque surligné. Les objets des autres calques servent de référence mais ne sont pas modifiables.'),
    h('div', { class: 'enigma-offer' },
      h('p', {}, 'Travailler énigme par énigme, dans l\'ordre du jeu (530 → 520) : un groupe de calques par énigme, avec son texte, vos notes et sa couleur.'),
      h('button', { type: 'button', class: 'small primary-soft', onclick: () => app.createEnigmaGroups() }, 'Organiser par énigmes')));
}

/** Énigmes opened in the panel (the current one is always open). */
const opened = new Set<string>();

function enigmasTab(app: App, groups: Group[]): HTMLElement {
  const p = app.project!;
  const rank = app.currentRank();
  const out = h('div', { class: 'enigmas' });
  groups.forEach((g, i) => {
    const current = i === rank;
    const open = current || opened.has(g.id);
    const layers = p.layers.filter((l) => g.layerIds.includes(l.id)).reverse();
    const items = layers.reduce((n, l) => n + l.items.length, 0);
    const later = app.untilRank !== null && i > app.untilRank;
    const head = h('div', { class: 'enigma-head', onclick: () => app.openGroup(g.id) },
      h('span', { class: 'rank', style: `background:${g.color}` }, String(i + 1)),
      h('b', {}, g.code),
      h('span', { class: 'title', title: g.title }, g.title),
      h('span', { class: 'count', title: `${layers.length} calque(s), ${items} objet(s)` }, items ? String(items) : ''),
      h('button', {
        type: 'button', class: 'icon-btn fold', title: open ? 'Replier' : 'Déplier', 'aria-expanded': String(open),
        onclick: (e: Event) => {
          e.stopPropagation();
          if (opened.has(g.id)) opened.delete(g.id);
          else opened.add(g.id);
          refreshPanel(app, true);
        },
      }, open ? '▾' : '▸'));
    const box = h('section', { class: `enigma${current ? ' current' : ''}${later ? ' later' : ''}`, style: `--g:${g.color}` }, head);
    if (open) {
      const list = h('ul', { class: 'layers' }, ...layers.map((l) => layerRow(app, l, undefined, groups)));
      const sub = h('select', { title: 'Ajouter un calque à cette énigme' },
        h('option', { value: '' }, '+ calque…'), ...SUBLAYERS.map((n) => h('option', { value: n }, n)), h('option', { value: '*' }, 'autre nom…'));
      sub.addEventListener('change', async () => {
        let name = sub.value;
        if (name === '*') name = (await promptText('Nouveau calque', `Calque de l'énigme ${g.code}`, 'hypothèse C')) ?? '';
        if (name) app.addGroupLayer(g.id, name);
        else sub.value = '';
      });
      const text = h('textarea', { rows: 4, placeholder: 'Collez ici le texte de l\'énigme.' }, g.text);
      text.addEventListener('change', () => app.updateGroup(g.id, { text: text.value }));
      const notes = h('textarea', { rows: 3, placeholder: 'Ce que j\'en retiens, mes doutes, les madits…' }, g.notes);
      notes.addEventListener('change', () => app.updateGroup(g.id, { notes: notes.value }));
      const color = h('input', { type: 'color', value: g.color, title: 'Couleur de l\'énigme (celle de ses nouveaux tracés)' });
      color.addEventListener('change', () => app.updateGroup(g.id, { color: color.value }));
      box.append(
        list.children.length ? list : h('p', { class: 'hint' }, 'Aucun calque : cliquez l\'énigme pour en créer un.'),
        h('div', { class: 'enigma-actions' }, sub, color,
          h('button', { type: 'button', class: 'icon-btn', title: 'Plus tôt dans l\'ordre', disabled: i === 0, onclick: () => app.moveGroup(g.id, -1) }, '↑'),
          h('button', { type: 'button', class: 'icon-btn', title: 'Plus tard dans l\'ordre', disabled: i === groups.length - 1, onclick: () => app.moveGroup(g.id, 1) }, '↓'),
          h('span', { class: 'spacer' }),
          h('button', {
            type: 'button', class: 'small danger', title: 'Retirer ce groupe (ses calques restent, hors énigme)',
            onclick: async () => {
              if (await confirmDialog('Retirer l\'énigme', `Retirer le groupe ${g.code} ? Ses ${layers.length} calque(s) restent, hors énigme.`, 'Retirer')) app.deleteGroup(g.id);
            },
          }, 'Retirer')),
        h('details', { class: 'enigma-text', open: !!g.text && current }, h('summary', {}, 'Texte de l\'énigme'), text),
        h('details', { class: 'enigma-text', open: !!g.notes && current }, h('summary', {}, 'Ce que j\'en retiens'), notes),
      );
    }
    out.append(box);
  });
  const others = p.layers.filter((l) => !groups.some((g) => g.layerIds.includes(l.id))).reverse();
  out.append(h('section', { class: 'enigma others' },
    h('div', { class: 'enigma-head static' }, h('b', {}, 'Hors énigme'), h('span', { class: 'title' }, 'cartes, repères, essais : visibles à toutes les étapes')),
    others.length ? h('ul', { class: 'layers' }, ...others.map((l) => layerRow(app, l, undefined, groups))) : null,
    layerActions(app)));
  out.append(h('p', { class: 'hint' }, 'Une énigme s\'appuie sur les précédentes, jamais sur les suivantes : leurs objets ne s\'accrochent pas quand on dessine. On dessine dans le calque surligné, de la couleur de son énigme.'));
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
