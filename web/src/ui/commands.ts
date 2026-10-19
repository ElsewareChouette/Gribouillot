/**
 * Every action of the application, by name: the menus show them by group,
 * the command palette (Ctrl+K) finds them by a few letters, together with
 * the tools, the layers and the named objects.
 */

import type { App } from '../app';
import { ZOOM_STEP } from '../camera';
import { ITEM_LABELS } from '../model';
import { nameOf } from '../names';
import { TOOLS, CALIBRATE_DEF, GEOREF_DEF, familyOf } from '../tools';
import { h } from './dom';
import { icon } from './icons';

export interface Command {
  label: string;
  group: string;
  run: () => unknown;
  key?: string;
  /** Other words it is found by. */
  words?: string;
  checked?: boolean;
  disabled?: boolean;
  icon?: string;
}

/** The actions, by group (menus and palette). */
export function actions(app: App, shortcuts: () => void, about: () => void, projects: () => void): Command[] {
  const none = !app.project;
  const o = app.options;
  return [
    { group: 'Projet', label: 'Nouveau projet (choisir une carte)…', run: () => app.session.newProject() },
    { group: 'Projet', label: 'Mes projets…', run: projects },
    { group: 'Projet', label: 'Importer un projet (dossier)…', run: () => app.session.pickProjectFolder(), words: 'ouvrir' },
    { group: 'Projet', label: 'Importer un projet (.zip ou fichiers)…', run: () => app.session.pickProjectFiles(), words: 'ouvrir' },
    { group: 'Projet', label: 'Exporter le projet (.zip)', key: 'Ctrl+S', run: () => app.session.exportZip(), disabled: none, words: 'enregistrer sauvegarder' },
    { group: 'Projet', label: 'Exporter une image…', run: () => app.session.exportImage(), disabled: none, words: 'png jpg légende' },
    { group: 'Projet', label: 'Exporter en GeoJSON (GPS)', run: () => app.session.exportGeoJSON(), disabled: none, words: 'qgis umap kml gps coordonnées' },
    { group: 'Projet', label: 'Renommer le projet…', run: () => app.renameProject(), disabled: none },
    { group: 'Projet', label: 'Fermer le projet', run: () => app.session.closeProject(), disabled: none },

    { group: 'Édition', label: `Annuler${app.history.undoLabel ? ` (${app.history.undoLabel})` : ''}`, key: 'Ctrl+Z', run: () => app.undo(), disabled: !app.history.undoLabel },
    { group: 'Édition', label: `Rétablir${app.history.redoLabel ? ` (${app.history.redoLabel})` : ''}`, key: 'Ctrl+Y', run: () => app.redo(), disabled: !app.history.redoLabel },
    { group: 'Édition', label: 'Tout sélectionner dans le calque', key: 'Ctrl+A', run: () => app.setSelection(app.currentLayer?.items.map((i) => i.id) ?? []), disabled: none },
    { group: 'Édition', label: 'Supprimer la sélection', key: 'Suppr', run: () => app.deleteSelection(), disabled: none, words: 'effacer' },
    { group: 'Édition', label: 'Couleur…', key: 'C', run: () => app.chooseColor(), disabled: none },
    { group: 'Édition', label: 'Épaisseur…', key: 'T', run: () => app.chooseWidth(), disabled: none },
    { group: 'Édition', label: 'Poids du point…', key: 'W', run: () => app.editPointWeight(), disabled: none },
    { group: 'Édition', label: 'Angle de l\'arc…', key: 'A', run: () => app.editArcAngle(), disabled: none },

    { group: 'Construire', label: 'Points d\'intersection de la sélection', key: 'I', run: () => app.addIntersections(), disabled: none, icon: 'point.png' },
    { group: 'Construire', label: 'Placer des villes par leur nom…', run: () => app.placeTowns(), disabled: none, words: 'communes liste poids', icon: 'point.png' },
    { group: 'Construire', label: 'Point par ses coordonnées GPS…', run: () => app.placeByCoordinates(), disabled: none, words: 'latitude longitude', icon: 'point.png' },
    { group: 'Construire', label: 'Triangle d\'erreur des droites sélectionnées', run: () => app.drawErrorPolygon(), disabled: none, words: 'polygone croisement' },
    { group: 'Construire', label: 'Centre de masse des points pondérés', run: () => app.centerOfMass(), disabled: none, words: 'poids barycentre' },
    { group: 'Construire', label: 'Autour du point sélectionné (monuments, lieux-dits)…', run: () => app.aroundSelection(), disabled: none, words: 'mérimée église château google' },
    { group: 'Construire', label: 'Importer une image dans le calque…', run: () => app.addPicture(), disabled: none, icon: 'image-x-generic.png' },

    { group: 'Calques', label: 'Nouveau calque', run: () => app.addLayer(), disabled: none, icon: 'add-layer.png' },
    { group: 'Calques', label: 'Importer un calque (.xml)…', run: () => app.pickLayerFiles(), disabled: none },

    { group: 'Carte', label: CALIBRATE_DEF.label, run: () => app.setTool('calibrate'), disabled: none, words: 'échelle', icon: CALIBRATE_DEF.icon },
    { group: 'Carte', label: GEOREF_DEF.label, run: () => app.setTool('georef'), disabled: none, words: 'repères villes calage', icon: GEOREF_DEF.icon },
    { group: 'Carte', label: 'Changer la carte…', run: () => app.session.changeMap(), disabled: none, words: 'fond' },

    { group: 'Affichage', label: 'Ajuster à la fenêtre', key: 'F', run: () => app.zoomToFit(), disabled: none, words: 'zoom' },
    { group: 'Affichage', label: 'Zoom 100 %', run: () => app.setZoom(1), disabled: none },
    { group: 'Affichage', label: 'Zoom avant', key: '+', run: () => app.zoom(ZOOM_STEP), disabled: none },
    { group: 'Affichage', label: 'Zoom arrière', key: '−', run: () => app.zoom(1 / ZOOM_STEP), disabled: none },
    { group: 'Affichage', label: 'Noms des points sur la carte', checked: o.showNames, run: () => app.toggleOption('showNames'), words: 'étiquettes' },
    { group: 'Affichage', label: 'Nommer les nouveaux objets (A, B…, d1…)', checked: o.autoNames, run: () => app.toggleOption('autoNames') },
    { group: 'Affichage', label: 'Poids des points (afficher et demander)', checked: o.weights, run: () => app.toggleOption('weights') },
    { group: 'Affichage', label: 'Aimanter aux intersections, milieux et centres', checked: o.snapFigures, run: () => app.toggleOption('snapFigures') },
    { group: 'Affichage', label: 'Placer le centre des cercles et arcs', checked: o.drawCenter, run: () => app.toggleOption('drawCenter') },
    { group: 'Affichage', label: 'Mini-carte', checked: o.minimap, run: () => app.toggleOption('minimap') },
    { group: 'Affichage', label: 'Carte en noir et blanc', checked: o.gray, run: () => app.toggleGray(), disabled: none },
    { group: 'Affichage', label: 'Options de la spirale…', key: 'S', run: () => app.spiralOptions() },
    { group: 'Affichage', label: 'Panneau latéral', checked: !document.body.classList.contains('no-sidebar'), run: () => document.body.classList.toggle('no-sidebar') },

    { group: 'Aide', label: 'Raccourcis clavier', run: shortcuts, words: 'touches clavier' },
    { group: 'Aide', label: 'À propos de Gribouillot', run: about },
  ];
}

