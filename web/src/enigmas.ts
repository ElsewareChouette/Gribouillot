/**
 * The énigmes of the hunt, as groups of layers worked in the order of the
 * game. A group only gathers layers: the layers stay plain Gribouillot
 * layers (one .xml each), the groups are kept in the side file.
 */

import type { Group, Layer } from './model';
import { newId } from './model';

/**
 * The énigmes in the order of the game (given by the B), with the color of their wavelength,
 * darkened: a light stroke (yellow, orange) is lost on a colorful map.
 */
export const ENIGMAS: { code: string; title: string; color: string }[] = [
  { code: '530', title: 'Ouverture', color: '#1b7a2a' },
  { code: '780', title: 'Premier pas…', color: '#a3164e' },
  { code: '470', title: 'Ce n\'est le bon chemin que si la flèche vise le cœur', color: '#1a4fc0' },
  { code: '580', title: 'Le bon sens, c\'est le sens du contresens, et inversement', color: '#8a6d00' },
  { code: '600', title: 'Quand Al-Mar s\'allie à la fibule de Préneste…', color: '#b85000' },
  { code: '500', title: 'Ut queant laxis', color: '#00707d' },
  { code: '420', title: 'Du ciel vient la lumière', color: '#6a23bd' },
  { code: '560', title: 'Ad augusta per angusta', color: '#5f7a00' },
  { code: '650', title: 'Quand tout est révélé', color: '#c01414' },
  { code: '520', title: 'La terre s\'ouvre', color: '#0f7a5a' },
];

/** The lighter colors the énigmes had at first, and the dark one that replaces each. */
const FORMER_COLORS: Record<string, string> = { '#2e9e3a': '#1b7a2a', '#1f5fd6': '#1a4fc0', '#c9a400': '#8a6d00', '#ef7d00': '#b85000', '#0097a7': '#00707d', '#7a2fd0': '#6a23bd', '#8aa800': '#5f7a00', '#e01b1b': '#c01414', '#24a37a': '#0f7a5a' };

/** The groups, those still in their former light color taking the dark one (a color chosen by the user is kept). */
export function darkened(groups: Group[]): Group[] {
  return groups.map((g) => (FORMER_COLORS[g.color.toLowerCase()] ? { ...g, color: FORMER_COLORS[g.color.toLowerCase()] } : g));
}

/** Ready-made names of the layers of a group. */
export const SUBLAYERS = ['points', 'constructions', 'annotations', 'hypothèse A', 'hypothèse B'];

export function newGroup(code: string, title: string, color: string): Group {
  return { id: newId('e'), code, title, color, layerIds: [], text: '', notes: '' };
}

/** The groups of the 10 énigmes, in the order of the game. */
export function enigmaGroups(): Group[] {
  return ENIGMAS.map((e) => newGroup(e.code, e.title, e.color));
}

/** The group of a layer, if any. */
export function groupOf(groups: Group[], layerId: string): Group | undefined {
  return groups.find((g) => g.layerIds.includes(layerId));
}

/** Rank of the group of a layer in the order of the game; -1 when the layer is in no group. */
export function rankOf(groups: Group[], layerId: string): number {
  return groups.findIndex((g) => g.layerIds.includes(layerId));
}

/**
 * Whether a layer may be drawn upon from a layer of the given rank: an
 * énigme builds on the previous ones, never on a later one. Layers out of
 * the groups go with everything.
 */
export function usableFrom(groups: Group[], layerId: string, rank: number): boolean {
  if (rank < 0) return true;
  const r = rankOf(groups, layerId);
  return r <= rank;
}

/** The layers shown in the « state at the énigme n » view: up to n, and those out of the groups. */
export function shownAt(groups: Group[], layer: Layer, rank: number | null): boolean {
  if (rank === null) return true;
  const r = rankOf(groups, layer.id);
  return r < 0 || r <= rank;
}

/** The groups without the layers that no longer exist. */
export function cleanGroups(groups: Group[], layers: Layer[]): Group[] {
  const ids = new Set(layers.map((l) => l.id));
  return groups.map((g) => (g.layerIds.every((id) => ids.has(id)) ? g : { ...g, layerIds: g.layerIds.filter((id) => ids.has(id)) }));
}

/** The name of a new layer of a group: « 500 points », « 500 hypothèse A »… */
export const layerName = (g: Group, sub: string) => `${g.code} ${sub}`.trim();

/** The groups of the 10 énigmes, the layers named after one (« 500 constructions ») going into it. */
export function organizeByEnigmas(layers: Layer[]): Group[] {
  const groups = enigmaGroups();
  for (const l of layers) {
    const g = groups.find((x) => new RegExp(`^${x.code}(\\b|_|\\s|$)`).test(l.name));
    if (g) g.layerIds.push(l.id);
  }
  return groups;
}
