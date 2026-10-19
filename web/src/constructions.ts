/**
 * Geometric constructions: what each drawing tool asks the user for, and how
 * it computes its figure from these inputs.
 *
 * A recipe is data plus a pure `build` function: the same function draws the
 * live preview, makes the final items, and can be tested without a browser.
 * The interactive part (clicks, prompts, status bar) is generic, see
 * tools/construction.ts.
 *
 * The geometry is a port of the desktop version (gribouillot_toolbar.cpp,
 * gribouillotlayer.cpp and the Item_*Drawer helpers).
 */

import {
  add,
  angleOf,
  circumcenter,
  dist,
  dot,
  dx,
  dy,
  extendLine,
  LINE_EXTENT,
  mid,
  mul,
  normalVector,
  polar,
  projectOnLine,
  pt,
  samePt,
  seg,
  segCenter,
  segLength,
  sub,
  tangencyPoints,
  translated,
  withLength,
  type Pt,
  type Seg,
} from './geom';
import type { CircleItem, Item, ItemKind, LineItem, PixmapItem, SegmentItem } from './model';
import type { Renderer, StrokeStyle } from './render';
import { spiralArcs } from './shapes';
import { GUIDE_DARK, guideLine } from './tools/base';
import { fmt } from './ui/dom';

/* ------------------------------------------------------------------ types */

type Geometry<T> = T extends Item ? Omit<T, 'id' | 'color' | 'width'> : never;
/** An item without its identity and style: what a construction computes. */
export type Shape = Geometry<Exclude<Item, PixmapItem>>;

/** A value given by the user: a position, an existing item, a length (px) or an angle (°). */
export type Input = Pt | Item | number;

export const isItem = (v: Input): v is Item => typeof v === 'object' && 'kind' in v;
export const isPt = (v: Input): v is Pt => typeof v === 'object' && !('kind' in v);

/** Length conversions for the prompts, given the scale of the map. */
export interface Units {
  scaled: boolean;
  /** A length in pixels, written in the unit of the map. */
  len: (px: number) => string;
}

export type Step =
  /** A click on the map, snapped on the points unless `raw`. */
  | {
      take: 'point';
      tip: string;
      raw?: boolean;
      /** Constrains the clicked position (e.g. onto a line). */
      onto?: (p: Pt, inputs: Input[]) => Pt;
      /** A reason to ignore the click: shown in the status bar, silent if empty. */
      refuse?: (p: Pt, inputs: Input[]) => string | undefined;
    }
  /** A click on an existing item. Only the first step may be one. */
  | { take: 'item'; tip: string; kinds: ItemKind[] }
  /** A length typed in a dialog, in the unit of the map; the recipe gets pixels. */
  | {
      take: 'length';
      title: string;
      label: string;
      /** Proposed value, in pixels. Without it: the last value typed, or 1. */
      initial?: (inputs: Input[]) => number;
      hint?: (inputs: Input[], units: Units) => string | undefined;
    }
  /**
   * A direction typed in a dialog: an azimuth or a cardinal point (« NE »,
   * « sud-ouest », « N 30° E »); the recipe gets the azimuth on the sheet,
   * in degrees clockwise from the top (the tool turns a geographic north
   * into the sheet's one).
   */
  | { take: 'azimuth'; title: string; label: string }
  /**
   * An angle swept by the mouse from `side` (center -> first direction),
   * or typed in a dialog after [Enter] when `prompt` is given.
   */
  | {
      take: 'angle';
      tip: string;
      side: (inputs: Input[]) => Seg;
      live: (span: number) => string;
      prompt?: { title: string; label: string; initial: (span: number) => number };
    };

export type Construction =
  | {
      shapes: Shape[];
      /** Center of the figure, drawn as a point with the "draw centers" option. */
      center?: Pt;
      /** Items the figure replaces (in the current layer only). */
      remove?: Item[];
    }
  | { fail: string; alert?: boolean };

/** What a recipe's draft can use to draw its construction lines. */
export interface Draft {
  r: Renderer;
  mouse: Pt;
  color: string;
  width: number;
  zoom: number;
  style: StrokeStyle;
  len: (px: number) => string;
}

