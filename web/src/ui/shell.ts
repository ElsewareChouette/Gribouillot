/**
 * The application shell: menus, toolbar, side panel (map and layers),
 * minimap, scale bar and start screen.
 */

import type { App } from '../app';
import { ZOOM_STEP } from '../camera';
import { fromFileList } from '../io';
import { unitPerPx } from '../model';
import * as store from '../store';
import { knownAnchors } from '../calibrations';
import { decimalLatLon, dmsLatLon, formatLatLon } from '../geo';
import { geoportailUrl, osmUrl, townAt } from '../places';
import { CALIBRATE_DEF, GEOREF_DEF, TOOLS, type ToolDef } from '../tools';
import { alertDialog, confirmDialog, openDialog, popupMenu, styleDialog } from './dialogs';
import { $, fmt, h } from './dom';
import { icon } from './icons';

const VERSION = '3.0.0-alpha.1';

export function buildShell(app: App): void {
  buildMenus(app);
  buildToolbar(app);
  buildSidebar(app);
  buildMinimap(app);
  buildScaleBar(app);
  buildStartScreen(app);
  buildDropZone(app);
  const refresh = () => {
    refreshToolbar(app);
    refreshSidebar(app);
    document.title = app.project ? `${app.project.name} — Gribouillot` : 'Gribouillot';
  };
  app.onChange = refresh;
  app.onProjectOpen = (open) => {
    document.body.classList.toggle('no-project', !open);
    if (!open) void refreshStartScreen(app);
    refresh();
  };
}

/* ================================================================ menus */

type MenuEntry = { label: string; run: () => unknown; key?: string; checked?: boolean; disabled?: boolean } | { group: string };

function menuButton(label: string, entries: () => MenuEntry[]): HTMLElement {
  const btn = h('button', { type: 'button', class: 'menu-btn' }, label);
  btn.addEventListener('click', async () => {
    const r = btn.getBoundingClientRect();
    const list = entries();
    const runs = new Map<number, () => unknown>();
    const items = list.map((e, i) => {
      if ('group' in e) return e;
      runs.set(i, e.run);
      const mark = e.checked === undefined ? '' : e.checked ? '✓ ' : '  ';
      return { label: `${mark}${e.label}${e.key ? ` ${e.key}` : ''}`, value: e.disabled ? -1 : i };
    });
    const chosen = await popupMenu(r.left, r.bottom + 2, items);
    if (chosen !== null && chosen >= 0) runs.get(chosen)?.();
  });
  return btn;
}

