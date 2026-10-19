/**
 * Data model of a Gribouillot project.
 *
 * Everything here is plain, immutable data: an edit replaces the objects it
 * touches instead of mutating them, which makes undo/redo a matter of keeping
 * the previous `layers` array around (see history.ts).
 */

import type { Anchor } from './geo';
import type { MapUnits } from './units';
import type { Pt } from './geom';

export type ScaleUnit = 'km' | 'm';

interface Stroke {
  id: string;
  color: string; // #rrggbb
  width: number; // screen pixels, whatever the zoom ("cosmetic" pen)
  /** Its name (« A », « Bourges », « d1 »), shown on the map. Ignored by the desktop version. */
  label?: string;
  /** A free note on it: a quote of the énigme, a madit, a doubt. Ignored by the desktop version. */
  note?: string;
  /** How the item was built, to build it again when what it depends on moves (see links.ts). */
  link?: Link;
}

/**
 * Where an input of a construction comes from. The items it refers to are
 * copied as they were (`frozen`), so that a deleted one still gives a value.
 */
export type Source =
  | { k: 'pt'; p: Pt } // a free click
  | { k: 'num'; v: number; expr?: string } // a typed length (px) or angle (°), and the formula typed
  | { k: 'item'; id: string; frozen: StrokeItem } // an item, or a point clicked on
  | { k: 'snap'; kind: 'intersection' | 'midpoint' | 'end' | 'center'; ids: string[]; frozen: StrokeItem[]; end?: number; p: Pt };

export interface Link {
  /** Recipe id (constructions.ts), or '@point' for a point on a remarkable spot of the figure. */
  recipe: string;
  /** Shared by the items made by one construction. */
  group: string;
  /** Creation order: an item only depends on older ones. */
  seq: number;
  /** Index of the item among the shapes of the construction; -1 for its center. */
  out: number;
  sources: Source[];
}

export interface PointItem extends Stroke {
  kind: 'point';
  p: Pt;
  weight: number;
}

export interface SegmentItem extends Stroke {
  kind: 'segment';
  p1: Pt;
  p2: Pt;
}

/** A pseudo-infinite line, stored as its 2 far ends (see geom.extendLine). */
export interface LineItem extends Stroke {
  kind: 'line';
  p1: Pt;
  p2: Pt;
}

export interface CircleItem extends Stroke {
  kind: 'circle';
  c: Pt;
  r: number;
}

/** Angles in degrees, counter-clockwise on screen (Qt convention). */
export interface ArcItem extends Stroke {
  kind: 'arc';
  c: Pt;
  r: number;
  start: number;
  span: number;
}

export interface EllipseItem extends Stroke {
  kind: 'ellipse';
  f1: Pt;
  f2: Pt;
  dSum: number; // sum of the distances to the foci = major axis
}

/** A 4 centers spiral, defined by its base quadrangle. */
export interface SpiralItem extends Stroke {
  kind: 'spiral';
  centers: [Pt, Pt, Pt, Pt];
}

/** An imported picture. `file` is the key of its image in the project files. */
export interface PixmapItem {
  kind: 'pixmap';
  id: string;
  x: number; // top-left corner before scale and rotation
  y: number;
  scale: number;
  rotation: number; // degrees, clockwise, around the picture center
  file: string;
}

export type Item =
  | PointItem
  | SegmentItem
  | LineItem
  | CircleItem
  | ArcItem
  | EllipseItem
  | SpiralItem
  | PixmapItem;

export type ItemKind = Item['kind'];
export type StrokeItem = Exclude<Item, PixmapItem>;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0-100
  items: Item[];
}

/** An énigme: a group of layers, worked in the order of the game (see enigmas.ts). */
export interface Group {
  id: string;
  code: string; // « 530 »
  title: string;
  color: string; // the color of its drawings
  layerIds: string[];
  /** The text of the énigme, pasted by the user. */
  text: string;
  /** What the user makes of it. */
  notes: string;
}

export interface MapScale {
  px: number; // a distance measured on the map, in pixels...
  value: number; // ...corresponds to this real distance...
  unit: ScaleUnit; // ...in this unit
}

export interface Project {
  id: string;
  name: string;
  mapName: string;
  mapFile: string | null; // key of the background map in the project files
  scale: MapScale;
  color: string; // current drawing color
  width: number; // current drawing width
  customColors: string[];
  layers: Layer[];
  /** Points of the map with known GPS coordinates (see geo.ts). */
  anchors?: Anchor[];
  /** The énigmes, in the order of the game; layers out of them are « other layers ». */
  groups?: Group[];
  /** Paper scale, game units, precision, north (see units.ts); defaults when missing. */
  units?: Partial<MapUnits>;
  /** Zoom and center of the view, restored when reopening the project. */
  view?: { zoom: number; cx: number; cy: number };
}

let counter = 0;
export function newId(prefix = 'i'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function isStroke(item: Item): item is StrokeItem {
  return item.kind !== 'pixmap';
}

/** Scene pixels -> kilometers, 0 if the scale is not defined. */
export function kmPerPx(scale: MapScale): number {
  if (!scale.px || !scale.value) return 0;
  const km = scale.unit === 'm' ? scale.value / 1000 : scale.value;
  return km / scale.px;
}

/** Scene pixels -> the project unit (km or m), 0 if the scale is not defined. */
export function unitPerPx(scale: MapScale): number {
  const k = kmPerPx(scale);
  return scale.unit === 'm' ? k * 1000 : k;
}

export function formatLength(px: number, scale: MapScale, digits = 1): string {
  const k = unitPerPx(scale);
  if (!k) return `${px.toFixed(0)} px`;
  return `${(px * k).toFixed(digits)} ${scale.unit}`;
}

export const ITEM_LABELS: Record<ItemKind, string> = {
  point: 'point',
  segment: 'segment',
  line: 'droite',
  circle: 'cercle',
  arc: 'arc',
  ellipse: 'ellipse',
  spiral: 'spirale',
  pixmap: 'image',
};

export function emptyProject(name: string): Project {
  return {
    id: newId('p'),
    name,
    mapName: '',
    mapFile: null,
    scale: { px: 0, value: 0, unit: 'km' },
    color: '#000000',
    width: 5,
    customColors: [],
    layers: [],
    anchors: [],
  };
}

export function emptyLayer(name: string): Layer {
  return { id: newId('l'), name, visible: true, opacity: 100, items: [] };
}

/** A layer name which is not used yet, like the desktop version's "layer_N". */
export function freshLayerName(layers: Layer[], base = 'calque_'): string {
  const names = new Set(layers.map((l) => l.name));
  for (let i = 1; ; i++) {
    const n = `${base}${i}`;
    if (!names.has(n)) return n;
  }
}