export interface Recipe {
  id: string;
  /** Name of the change, for undo/redo. */
  label: string;
  steps: Step[];
  build(inputs: Input[]): Construction;
  /** Construction lines drawn over the preview; `inputs` ends with the mouse. */
  draft?(d: Draft, inputs: Input[]): void;
  /** Inputs kept after a figure is drawn, to draw another one on the same reference. */
  keep?: number;
  /** Tip shown when all the inputs are kept. */
  again?: string;
  /** Number of items selected beforehand (with the selection tool) taken as first inputs. */
  preselect?: number;
  /** Show the clicked points. */
  markers?: boolean;
  previewStyle?: 'dashed' | 'solid' | 'bold';
}

/* ---------------------------------------------------------------- helpers */

const ok = (shapes: Shape[], center?: Pt, remove?: Item[]): Construction => ({ shapes, center, remove });
const none: Construction = { shapes: [] };
const fail = (msg: string, alert = false): Construction => ({ fail: msg, alert });

/** Pseudo-infinite line through 2 points, as stored by the desktop version. */
function lineThrough(a: Pt, b: Pt): Shape[] {
  const s = extendLine(a, b);
  return s ? [{ kind: 'line', p1: s.p1, p2: s.p2 }] : [];
}

const circle = (c: Pt, r: number): Shape => ({ kind: 'circle', c, r });

/** Rail of a line or a segment item. */
const railOf = (it: SegmentItem | LineItem): Seg => seg(it.p1, it.p2);

const deg = (span: number) => `${fmt(Math.abs(span), 1)}°`;

/* ------------------------------------------------------- through points */

const segment: Recipe = {
  id: 'segment',
  label: 'segment',
  markers: true,
  steps: [
    { take: 'point', tip: 'Segment : cliquez une première extrémité.' },
    { take: 'point', tip: 'Segment : cliquez l\'autre extrémité.' },
  ],
  build: ([a, b]) => (samePt(a as Pt, b as Pt) ? none : ok([{ kind: 'segment', p1: a as Pt, p2: b as Pt }])),
  draft: ({ r, len }, [a, b]) => {
    if (b) r.text(mid(a as Pt, b as Pt), len(dist(a as Pt, b as Pt)), { dx: 8, dy: -8 });
  },
};

const line: Recipe = {
  id: 'line',
  label: 'droite',
  markers: true,
  steps: [
    { take: 'point', tip: 'Droite : cliquez un premier point.' },
    { take: 'point', tip: 'Droite : cliquez un second point.' },
  ],
  build: ([a, b]) => ok(lineThrough(a as Pt, b as Pt)),
};

const horizontal: Recipe = {
  id: 'horizontal',
  label: 'horizontale',
  steps: [{ take: 'point', tip: 'Horizontale : cliquez un point de passage.' }],
  build: ([p]) => ok(lineThrough(p as Pt, add(p as Pt, pt(1, 0)))),
};

const vertical: Recipe = {
  id: 'vertical',
  label: 'verticale',
  steps: [{ take: 'point', tip: 'Verticale : cliquez un point de passage.' }],
  build: ([p]) => ok(lineThrough(p as Pt, add(p as Pt, pt(0, 1)))),
};

const circleCenter: Recipe = {
  id: 'circleCenter',
  label: 'cercle',
  markers: true,
  steps: [
    { take: 'point', tip: 'Cercle : cliquez le centre.' },
    { take: 'point', tip: 'Cercle : cliquez un point de la circonférence.' },
  ],
  build: ([c, b]) => (samePt(c as Pt, b as Pt) ? none : ok([circle(c as Pt, dist(c as Pt, b as Pt))], c as Pt)),
  draft: ({ r, len }, [c, b]) => {
    if (!b) return;
    guideLine(r, c as Pt, b as Pt);
    r.text(mid(c as Pt, b as Pt), `r = ${len(dist(c as Pt, b as Pt))}`, { dx: 8, dy: -8 });
  },
};