function buildMenus(app: App): void {
  const need = () => !app.project;
  $('#menus').append(
    menuButton('Projet', () => [
      { label: 'Nouveau projet (choisir une carte)…', run: () => app.session.newProject() },
      { label: 'Mes projets…', run: () => projectsDialog(app) },
      { group: 'Fichiers Gribouillot' },
      { label: 'Importer un projet (dossier)…', run: () => app.session.pickProjectFolder() },
      { label: 'Importer un projet (.zip ou fichiers)…', run: () => app.session.pickProjectFiles() },
      { label: 'Exporter le projet (.zip)', key: 'Ctrl+S', run: () => app.session.exportZip(), disabled: need() },
      { label: 'Importer un calque (.xml)…', run: () => app.pickLayerFiles(), disabled: need() },
      { label: 'Exporter une image…', run: () => app.session.exportImage(), disabled: need() },
      { group: 'Projet' },
      { label: 'Renommer le projet…', run: () => app.renameProject(), disabled: need() },
      { label: 'Fermer le projet', run: () => app.session.closeProject(), disabled: need() },
    ]),
    menuButton('Édition', () => [
      { label: `Annuler${app.history.undoLabel ? ` (${app.history.undoLabel})` : ''}`, key: 'Ctrl+Z', run: () => app.undo(), disabled: !app.history.undoLabel },
      { label: `Rétablir${app.history.redoLabel ? ` (${app.history.redoLabel})` : ''}`, key: 'Ctrl+Y', run: () => app.redo(), disabled: !app.history.redoLabel },
      { group: 'Sélection' },
      { label: 'Tout sélectionner dans le calque', key: 'Ctrl+A', run: () => app.setSelection(app.currentLayer?.items.map((i) => i.id) ?? []), disabled: need() },
      { label: 'Supprimer', key: 'Suppr', run: () => app.deleteSelection(), disabled: need() },
      { label: 'Couleur…', key: 'C', run: () => app.chooseColor(), disabled: need() },
      { label: 'Épaisseur…', key: 'T', run: () => app.chooseWidth(), disabled: need() },
      { label: 'Poids du point…', key: 'W', run: () => app.editPointWeight(), disabled: need() },
      { label: 'Angle de l\'arc…', key: 'A', run: () => app.editArcAngle(), disabled: need() },
      { group: 'Constructions' },
      { label: 'Importer une image dans le calque…', run: () => app.addPicture(), disabled: need() },
      { label: 'Placer des villes par leur nom…', run: () => app.placeTowns(), disabled: need() },
      { label: 'Points d\'intersection de la sélection', key: 'I', run: () => app.addIntersections(), disabled: need() },
      { label: 'Centre de masse des points pondérés', run: () => app.centerOfMass(), disabled: need() },
    ]),
    menuButton('Affichage', () => [
      { label: 'Ajuster à la fenêtre', key: 'F', run: () => app.zoomToFit(), disabled: need() },
      { label: 'Zoom 100 %', run: () => app.setZoom(1), disabled: need() },
      { label: 'Zoom avant', key: '+', run: () => app.zoom(ZOOM_STEP), disabled: need() },
      { label: 'Zoom arrière', key: '−', run: () => app.zoom(1 / ZOOM_STEP), disabled: need() },
      { group: 'Options' },
      { label: 'Mini-carte', checked: app.options.minimap, run: () => app.toggleOption('minimap') },
      { label: 'Carte en noir et blanc', checked: app.options.gray, run: () => app.toggleGray(), disabled: need() },
      { label: 'Afficher les poids et les demander', checked: app.options.weights, run: () => app.toggleOption('weights') },
      { label: 'Aimanter aux intersections, milieux et centres', checked: app.options.snapFigures, run: () => app.toggleOption('snapFigures') },
      { label: 'Placer le centre des cercles et arcs', checked: app.options.drawCenter, run: () => app.toggleOption('drawCenter') },
      { label: 'Options de la spirale…', key: 'S', run: () => app.spiralOptions() },
      { label: 'Panneau latéral', checked: !document.body.classList.contains('no-sidebar'), run: () => document.body.classList.toggle('no-sidebar') },
    ]),
    menuButton('Aide', () => [
      { label: 'Raccourcis clavier', run: () => shortcutsDialog() },
      { label: 'À propos de Gribouillot', run: () => aboutDialog() },
    ]),
  );
}

/* ============================================================== toolbar */

const toolButtons = new Map<string, HTMLButtonElement>();
let colorBtn: HTMLButtonElement;
let widthBtn: HTMLButtonElement;
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
const toggles: { btn: HTMLButtonElement; on: () => boolean }[] = [];

function iconButton(img: string, title: string, onclick: () => unknown): HTMLButtonElement {
  return h('button', { type: 'button', class: 'tool', title, 'aria-label': title, onclick: () => void onclick() }, h('img', { src: icon(img), alt: '' }));
}

function buildToolbar(app: App): void {
  const bar = $('#toolbar');
  undoBtn = iconButton('edit-undo.png', 'Annuler (Ctrl+Z)', () => app.undo());
  redoBtn = iconButton('edit-redo.png', 'Rétablir (Ctrl+Y)', () => app.redo());
  bar.append(h('div', { class: 'group' }, undoBtn, redoBtn));
  let group: HTMLElement | null = null;
  let last = '';
  const add = (def: ToolDef) => {
    if (def.group !== last) {
      group = h('div', { class: 'group' });
      bar.append(group);
      last = def.group;
    }
    const b = iconButton(def.icon, def.label + (def.key ? ` (${def.key})` : ''), () => app.setTool(def.id));
    toolButtons.set(def.id, b);
    group!.append(b);
  };
  TOOLS.forEach(add);
  const pic = iconButton('image-x-generic.png', 'Importer une image dans le calque', () => app.addPicture());
  group!.append(pic);

  colorBtn = h('button', { type: 'button', class: 'tool color', title: 'Couleur de dessin (C)', onclick: () => void app.chooseColor() }, h('span', { class: 'swatch' }));
  widthBtn = h('button', { type: 'button', class: 'tool', title: 'Épaisseur de dessin : 1, 3, 5, 7 px (clic droit : autre valeur)' }, h('img', { alt: '' }));
  widthBtn.addEventListener('click', () => {
    const p = app.project;
    if (!p) return;
    p.width = p.width >= 7 ? 1 : p.width < 3 ? 3 : p.width < 5 ? 5 : 7;
    app.changed();
  });
  widthBtn.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const p = app.project;
    if (!p) return;
    const r = await styleDialog('Épaisseur de dessin', p.color, p.width, p.customColors, { showColor: false });
    if (r) {
      p.width = r.width;
      app.changed();
    }
  });
  const weights = iconButton('point-weight.png', 'Pondération : afficher et demander le poids des points', () => app.toggleOption('weights'));
  const center = iconButton('circle-drawCenter.png', 'Placer aussi le centre des cercles, ellipses et arcs', () => app.toggleOption('drawCenter'));
  toggles.push({ btn: weights, on: () => app.options.weights }, { btn: center, on: () => app.options.drawCenter });
  bar.append(h('div', { class: 'group' }, colorBtn, widthBtn, weights, center));
}