/** Everything the palette can find: actions, tools, layers, named objects. */
function everything(app: App, base: Command[]): Command[] {
  const out = base.filter((c) => !c.disabled);
  if (app.project) {
    for (const t of TOOLS) {
      const fam = familyOf(t.id);
      out.push({ group: 'Outil', label: fam && fam.label !== t.label ? `${fam.label} : ${t.label}` : t.label, key: t.key, icon: t.icon, run: () => app.setTool(t.id) });
    }
    for (const l of app.project.layers) out.push({ group: 'Calque', label: l.name, run: () => app.setCurrentLayer(l.id), words: 'calque' });
    for (const l of app.project.layers) {
      for (const it of l.items) {
        if (it.kind === 'pixmap' || (!it.label && !it.place)) continue;
        out.push({
          group: 'Objet', label: `${nameOf(it)} — ${ITEM_LABELS[it.kind]}, ${l.name}`, words: `${it.label ?? ''} ${it.place ?? ''} ${it.note ?? ''}`,
          run: () => {
            app.setTool('select');
            app.setSelection([it.id]);
            app.showItem(it.id);
          },
        });
      }
    }
  }
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The commands matching all the words typed, the best first. */
export function search(cmds: Command[], q: string): Command[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return cmds.filter((c) => c.group !== 'Objet' && c.group !== 'Calque').slice(0, 60);
  const scored: [Command, number][] = [];
  for (const c of cmds) {
    const label = fold(c.label);
    const text = `${label} ${fold(c.group)} ${fold(c.words ?? '')}`;
    if (!words.every((w) => text.includes(w))) continue;
    // Label starting with the query first, then words of the label, then the rest.
    const score = (label.startsWith(words[0]) ? 0 : label.includes(` ${words[0]}`) ? 1 : 2) + (c.group === 'Objet' && fold(c.words ?? '') === words.join(' ') ? -1 : 0);
    scored.push([c, score]);
  }
  return scored.sort((a, b) => a[1] - b[1]).slice(0, 60).map(([c]) => c);
}

/** The command palette: type a few letters, Enter runs the first match. */
export function openPalette(app: App, base: Command[]): void {
  if (document.querySelector('.palette')) return;
  const all = everything(app, base);
  const input = h('input', { type: 'search', placeholder: 'Une commande, un outil, un calque, un objet (A, Bourges…)', 'aria-label': 'Rechercher une commande' });
  const list = h('ul', { role: 'listbox' });
  const back = h('div', { class: 'palette-back' });
  const box = h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Commandes' }, input, list);
  let found: Command[] = [];
  let at = 0;
  const close = () => {
    back.remove();
    box.remove();
    (document.getElementById('canvas') as HTMLCanvasElement | null)?.focus();
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    void c.run();
  };
  const render = () => {
    found = search(all, input.value);
    at = Math.min(at, Math.max(0, found.length - 1));
    list.replaceChildren(...found.map((c, i) => h('li', {
      role: 'option', class: i === at ? 'on' : '', 'aria-selected': String(i === at),
      onclick: () => run(c), onmousemove: () => { if (at !== i) { at = i; render(); } },
    }, c.icon ? h('img', { src: icon(c.icon), alt: '' }) : h('span', { class: 'noicon' }),
    h('span', { class: 'label' }, c.checked === undefined ? c.label : `${c.checked ? '✓' : '○'} ${c.label}`),
    h('span', { class: 'group' }, c.group), c.key ? h('kbd', {}, c.key) : null)));
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => {
    at = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') at = Math.min(found.length - 1, at + 1);
    else if (e.key === 'ArrowUp') at = Math.max(0, at - 1);
    else if (e.key === 'Enter') return run(found[at]);
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    render();
  });
  back.addEventListener('pointerdown', close);
  document.body.append(back, box);
  render();
  input.focus();
}