const circleDiameter: Recipe = {
  id: 'circleDiameter',
  label: 'cercle',
  markers: true,
  steps: [
    { take: 'point', tip: 'Cercle : cliquez une extrémité du diamètre.' },
    { take: 'point', tip: 'Cercle : cliquez l\'autre extrémité du diamètre.' },
  ],
  build: ([a, b]) => {
    if (samePt(a as Pt, b as Pt)) return none;
    const c = mid(a as Pt, b as Pt);
    return ok([circle(c, dist(a as Pt, b as Pt) / 2)], c);
  },
  draft: ({ r }, [a, b]) => {
    if (b) guideLine(r, a as Pt, b as Pt);
  },
};

const circle3: Recipe = {
  id: 'circle3',
  label: 'cercle',
  markers: true,
  preselect: 3,
  steps: [
    { take: 'point', tip: 'Cercle : cliquez un premier point de la circonférence.' },
    { take: 'point', tip: 'Cercle : cliquez un deuxième point de la circonférence.' },
    { take: 'point', tip: 'Cercle : cliquez un troisième point de la circonférence.' },
  ],
  build: ([a, b, c]) => {
    const o = circumcenter(a as Pt, b as Pt, c as Pt);
    return o ? ok([circle(o, dist(o, a as Pt))], o) : fail('Les 3 points doivent être distincts et non alignés.');
  },
  draft: ({ r }, pts) => {
    if (pts.length === 2) r.line(pts[0] as Pt, pts[1] as Pt, GUIDE_DARK);
  },
};

const ellipse: Recipe = {
  id: 'ellipse',
  label: 'ellipse',
  markers: true,
  steps: [
    { take: 'point', tip: 'Ellipse : cliquez un premier foyer.' },
    { take: 'point', tip: 'Ellipse : cliquez le second foyer.' },
    {
      take: 'length',
      title: 'Ellipse',
      label: 'Somme des distances aux deux foyers (grand axe)',
      initial: ([f1, f2]) => dist(f1 as Pt, f2 as Pt) * 1.5,
      hint: ([f1, f2], u) => `Distance entre les foyers : ${u.len(dist(f1 as Pt, f2 as Pt))}. La somme doit être plus grande.`,
    },
  ],
  build: ([f1, f2, dSum]) => {
    if ((dSum as number) <= dist(f1 as Pt, f2 as Pt)) {
      return fail('La somme des distances doit être plus grande que la distance entre les deux foyers.', true);
    }
    return ok([{ kind: 'ellipse', f1: f1 as Pt, f2: f2 as Pt, dSum: dSum as number }], mid(f1 as Pt, f2 as Pt));
  },
  draft: ({ r }, [a, b]) => {
    if (b) guideLine(r, a as Pt, b as Pt);
  },
};

const circleRadius: Recipe = {
  id: 'circleRadius',
  label: 'cercle',
  steps: [
    { take: 'point', tip: 'Cercle de rayon donné : cliquez le centre.' },
    {
      take: 'length',
      title: 'Cercle de rayon donné',
      label: 'Rayon',
      hint: (_, u) => (u.scaled ? undefined : 'L\'échelle de la carte n\'est pas définie : le rayon est en pixels.'),
    },
  ],
  build: ([c, r]) => ok([circle(c as Pt, r as number)], c as Pt),
};

/* ---------------------------------------------- on a reference item */

const LINES: ItemKind[] = ['segment', 'line'];

function parallelThrough(ref: SegmentItem | LineItem, p: Pt): Seg {
  const s = railOf(ref);
  return seg(p, add(p, pt(dx(s), dy(s))));
}

function perpendicularThrough(ref: SegmentItem | LineItem, p: Pt): Seg {
  const s = railOf(ref);
  return translated(normalVector(seg(pt(0, 0), pt(dx(s), dy(s)))), p);
}

const parallel: Recipe = {
  id: 'parallel',
  label: 'parallèle',
  keep: 1,
  preselect: 1,
  steps: [
    { take: 'item', kinds: LINES, tip: 'Parallèle : sélectionnez la droite de référence.' },
    { take: 'point', tip: 'Parallèle : cliquez un point de passage.' },
  ],
  build: ([ref, p]) => {
    const s = parallelThrough(ref as SegmentItem | LineItem, p as Pt);
    return ok(lineThrough(s.p1, s.p2));
  },
};