function refreshToolbar(app: App): void {
  for (const [id, b] of toolButtons) b.classList.toggle('active', app.toolId === id);
  const p = app.project;
  if (p) {
    (colorBtn.firstChild as HTMLElement).style.background = p.color;
    const w = [1, 3, 5, 7].includes(p.width) ? p.width : 0;
    const img = widthBtn.firstChild as HTMLImageElement;
    if (w) {
      img.src = icon(`draw-width-${w}.png`);
      img.style.display = '';
      widthBtn.dataset.label = '';
    } else {
      img.style.display = 'none';
      widthBtn.dataset.label = `${p.width}`;
    }
    widthBtn.title = `Épaisseur de dessin : ${p.width} px (clic : 1/3/5/7, clic droit : autre valeur)`;
  }
  undoBtn.disabled = !app.history.undoLabel;
  redoBtn.disabled = !app.history.redoLabel;
  undoBtn.title = app.history.undoLabel ? `Annuler : ${app.history.undoLabel} (Ctrl+Z)` : 'Annuler (Ctrl+Z)';
  redoBtn.title = app.history.redoLabel ? `Rétablir : ${app.history.redoLabel} (Ctrl+Y)` : 'Rétablir (Ctrl+Y)';
  for (const t of toggles) t.btn.classList.toggle('active', t.on());
}

/* ============================================================== sidebar */

let sidebarBody: HTMLElement;

function buildSidebar(app: App): void {
  sidebarBody = h('div', { class: 'sidebar-body' });
  $('#sidebar').append(sidebarBody);
  void app;
}

function section(title: string, ...content: (Node | null)[]): HTMLElement {
  return h('section', {}, h('h3', {}, title), ...content);
}

