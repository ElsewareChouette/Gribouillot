/**
 * The tools: a rail with one button per family (Point, Droite, Cercle…), and
 * an options bar with the variants of the active family, the drawing style
 * and the settings that matter for it.
 */

import type { App } from '../app';
import { FAMILIES, familyOf, toolDef, type Family, type ToolId } from '../tools';
import { $, h } from './dom';
import { icon } from './icons';

/** The tool a family starts with: the variant used last. */
export function familyTool(app: App, f: Family): ToolId {
  const last = app.options.lastTools[f.id] as ToolId | undefined;
  return last && f.tools.includes(last) ? last : f.tools[0];
}

export function buildRail(app: App): void {
  const rail = $('#rail');
  for (const f of FAMILIES) {
    const title = `${f.label}${f.key ? ` (${f.key})` : ''}`;
    rail.append(h('button', {
      type: 'button', class: 'rail-btn', 'data-family': f.id, title, 'aria-label': title,
      onclick: () => app.setTool(familyTool(app, f)),
    }, h('img', { src: icon(f.icon), alt: '' }), h('span', {}, f.label)));
  }
}

export function refreshRail(app: App): void {
  const fam = familyOf(app.toolId)?.id;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#rail .rail-btn')) b.classList.toggle('active', b.dataset.family === fam);
}

const WIDTHS = [1, 2, 3, 5, 7, 9, 12];

function toggle(label: string, title: string, on: boolean, run: () => void): HTMLElement {
  return h('label', { class: 'opt-toggle', title }, h('input', { type: 'checkbox', checked: on, onchange: run }), label);
}

export function refreshOptions(app: App): void {
  const bar = $('#optionsbar');
  const p = app.project;
  bar.replaceChildren();
  if (!p) return;
  const fam = familyOf(app.toolId);
  const def = toolDef(app.toolId);
  bar.append(h('b', { class: 'opt-title' }, fam?.label ?? def.label));
  if (fam && fam.tools.length > 1) {
    bar.append(h('div', { class: 'variants', role: 'radiogroup' }, ...fam.tools.map((id) => {
      const d = toolDef(id);
      return h('button', {
        type: 'button', class: `variant${id === app.toolId ? ' on' : ''}`, title: d.label + (d.key ? ` (${d.key})` : ''),
        role: 'radio', 'aria-checked': String(id === app.toolId), onclick: () => app.setTool(id),
      }, h('img', { src: icon(d.icon), alt: '' }), d.short ?? d.label);
    })));
  }
  const draws = app.tool.draws;
  if (draws) {
    const color = h('button', { type: 'button', class: 'opt-color', title: 'Couleur des prochains tracés (C)', onclick: () => void app.chooseColor() },
      h('span', { class: 'swatch', style: `background:${p.color}` }));
    const width = h('select', { class: 'opt-width', title: 'Épaisseur des prochains tracés' },
      ...[...new Set([...WIDTHS, p.width])].sort((a, b) => a - b).map((w) => h('option', { value: String(w), selected: w === p.width }, `${w} px`)));
    width.addEventListener('change', () => {
      p.width = parseInt(width.value, 10);
      app.changed();
    });
    // A point is always 10 px wide: its width does not show.
    bar.append(h('span', { class: 'opt-sep' }), color);
    if (app.toolId !== 'point') bar.append(width);
  }
  const extra: HTMLElement[] = [];
  if (draws || app.snaps()) extra.push(toggle('Aimanter', 'Accrocher les clics aux intersections, milieux, extrémités et centres (toujours aux points)', app.options.snapFigures, () => app.toggleOption('snapFigures')));
  if (fam?.id === 'point') {
    extra.push(toggle('Demander le poids', 'Demander un poids pour chaque nouveau point (et afficher les poids)', app.options.weights, () => app.toggleOption('weights')));
    extra.push(
      h('button', { type: 'button', class: 'small', onclick: () => void app.placeTowns() }, 'Villes par leur nom…'),
      h('button', { type: 'button', class: 'small', onclick: () => void app.placeByCoordinates() }, 'Par coordonnées…'),
      h('button', { type: 'button', class: 'small', title: 'Un point sur chaque intersection des éléments sélectionnés (I)', onclick: () => app.addIntersections() }, 'Intersections de la sélection'),
      h('button', { type: 'button', class: 'small', onclick: () => void app.centerOfMass() }, 'Centre de masse'),
    );
  }
  if (fam?.id === 'circle' || fam?.id === 'arc') extra.push(toggle('Placer le centre', 'Ajouter aussi un point au centre des cercles, arcs et ellipses', app.options.drawCenter, () => app.toggleOption('drawCenter')));
  if (app.toolId === 'spiral') extra.push(h('button', { type: 'button', class: 'small', onclick: () => void app.spiralOptions() }, 'Options de la spirale…'));
  if (app.toolId === 'select') extra.push(h('span', { class: 'hint' }, 'Clic : sélectionner (Ctrl : plusieurs) · glisser un point : le déplacer, ses constructions suivent · glisser ailleurs : rectangle de sélection'));
  if (extra.length) bar.append(h('span', { class: 'opt-sep' }), ...extra);
}