const perpendicular: Recipe = {
  id: 'perpendicular',
  label: 'perpendiculaire',
  keep: 1,
  preselect: 1,
  steps: [
    { take: 'item', kinds: LINES, tip: 'Perpendiculaire : sélectionnez la droite de référence.' },
    { take: 'point', tip: 'Perpendiculaire : cliquez un point de passage.' },
  ],
  build: ([ref, p]) => {
    const s = perpendicularThrough(ref as SegmentItem | LineItem, p as Pt);
    return ok(lineThrough(s.p1, s.p2));
  },
  draft: ({ r }, [ref, p]) => {
    const l = ref as SegmentItem | LineItem;
    r.point(projectOnLine(p as Pt, l.p1, l.p2), '#ffd400', 6);
  },
};

const bisection: Recipe = {
  id: 'bisection',
  label: 'médiatrice',
  keep: 1,
  preselect: 1,
  again: 'Médiatrice : sélectionnez un autre segment.',
  steps: [{ take: 'item', kinds: ['segment'], tip: 'Médiatrice : sélectionnez un segment.' }],
  build: ([ref]) => {
    const s = ref as SegmentItem;
    if (samePt(s.p1, s.p2)) return none;
    const n = normalVector(seg(segCenter(railOf(s)), s.p2));
    return ok(lineThrough(n.p1, n.p2));
  },
};

const tangent: Recipe = {
  id: 'tangent',
  label: 'tangentes',
  keep: 1,
  preselect: 1,
  steps: [
    { take: 'item', kinds: ['circle'], tip: 'Tangentes : sélectionnez le cercle de référence.' },
    { take: 'point', tip: 'Tangentes : cliquez un point extérieur au cercle.' },
  ],
  build: ([ref, p]) => {
    const c = ref as CircleItem;
    const t = tangencyPoints(c.c, c.r, p as Pt);
    if (!t) return fail('Le point doit être à l\'extérieur du cercle.', true);
    return ok(t.flatMap((q) => lineThrough(p as Pt, q)));
  },
  draft: ({ r }, [ref, p]) => {
    const c = ref as CircleItem;
    for (const q of tangencyPoints(c.c, c.r, p as Pt) ?? []) r.point(q, '#ffd400', 6);
  },
};

/** The end of the segment closest to p. */
const closestEnd = (s: SegmentItem, p: Pt): Pt => (dist(s.p1, p) < dist(s.p2, p) ? s.p1 : s.p2);

const circleFromRadius: Recipe = {
  id: 'circleFromRadius',
  label: 'cercle',
  preselect: 1,
  steps: [
    { take: 'item', kinds: ['segment'], tip: 'Cercle : sélectionnez un segment (le rayon).' },
    { take: 'point', tip: 'Cercle : cliquez près de l\'extrémité qui sera le centre.' },
  ],
  build: ([ref, p]) => {
    const s = ref as SegmentItem;
    const c = closestEnd(s, p as Pt);
    return ok([circle(c, dist(s.p1, s.p2))], c);
  },
};

const circleFromDiameter: Recipe = {
  id: 'circleFromDiameter',
  label: 'cercle',
  keep: 1,
  preselect: 1,
  again: 'Cercle : sélectionnez un autre segment.',
  steps: [{ take: 'item', kinds: ['segment'], tip: 'Cercle : sélectionnez un segment (le diamètre).' }],
  build: ([ref]) => {
    const s = ref as SegmentItem;
    if (samePt(s.p1, s.p2)) return none;
    const c = mid(s.p1, s.p2);
    return ok([circle(c, dist(s.p1, s.p2) / 2)], c);
  },
};