function refreshSidebar(app: App): void {
  const p = app.project;
  const active = document.activeElement;
  // Don't rebuild while the user is typing in a field of the panel, or moving a slider.
  if (active && sidebarBody.contains(active) && active.tagName === 'INPUT') return;
  sidebarBody.replaceChildren();
  if (!p) return;

  /* Project */
  const saved = h('span', { class: 'saved' }, app.session.saving ? 'enregistrement…' : 'enregistré dans le navigateur');
  sidebarBody.append(
    h('div', { class: 'project-title' },
      h('button', { type: 'button', class: 'link', title: 'Renommer le projet', onclick: () => void app.renameProject() }, p.name),
      saved),
  );

  /* Map */
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
  sidebarBody.append(section('Carte',
    h('div', { class: 'map-row' },
      h('button', { type: 'button', class: 'link', title: p.mapFile ? `Fichier : ${p.mapFile} — cliquer pour renommer` : '', onclick: () => void app.renameMap() }, p.mapName || p.mapFile || 'Aucune carte'),
      h('span', { class: 'spacer' }),
      gray,
      h('button', { type: 'button', class: 'small', onclick: () => void app.session.changeMap() }, p.mapFile ? 'Changer…' : 'Choisir…')),
    h('div', { class: 'scale-row', title: 'Échelle : une distance mesurée sur la carte (en pixels) et sa valeur réelle' },
      ruler, px, h('span', {}, 'px ='), val, unit),
    h('p', { class: 'hint' }, metersPerPx ? `1 px = ${fmt(metersPerPx, metersPerPx < 10 ? 2 : 1)} m sur la carte` : 'Échelle non définie : les mesures sont en pixels.'),
  ));
  sidebarBody.append(gpsSection(app));

  /* Layers */
  const list = h('ul', { class: 'layers' });
  const layers = p.layers;
  // Top of the list = drawn last (on top), like layer panels of drawing software.
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const current = l.id === app.currentLayerId;
    const eye = h('button', { type: 'button', class: 'icon-btn', title: l.visible ? 'Masquer le calque' : 'Afficher le calque', onclick: (e: Event) => { e.stopPropagation(); app.toggleLayerVisibility(l.id); } },
      h('img', { src: icon(l.visible ? 'visibility-on.png' : 'visibility-off.png'), alt: '' }));
    const name = h('span', { class: 'name', title: 'Double-clic pour renommer' }, l.name);
    const count = h('span', { class: 'count', title: `${l.items.length} élément(s)` }, String(l.items.length));
    const grip = h('span', { class: 'grip', title: 'Glisser vers le haut ou le bas pour réordonner' }, '⋮⋮');
    const row = h('li', {
      class: current ? 'current' : '',
      onclick: () => {
        if (!justDragged) app.setCurrentLayer(l.id);
      },
      ondblclick: () => void app.renameLayer(l.id),
    }, grip, eye, name, count);
    for (const handle of [grip, name]) handle.addEventListener('pointerdown', (e) => reorderDrag(app, list, row, layers.length, l.id, e));
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
      row.append(h('div', { class: 'layer-extra' }, h('span', {}, 'Opacité'), op, opv, ren, del));
    }
    list.append(row);
  }
  const addBtn = h('button', { type: 'button', class: 'add-layer', onclick: () => app.addLayer() }, h('img', { src: icon('add-layer.png'), alt: '' }), 'Nouveau calque');
  const importBtn = h('button', { type: 'button', class: 'small', title: 'Importer un fichier de calque (.xml) de Gribouillot', onclick: () => void app.pickLayerFiles() }, 'Importer…');
  sidebarBody.append(section('Calques', list, h('div', { class: 'layer-actions' }, addBtn, importBtn),
    h('p', { class: 'hint' }, 'On dessine dans le calque surligné. Les éléments des autres calques servent de référence mais ne sont pas modifiables.')));
}

/* ================================================================= GPS */

/** Commune names of the selected points, looked up once per position. */
const townNames = new Map<string, string>();

function gpsSection(app: App): HTMLElement {
  const p = app.project!;
  const anchors = p.anchors ?? [];
  const g = app.georef();
  const pin = iconButton(GEOREF_DEF.icon, 'Caler la carte : cliquez des villes de la carte et donnez leur nom', () => app.setTool(app.toolId === 'georef' ? 'select' : 'georef'));
  pin.classList.toggle('active', app.toolId === 'georef');
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
  if (g) content.push(h('button', { type: 'button', class: 'small towns-btn', title: 'Placer des points sur des villes données par leur nom, avec des poids', onclick: () => void app.placeTowns() }, 'Placer des villes par leur nom…'));
  if (!anchors.length) {
    content.push(h('p', { class: 'hint' }, 'Placez au moins 3 villes bien réparties (mieux : 6 à 10, jusqu\'aux bords de la carte) pour connaître la position GPS de n\'importe quel point. La précision obtenue est affichée.'));
  } else if (app.toolId === 'georef') {
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
  const sel = app.selectedItems();
  const it = sel.length === 1 ? sel[0].item : null;
  const at = it?.kind === 'point' ? it.p : it?.kind === 'circle' || it?.kind === 'arc' ? it.c : null;
  if (g && (it?.kind === 'segment' || it?.kind === 'line')) {
    content.push(h('div', { class: 'gps-point' },
      h('div', {}, h('b', {}, it.kind === 'line' ? 'Droite sélectionnée' : 'Segment sélectionné')),
      h('button', { type: 'button', class: 'small', onclick: () => void app.aroundSelection() }, 'Monuments le long de cette droite…')));
  }
  if (g && at) {
    const ll = g.toLatLon(at);
    const key = decimalLatLon(ll, 4);
    const town = h('span', { class: 'hint' }, townNames.get(key) ?? '');
    if (!townNames.has(key)) {
      townNames.set(key, '');
      townAt(ll).then((t) => {
        townNames.set(key, t ? `${t.name} (${t.dept})` : 'hors de France');
        town.textContent = townNames.get(key)!;
      }, () => townNames.delete(key));
    }
    const copy = h('button', { type: 'button', class: 'small', title: 'Copier les coordonnées décimales', onclick: () => {
      void navigator.clipboard?.writeText(decimalLatLon(ll)).then(() => app.status(`Copié : ${decimalLatLon(ll)}`));
    } }, 'Copier');
    const link = (label: string, url: string) => h('a', { class: 'small-link', href: url, target: '_blank', rel: 'noopener' }, label);
    content.push(h('div', { class: 'gps-point' },
      h('div', {}, h('b', {}, it!.kind === 'point' ? 'Point : ' : 'Centre : '), formatLatLon(ll)),
      h('div', { class: 'hint' }, dmsLatLon(ll)),
      town,
      h('button', { type: 'button', class: 'small', title: 'Monuments historiques, lieux-dits et sites alentour', onclick: () => void app.aroundSelection() }, 'Autour de ce point…'),
      h('div', { class: 'map-row' }, copy,
        link('Géoportail', geoportailUrl(ll)),
        link('OpenStreetMap', osmUrl(ll))),
      h('p', { class: 'hint' }, g.rms !== null ? `À ± ${fmt(Math.max(g.rms, 0.1), 1)} km environ, d'après les repères.` : 'Précision inconnue avec 2 repères.')));
  }
  return section('Position GPS', ...content);
}

/** Set right after a reorder drag, so that it does not count as a click. */
let justDragged = false;

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

/* ============================================================== minimap */

function buildMinimap(app: App): void {
  const mm = $('#minimap') as HTMLCanvasElement;
  const ctx = mm.getContext('2d')!;
  const W = 200;
  const prevHook = app.afterRender;
  const pictureOf = () => (app.project?.mapFile ? app.pictures.get(app.project.mapFile) : undefined);
  const scaleOf = (picW: number) => W / picW;
  app.afterRender = () => {
    prevHook?.();
    const pic = pictureOf();
    const show = !!(app.project && pic && app.options.minimap);
    mm.style.display = show ? 'block' : 'none';
    if (!show || !pic) return;
    const k = scaleOf(pic.w);
    const H = Math.round(pic.h * k);
    const dpr = window.devicePixelRatio || 1;
    if (mm.width !== Math.round(W * dpr) || mm.height !== Math.round(H * dpr)) {
      mm.width = Math.round(W * dpr);
      mm.height = Math.round(H * dpr);
      mm.style.width = `${W}px`;
      mm.style.height = `${H}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mip = pic.pick(k * dpr, app.options.gray && pic.hasGray());
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mip.bitmap, 0, 0, W, H);
    const v = app.cam.visibleRect();
    ctx.strokeStyle = '#e8222a';
    ctx.lineWidth = 2;
    ctx.strokeRect(v.x * k, v.y * k, v.w * k, v.h * k);
  };
  let dragging = false;
  const go = (e: PointerEvent) => {
    const pic = pictureOf();
    if (!pic) return;
    const r = mm.getBoundingClientRect();
    const k = scaleOf(pic.w);
    app.cam.centerOn({ x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k });
    app.requestRender();
  };
  mm.addEventListener('pointerdown', (e) => {
    dragging = true;
    mm.setPointerCapture(e.pointerId);
    go(e);
  });
  mm.addEventListener('pointermove', (e) => dragging && go(e));
  mm.addEventListener('pointerup', () => {
    dragging = false;
    app.changed();
  });
}

/* ============================================================ scale bar */

function buildScaleBar(app: App): void {
  const el = $('#scalebar');
  const bar = h('div', { class: 'bar' });
  const label = h('div', { class: 'label' });
  const zoom = h('button', { type: 'button', class: 'zoom', title: 'Niveau de zoom — cliquer pour ajuster la carte à la fenêtre', onclick: () => app.zoomToFit() });
  el.append(bar, label, zoom);
  const prevHook = app.afterRender;
  app.afterRender = () => {
    prevHook?.();
    const p = app.project;
    el.style.display = p ? '' : 'none';
    if (!p) return;
    zoom.textContent = `${app.cam.zoom >= 1 ? fmt(app.cam.zoom, app.cam.zoom < 10 ? 1 : 0) : fmt(app.cam.zoom * 100, 0) + ' %'}${app.cam.zoom >= 1 ? ' ×' : ''}`;
    const k = unitPerPx(p.scale);
    if (!k) {
      bar.style.display = 'none';
      label.textContent = 'échelle non définie';
      return;
    }
    bar.style.display = '';
    // Nice round length close to 160 screen pixels.
    const perScreenPx = k / app.cam.zoom;
    const target = 160 * perScreenPx;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [5, 2, 1].map((m) => m * pow).find((v) => v <= target) ?? pow;
    let value = nice, unit = p.scale.unit;
    if (unit === 'km' && value < 1) {
      value *= 1000;
      unit = 'm';
    } else if (unit === 'm' && value >= 1000) {
      value /= 1000;
      unit = 'km';
    }
    bar.style.width = `${nice / perScreenPx}px`;
    label.textContent = `${fmt(value, value < 1 ? 2 : 0)} ${unit}`;
  };
}

/* ========================================================= start screen */

function buildStartScreen(app: App): void {
  const el = $('#start');
  el.append(
    h('div', { class: 'start-card' },
      h('h1', {}, h('img', { src: icon('circle-3points.png'), alt: '' }), 'Gribouillot'),
      h('p', { class: 'tagline' }, 'Constructions géométriques sur une carte, par calques. Créé pour la chasse à la Chouette d\'Or.'),
      h('div', { class: 'start-actions' },
        h('button', { type: 'button', class: 'primary big', onclick: () => void app.session.newProject() }, 'Nouveau projet à partir d\'une carte…'),
        h('button', { type: 'button', class: 'big', onclick: () => void app.session.pickProjectFolder() }, 'Ouvrir un projet Gribouillot (dossier)…'),
        h('button', { type: 'button', class: 'big', onclick: () => void app.session.pickProjectFiles() }, 'Ouvrir un .zip ou des fichiers…'),
      ),
      h('p', { class: 'hint' }, 'Vous pouvez aussi glisser-déposer ici une image de carte, un dossier de projet ou un .zip.'),
      h('div', { id: 'recent' }),
      h('p', { class: 'privacy' }, 'Vos cartes et vos tracés restent dans ce navigateur : rien n\'est envoyé sur Internet. Pensez à exporter vos projets (.zip) pour les sauvegarder ou les ouvrir dans Gribouillot pour ordinateur.'),
    ),
  );
}

async function refreshStartScreen(app: App): Promise<void> {
  const el = $('#recent');
  el.replaceChildren();
  let list: store.ProjectSummary[] = [];
  try {
    list = await store.listProjects();
  } catch {
    el.append(h('p', { class: 'hint' }, 'Le stockage du navigateur n\'est pas disponible (navigation privée ?) : les projets ne seront pas conservés.'));
    return;
  }
  if (!list.length) return;
  el.append(h('h2', {}, 'Mes projets'), projectList(app, list, () => void refreshStartScreen(app)));
}

function projectList(app: App, list: store.ProjectSummary[], onDelete: () => void, onOpen?: () => void): HTMLElement {
  return h('ul', { class: 'projects' }, ...list.map((p) =>
    h('li', {},
      h('button', { type: 'button', class: 'open', onclick: () => { onOpen?.(); void app.session.openStored(p.id); } },
        h('strong', {}, p.name),
        h('span', {}, `${p.mapName || 'sans carte'} · ${p.layerCount} calque(s) · ${new Date(p.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`)),
      h('button', {
        type: 'button', class: 'icon-btn', title: 'Supprimer ce projet du navigateur', onclick: async () => {
          if (await confirmDialog('Supprimer le projet', `Supprimer définitivement « ${p.name} » de ce navigateur ? Exportez-le d'abord en .zip si vous voulez le garder.`, 'Supprimer', true)) {
            if (app.project?.id === p.id) await app.session.closeProject();
            await store.deleteProject(p.id);
            onDelete();
          }
        },
      }, h('img', { src: icon('delete-layer.png'), alt: '' })),
    )));
}