/** Cut an arc out of a circle: the circle is replaced by the arc. */
const arcFromCircle: Recipe = {
  id: 'arcFromCircle',
  label: 'arc',
  preselect: 1,
  previewStyle: 'bold',
  steps: [
    { take: 'item', kinds: ['circle'], tip: 'Arc : sélectionnez un cercle à découper.' },
    {
      take: 'point',
      raw: true,
      tip: 'Arc : cliquez la première extrémité.',
      refuse: (p, [ref]) => (samePt(p, (ref as CircleItem).c) ? '' : undefined),
    },
    {
      take: 'angle',
      tip: 'Arc : cliquez la seconde extrémité.',
      side: ([ref, first]) => seg((ref as CircleItem).c, first as Pt),
      live: (span) => `Arc : ${deg(span)} — cliquez la seconde extrémité.`,
    },
  ],
  build: ([ref, first, span]) => {
    const c = ref as CircleItem;
    if (Math.abs(span as number) < 0.5) return none;
    return ok([{ kind: 'arc', c: c.c, r: c.r, start: angleOf(seg(c.c, first as Pt)), span: span as number }], c.c, [c]);
  },
  draft: ({ r, mouse }, [ref, first, span]) => {
    const c = (ref as CircleItem).c;
    const dir = (q: Pt) => withLength(seg(c, q), (ref as CircleItem).r * 1.15).p2;
    if (typeof span === 'number') guideLine(r, c, dir(first as Pt));
    if (!samePt(mouse, c)) guideLine(r, c, dir(mouse));
  },
};

/** Projection of p on the reference line, kept within its ends. */
function onRail(ref: SegmentItem | LineItem, p: Pt): Pt {
  const s = railOf(ref);
  const v = sub(s.p2, s.p1);
  const l2 = dot(v, v);
  if (l2 === 0) return s.p1;
  const t = Math.max(0, Math.min(1, dot(sub(p, s.p1), v) / l2));
  return add(s.p1, mul(v, t));
}

/** First side of the angle: from the vertex along the reference. */
function referenceSide(ref: SegmentItem | LineItem, vertex: Pt): Seg {
  return seg(vertex, withLength(railOf(ref), segLength(railOf(ref)) + 1).p2);
}

/** A line making a given angle with a reference line. */
const angleLine: Recipe = {
  id: 'angleLine',
  label: 'droite à angle',
  preselect: 1,
  steps: [
    { take: 'item', kinds: LINES, tip: 'Angle : sélectionnez la droite de référence.' },
    {
      take: 'point',
      raw: true,
      tip: 'Angle : cliquez le sommet de l\'angle sur la droite.',
      onto: (p, [ref]) => onRail(ref as SegmentItem | LineItem, p),
    },
    {
      take: 'angle',
      tip: 'Angle : orientez la droite puis cliquez (ou [Entrée] pour saisir l\'angle).',
      side: ([ref, c]) => referenceSide(ref as SegmentItem | LineItem, c as Pt),
      live: (span) => `Angle : ${deg(span)} — cliquez pour tracer, ou [Entrée] pour saisir l'angle.`,
      prompt: {
        title: 'Droite à angle',
        label: 'Angle avec la droite de référence (sens anti-horaire)',
        initial: (span) => Math.round(Math.abs(span) * 10) / 10,
      },
    },
  ],
  build: ([ref, c, span]) => {
    const side = referenceSide(ref as SegmentItem | LineItem, c as Pt);
    return ok(lineThrough(c as Pt, polar(c as Pt, 100, angleOf(side) + (span as number))));
  },
  draft: ({ r, width, zoom }, [ref, c, span]) => {
    if (typeof span === 'number') {
      r.arc(c as Pt, 80 / zoom, angleOf(referenceSide(ref as SegmentItem | LineItem, c as Pt)), span, { color: '#ffd400', width: 3 });
    }
    r.point(c as Pt, '#000', width + 3);
    if (typeof span === 'number') r.text(c as Pt, deg(span), { dx: 10, dy: -10, size: 18, bold: true });
  },
};

/* ------------------------------------------------------------ directions */

/** Far enough to cross the whole map, like the desktop lines. */
const RAY = 2 * LINE_EXTENT;

/** A half-line: a segment from p, far away in the direction (dx, dy). */
function ray(p: Pt, d: Pt): Shape[] {
  const n = Math.hypot(d.x, d.y);
  return n ? [{ kind: 'segment', p1: p, p2: add(p, mul(d, RAY / n)) }] : [];
}

/** Direction of an azimuth on the sheet (degrees clockwise from the top). */
const azimuthVector = (az: number): Pt => pt(Math.sin((az * Math.PI) / 180), -Math.cos((az * Math.PI) / 180));

const halfLine: Recipe = {
  id: 'halfLine',
  label: 'demi-droite',
  markers: true,
  steps: [
    { take: 'point', tip: 'Demi-droite : cliquez son origine.' },
    { take: 'point', tip: 'Demi-droite : cliquez un point de sa direction.', refuse: (p, [a]) => (samePt(p, a as Pt) ? '' : undefined) },
  ],
  build: ([a, b]) => ok(ray(a as Pt, sub(b as Pt, a as Pt))),
};

const extension: Recipe = {
  id: 'extension',
  label: 'prolongement',
  markers: true,
  steps: [
    { take: 'point', tip: 'Prolongement de A→B : cliquez A.' },
    { take: 'point', tip: 'Prolongement de A→B : cliquez B, d\'où part le prolongement.', refuse: (p, [a]) => (samePt(p, a as Pt) ? '' : undefined) },
  ],
  build: ([a, b]) => ok(ray(b as Pt, sub(b as Pt, a as Pt))),
};

const azimuthRay: Recipe = {
  id: 'azimuthRay',
  label: 'direction',
  keep: 1,
  steps: [
    { take: 'point', tip: 'Direction : cliquez son origine.' },
    { take: 'azimuth', title: 'Direction', label: 'Azimut ou point cardinal' },
  ],
  again: 'Direction : une autre direction depuis le même point ([Échap] pour changer de point).',
  build: ([a, az]) => ok(ray(a as Pt, azimuthVector(az as number))),
};

const azimuthLine: Recipe = {
  id: 'azimuthLine',
  label: 'droite d\'azimut',
  keep: 1,
  steps: [
    { take: 'point', tip: 'Droite d\'azimut : cliquez un point de passage.' },
    { take: 'azimuth', title: 'Droite d\'azimut', label: 'Azimut ou point cardinal' },
  ],
  again: 'Droite d\'azimut : une autre depuis le même point ([Échap] pour changer de point).',
  build: ([a, az]) => ok(lineThrough(a as Pt, add(a as Pt, azimuthVector(az as number)))),
};

/** A distance carried along a line, from a point, in a sense: a point and the segment that leads to it. */
const carry: Recipe = {
  id: 'carry',
  label: 'report de distance',
  preselect: 1,
  steps: [
    { take: 'item', kinds: LINES, tip: 'Report : sélectionnez la droite le long de laquelle reporter.' },
    { take: 'point', tip: 'Report : cliquez le point de départ (sur la droite).', onto: (p, [ref]) => projectOnLine(p, (ref as LineItem).p1, (ref as LineItem).p2) },
    {
      take: 'point', raw: true, tip: 'Report : cliquez de quel côté reporter.',
      onto: (p, [ref]) => projectOnLine(p, (ref as LineItem).p1, (ref as LineItem).p2),
      refuse: (p, [, a]) => (samePt(p, a as Pt) ? '' : undefined),
    },
    { take: 'length', title: 'Report de distance', label: 'Distance à reporter' },
  ],
  build: ([, a, side, len]) => {
    const d = sub(side as Pt, a as Pt);
    const n = Math.hypot(d.x, d.y);
    if (!n) return fail('Le côté du report doit être différent du point de départ.');
    const end = add(a as Pt, mul(d, (len as number) / n));
    return ok([{ kind: 'segment', p1: a as Pt, p2: end }, { kind: 'point', p: end, weight: 0 }]);
  },
  draft: ({ r }, [, a]) => {
    if (a) r.point(a as Pt, '#ffd400', 7);
  },
};