async function projectsDialog(app: App): Promise<void> {
  const list = await store.listProjects();
  if (!list.length) {
    await alertDialog('Mes projets', 'Aucun projet enregistré dans ce navigateur.');
    return;
  }
  const holder = h('div', {});
  let close = () => {};
  const render = async () => holder.replaceChildren(projectList(app, await store.listProjects(), () => void render(), () => close()));
  await render();
  const p = openDialog('Mes projets', holder, [{ label: 'Fermer', value: true, primary: true }], { wide: true, onOpen: () => {
    close = () => document.querySelector<HTMLDialogElement>('dialog.dlg[open]')?.close();
  } });
  await p;
}

/* ================================================================ drops */

async function entryFiles(entry: FileSystemEntry, path = ''): Promise<{ path: string; blob: Blob }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ path: path + file.name, blob: file }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const out: { path: string; blob: Blob }[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) out.push(...(await entryFiles(e, `${path}${entry.name}/`)));
  }
  return out;
}

function buildDropZone(app: App): void {
  let depth = 0;
  const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    depth++;
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dropping');
  });
  window.addEventListener('dragover', (e) => {
    if (isFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    const dt = e.dataTransfer!;
    const entries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    let files: { path: string; blob: Blob }[];
    if (entries.length && entries.some((x) => x.isDirectory)) {
      files = (await Promise.all(entries.map((x) => entryFiles(x)))).flat();
    } else files = fromFileList(dt.files);
    if (files.length) await app.session.handleFiles(files);
  });
}

/* =============================================================== dialogs */

function shortcutsDialog(): void {
  const rows: [string, string][] = [
    ['Clic gauche', 'utiliser l\'outil ; glisser : déplacer la vue (ou rectangle de sélection avec l\'outil Sélection)'],
    ['Clic droit', 'menu des outils (et un point marque l\'endroit) ; sur un élément sélectionné : couleur et épaisseur'],
    ['Molette', 'zoomer sur le curseur ; bouton du milieu : déplacer la vue'],
    ['Deux doigts', 'zoomer et déplacer (écran tactile)'],
    ['Échap', 'recommencer la construction en cours / tout désélectionner'],
    ['Ctrl+Z, Ctrl+Y', 'annuler, rétablir'],
    ['Suppr', 'supprimer la sélection (du calque courant)'],
    ['Espace', 'sélectionner l\'élément suivant du calque'],
    ['Ctrl / Maj + clic', 'ajouter ou retirer un élément de la sélection'],
    ['C, T', 'couleur, épaisseur (de la sélection, sinon du dessin)'],
    ['W', 'poids du point sélectionné'],
    ['A', 'angle de l\'arc sélectionné'],
    ['I', 'points d\'intersection des éléments sélectionnés'],
    ['S', 'options de la spirale'],
    ['Entrée', 'spirale : terminer avec 2 ou 3 centres ; arc et droite à angle : saisir l\'angle'],
    ['Maj', 'spirale : côté perpendiculaire au précédent'],
    ['Image sélectionnée', '←/→ tourner de 1° (Maj : 10°), +/− ou Maj+molette : échelle, 0/1/2 : pas grossier/fin/très fin'],
    ['F, +, −', 'ajuster à la fenêtre, zoom avant, zoom arrière'],
    ['Ctrl+S', 'exporter le projet en .zip'],
    ...TOOLS.filter((t) => t.key).map((t): [string, string] => [t.key!, t.label]),
  ];
  void openDialog('Raccourcis clavier', h('table', { class: 'keys' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))), [
    { label: 'Fermer', value: true, primary: true },
  ], { wide: true });
}

function aboutDialog(): void {
  void openDialog('À propos de Gribouillot', h('div', { class: 'about' },
    h('p', {}, h('strong', {}, `Gribouillot ${VERSION} — version web`)),
    h('p', {}, 'Logiciel libre sous licence GPL 3, créé à l\'origine pour aider les chercheurs de la Chouette d\'Or.'),
    h('p', {}, 'Auteur original : ', h('strong', {}, 'Ludovic A.'), ' (versions jusqu\'à 2.0, ', h('a', { href: 'https://github.com/Fr3nchK1ss/Gribouillot', target: '_blank', rel: 'noopener' }, 'Fr3nchK1ss/Gribouillot'), ').'),
    h('p', {}, 'Version maintenue par ', h('strong', {}, 'Elseware'), ', chouetteur, sur ', h('a', { href: 'https://github.com/ElsewareChouette/Gribouillot', target: '_blank', rel: 'noopener' }, 'ElsewareChouette/Gribouillot'), '. Remarques et suggestions bienvenues !'),
    h('p', { class: 'hint' }, 'Les projets s\'échangent avec Gribouillot pour ordinateur : exportez en .zip puis décompressez, ou ouvrez ici le dossier d\'un projet.'),
  ), [{ label: 'Fermer', value: true, primary: true }]);
}