/** The center (centroid) of 3 points. */
const centroid: Recipe = {
  id: 'centroid',
  label: 'centre de 3 points',
  markers: true,
  preselect: 3,
  steps: [
    { take: 'point', tip: 'Centre : cliquez un premier point.' },
    { take: 'point', tip: 'Centre : cliquez un deuxième point.' },
    { take: 'point', tip: 'Centre : cliquez le troisième point.' },
  ],
  build: ([a, b, c]) => {
    const [p, q, r] = [a, b, c] as Pt[];
    return ok([{ kind: 'point', p: pt((p.x + q.x + r.x) / 3, (p.y + q.y + r.y) / 3), weight: 0 }]);
  },
};

/* ------------------------------------------------------------------- arc */

const arc: Recipe = {
  id: 'arc',
  label: 'arc',
  previewStyle: 'solid',
  steps: [
    { take: 'point', tip: 'Arc : cliquez le centre.' },
    {
      take: 'point',
      tip: 'Arc : cliquez le point de départ.',
      refuse: (p, [c]) => (samePt(p, c as Pt) ? 'Le centre et le point de départ doivent être différents !' : undefined),
    },
    {
      take: 'angle',
      tip: 'Arc : cliquez pour fixer l\'angle (ou [Entrée] pour le saisir).',
      side: ([c, first]) => seg(c as Pt, first as Pt),
      live: (span) => `Arc : ${deg(span)} — cliquez pour fixer l'angle (ou [Entrée] pour le saisir).`,
      prompt: {
        title: 'Arc',
        label: 'Angle de l\'arc (positif : sens anti-horaire)',
        initial: (span) => Math.round(span * 10) / 10,
      },
    },
  ],
  build: ([c, first, span]) => {
    const s = seg(c as Pt, first as Pt);
    const a = span as number;
    if (Math.abs(a) < 0.5) return none;
    if (360 - Math.abs(a) < 1) return ok([circle(c as Pt, segLength(s))], c as Pt);
    return ok([{ kind: 'arc', c: c as Pt, r: segLength(s), start: angleOf(s), span: a }], c as Pt);
  },
  draft: ({ r, mouse, style }, [c, first, span]) => {
    const o = c as Pt;
    if (!first) return;
    if (typeof span !== 'number') {
      guideLine(r, o, first as Pt);
      r.circle(o, dist(o, first as Pt), { ...style, dash: [8, 6], alpha: 0.3 });
      return;
    }
    const R = dist(o, first as Pt);
    guideLine(r, o, first as Pt);
    if (!samePt(mouse, o)) guideLine(r, o, withLength(seg(o, mouse), R).p2);
    r.text(o, deg(span), { dx: 10, dy: -10, size: 18, bold: true });
  },
};

/* ---------------------------------------------------------------- spiral */

export interface SpiralOptions {
  oneItem: boolean;
  showBase: boolean;
  centersOnly: boolean;
}

/** The figure of a 4 centers spiral, given its base (see shapes.completeSpiralBase). */
export function spiralShapes(base: Seg[], opts: SpiralOptions): Shape[] {
  const centers = [base[0].p1, base[1].p1, base[2].p1, base[2].p2] as [Pt, Pt, Pt, Pt];
  const shapes: Shape[] = [];
  if (opts.oneItem) shapes.push({ kind: 'spiral', centers });
  else for (const g of spiralArcs(centers)) shapes.push({ kind: 'arc', c: g.c, r: g.r, start: g.start, span: g.span });
  if (opts.showBase) {
    if (opts.centersOnly) for (const c of centers) shapes.push({ kind: 'point', p: c, weight: 0 });
    else for (const sd of base) shapes.push({ kind: 'segment', p1: sd.p1, p2: sd.p2 });
  }
  return shapes;
}

export const RECIPES = {
  segment,
  line,
  horizontal,
  vertical,
  parallel,
  perpendicular,
  bisection,
  angleLine,
  tangent,
  circleCenter,
  circleFromRadius,
  circleRadius,
  circleDiameter,
  circleFromDiameter,
  circle3,
  ellipse,
  arcFromCircle,
  arc,
  halfLine,
  extension,
  azimuthRay,
  azimuthLine,
  carry,
  centroid,
} satisfies Record<string, Recipe>;
