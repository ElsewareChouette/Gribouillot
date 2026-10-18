/**
 * Drawing tools. Each tool is a small state machine fed with the clicks and
 * moves of the user; it shows its next step in the status bar ("drawing tips")
 * and draws a live preview of the figure being built.
 *
 * The geometry is a port of the desktop version (gribouillot_toolbar.cpp,
 * gribouillotlayer.cpp and the Item_*Drawer helpers).
 */

import type { App } from './app';
import {
  angleOf,
  circumcenter,
  deg2rad,
  dist,
  dx,
  dy,
  extendLine,
  mid,
  normalVector,
  polar,
  projectOnLine,
  pt,
  samePt,
  seg,
  segCenter,
  segLength,
  sub,
  add,
  mul,
  dot,
  tangencyPoints,
  translated,
  withLength,
  type Pt,
  type Seg,
} from './geom';
import type { Item, ItemKind, LineItem, SegmentItem, CircleItem } from './model';
import type { Renderer } from './render';
import { ArcSpanTracker, completeSpiralBase, spiralArcRadius, spiralArcAngles, spiralArcs } from './shapes';
import { fmt } from './ui/dom';
import { alertDialog, promptNumber } from './ui/dialogs';

export interface ToolEvent {
  p: Pt; // scene position, snapped on a point if the mouse is over one
  raw: Pt; // scene position of the mouse
  screen: Pt;
  shift: boolean;
  ctrl: boolean;
}

export abstract class Tool {
  abstract readonly id: ToolId;
  cursor = 'crosshair';
  /** The tool adds items: it needs a current layer. */
  draws = true;
  /** Mouse position, for previews. */
  protected mouse: Pt | null = null;
  protected shift = false;

  start(_app: App): void {}
  click(_app: App, _e: ToolEvent): void {}
  move(_app: App, e: ToolEvent): void {
    this.mouse = e.p;
    this.shift = e.shift;
  }
  /** Return true if the key was used. */
  key(_app: App, _e: KeyboardEvent): boolean {
    return false;
  }
  overlay(_r: Renderer, _app: App): void {}
  /** Reset to the first step (Escape key). */
  reset(app: App): void {
    this.mouse = null;
    this.start(app);
  }
}

const PREVIEW_DASH = [8, 6];
const preview = (app: App, dash = PREVIEW_DASH) => ({ color: app.project!.color, width: Math.max(1, app.project!.width - 1), dash, alpha: 0.8 });
const GUIDE = { color: '#ffd400', width: 3, dash: [3, 4] };
const GUIDE_DARK = { color: '#222', width: 1, dash: [3, 4] };

function guideLine(r: Renderer, a: Pt, b: Pt): void {
  r.line(a, b, GUIDE);
  r.line(a, b, GUIDE_DARK);
}

/** Rail of a line or a segment item. */
const railOf = (it: SegmentItem | LineItem): Seg => seg(it.p1, it.p2);

/* -------------------------------------------------------------- select */

export class SelectTool extends Tool {
  readonly id = 'select';
  cursor = 'default';
  draws = false;

  start(app: App): void {
    app.status('');
  }

  click(app: App, e: ToolEvent): void {
    const hit = app.pick(e.screen);
    if (!hit) {
      if (!e.ctrl && !e.shift) app.setSelection([]);
      return;
    }
    if (e.ctrl || e.shift) app.toggleSelection(hit.item.id);
    else app.setSelection([hit.item.id]);
  }
}

export class PanTool extends Tool {
  readonly id = 'pan';
  cursor = 'grab';
  draws = false;

  start(app: App): void {
    app.status('Astuce : on peut aussi se déplacer avec n\'importe quel outil en glissant, ou avec le bouton du milieu.');
  }
}

/* ------------------------------------------------------- measuring tape */

export class MeasureTool extends Tool {
  readonly id: ToolId = 'measure';
  draws = false;
  protected origin: Pt | null = null;
  protected end: Pt | null = null;

  start(app: App): void {
    this.origin = this.end = null;
    app.status('Mesure : cliquez le point de départ.');
  }

  click(app: App, e: ToolEvent): void {
    if (!this.origin || this.end) {
      this.origin = e.p;
      this.end = null;
      app.status('Mesure : cliquez le point d\'arrivée.');
    } else {
      this.end = e.p;
      this.done(app, this.origin, this.end);
    }
  }

  protected done(app: App, a: Pt, b: Pt): void {
    app.status(`Distance : ${app.formatLength(dist(a, b), 2)} — cliquez pour une nouvelle mesure.`);
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.origin && !this.end) app.status(`Distance : ${app.formatLength(dist(this.origin, e.p), 2)}`);
  }

  overlay(r: Renderer, app: App): void {
    const b = this.end ?? this.mouse;
    if (!this.origin || !b) return;
    guideLine(r, this.origin, b);
    r.text(mid(this.origin, b), app.formatLength(dist(this.origin, b), 2), { dx: 8, dy: -8, bold: true });
  }
}

/** Measure a known distance on the map to set the scale. */
export class CalibrateTool extends MeasureTool {
  readonly id = 'calibrate';

  start(app: App): void {
    this.origin = this.end = null;
    app.status('Échelle : cliquez une extrémité d\'une distance connue (ex. l\'échelle graphique de la carte).');
  }

  protected done(app: App, a: Pt, b: Pt): void {
    const px = Math.round(dist(a, b) * 100) / 100;
    void app.calibrate(px);
  }

  overlay(r: Renderer): void {
    const b = this.end ?? this.mouse;
    if (!this.origin || !b) return;
    guideLine(r, this.origin, b);
    r.text(mid(this.origin, b), `${fmt(dist(this.origin, b), 1)} px`, { dx: 8, dy: -8, bold: true });
  }
}

/* ---------------------------------------------------------- protractor */

export class ProtractorTool extends Tool {
  readonly id = 'protractor';
  draws = false;
  private center: Pt | null = null;
  private first: Seg | null = null; // first side of the angle, from the center
  private tracker = new ArcSpanTracker();

  start(app: App): void {
    this.center = this.first = null;
    this.tracker = new ArcSpanTracker();
    app.status('Rapporteur : cliquez le sommet de l\'angle, ou une droite comme premier côté.');
  }

  click(app: App, e: ToolEvent): void {
    if (this.first) {
      this.start(app); // a click ends the measure
      return;
    }
    if (!this.center) {
      const hit = app.pick(e.screen, ['segment', 'line']);
      if (hit && !app.isOnPoint(e.screen)) {
        const it = hit.item as SegmentItem | LineItem;
        // Center = foot of the perpendicular from the click on the line.
        this.center = projectOnLine(e.raw, it.p1, it.p2);
        const far = withLength(railOf(it), segLength(railOf(it)) + 1).p2;
        this.first = seg(this.center, samePt(far, this.center) ? it.p1 : far);
        app.status('Rapporteur : orientez le second côté.');
        return;
      }
      this.center = e.p;
      app.status('Rapporteur : cliquez un point du premier côté.');
      return;
    }
    if (!samePt(this.center, e.p)) {
      this.first = seg(this.center, e.p);
      app.status('Rapporteur : orientez le second côté.');
    }
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.center && this.first && !samePt(this.center, e.raw)) {
      const span = this.tracker.update(this.first, seg(this.center, e.raw));
      const a = Math.abs(span);
      app.status(`Angle : ${fmt(a, 2)}° / ${fmt(deg2rad(a), 4)} rad (supplémentaire ${fmt(180 - Math.min(a, 360 - a), 2)}°)`);
    }
  }

  overlay(r: Renderer, app: App): void {
    if (!this.center || !this.mouse) return;
    const c = this.center;
    const len = Math.max(80 / app.cam.zoom, 1);
    if (!this.first) {
      guideLine(r, c, this.mouse);
      return;
    }
    const firstEnd = withLength(this.first, Math.max(len * 1.5, segLength(this.first))).p2;
    guideLine(r, c, firstEnd);
    guideLine(r, c, this.mouse);
    const start = angleOf(this.first);
    r.arc(c, len, start, this.tracker.span, { color: '#ffd400', width: 3 });
    r.text(c, `${fmt(Math.abs(this.tracker.span), 1)}°`, { dx: 10, dy: -10, size: 18, bold: true });
  }
}

/* --------------------------------------------------------------- point */

export class PointTool extends Tool {
  readonly id = 'point';

  start(app: App): void {
    app.status('Point : cliquez une position.');
  }

  click(app: App, e: ToolEvent): void {
    void app.addPoint(e.p);
  }
}

/* ------------------------------------------------- multi-click figures */

abstract class PointsTool extends Tool {
  protected pts: Pt[] = [];
  abstract readonly tips: string[];

  start(app: App): void {
    this.pts = [];
    app.status(this.tips[0]);
  }

  click(app: App, e: ToolEvent): void {
    this.pts.push(e.p);
    if (this.pts.length < this.tips.length) {
      app.status(this.tips[this.pts.length]);
      return;
    }
    const pts = this.pts;
    this.start(app);
    void this.finish(app, pts);
  }

  protected abstract finish(app: App, pts: Pt[]): void | Promise<void>;
  protected abstract draft(r: Renderer, app: App, pts: Pt[]): void;

  overlay(r: Renderer, app: App): void {
    if (!this.pts.length || !this.mouse) return;
    for (const q of this.pts) r.point(q, app.project!.color, 5, 0.8);
    this.draft(r, app, [...this.pts, this.mouse]);
  }
}

export class SegmentTool extends PointsTool {
  readonly id = 'segment';
  readonly tips = ['Segment : cliquez une première extrémité.', 'Segment : cliquez l\'autre extrémité.'];

  protected finish(app: App, [a, b]: Pt[]): void {
    if (samePt(a, b)) return;
    app.addItems([{ kind: 'segment', ...app.stroke(), p1: a, p2: b }], 'segment');
  }

  protected draft(r: Renderer, app: App, [a, b]: Pt[]): void {
    r.line(a, b, preview(app));
    r.text(mid(a, b), app.formatLength(dist(a, b)), { dx: 8, dy: -8 });
  }
}

export class LineTool extends PointsTool {
  readonly id = 'line';
  readonly tips = ['Droite : cliquez un premier point.', 'Droite : cliquez un second point.'];

  protected finish(app: App, [a, b]: Pt[]): void {
    const l = app.lineThrough(a, b);
    if (l) app.addItems([l], 'droite');
  }

  protected draft(r: Renderer, app: App, [a, b]: Pt[]): void {
    const s = extendLine(a, b);
    if (s) r.line(s.p1, s.p2, preview(app));
  }
}

export class CircleCenterTool extends PointsTool {
  readonly id = 'circleCenter';
  readonly tips = ['Cercle : cliquez le centre.', 'Cercle : cliquez un point de la circonférence.'];

  protected finish(app: App, [c, b]: Pt[]): void {
    if (samePt(c, b)) return;
    app.addItems([{ kind: 'circle', ...app.stroke(), c, r: dist(c, b) }], 'cercle', c);
  }

  protected draft(r: Renderer, app: App, [c, b]: Pt[]): void {
    r.circle(c, dist(c, b), preview(app));
    guideLine(r, c, b);
    r.text(mid(c, b), `r = ${app.formatLength(dist(c, b))}`, { dx: 8, dy: -8 });
  }
}

export class CircleDiameterTool extends PointsTool {
  readonly id = 'circleDiameter';
  readonly tips = ['Cercle : cliquez une extrémité du diamètre.', 'Cercle : cliquez l\'autre extrémité du diamètre.'];

  protected finish(app: App, [a, b]: Pt[]): void {
    if (samePt(a, b)) return;
    const c = mid(a, b);
    app.addItems([{ kind: 'circle', ...app.stroke(), c, r: dist(a, b) / 2 }], 'cercle', c);
  }

  protected draft(r: Renderer, app: App, [a, b]: Pt[]): void {
    r.circle(mid(a, b), dist(a, b) / 2, preview(app));
    guideLine(r, a, b);
  }
}

export class Circle3Tool extends PointsTool {
  readonly id = 'circle3';
  readonly tips = [
    'Cercle : cliquez un premier point de la circonférence.',
    'Cercle : cliquez un deuxième point de la circonférence.',
    'Cercle : cliquez un troisième point de la circonférence.',
  ];

  start(app: App): void {
    // 3 points already selected: draw immediately.
    const sel = app.selectedItems().filter((h) => h.item.kind === 'point');
    if (app.previousToolId === 'select' && sel.length === 3 && app.selection.size === 3) {
      const [a, b, c] = sel.map((h) => (h.item as { p: Pt }).p);
      app.setSelection([]);
      this.finish(app, [a, b, c]);
    }
    super.start(app);
  }

  protected finish(app: App, [a, b, c]: Pt[]): void {
    const o = circumcenter(a, b, c);
    if (!o) {
      app.status('Les 3 points doivent être distincts et non alignés.');
      return;
    }
    app.addItems([{ kind: 'circle', ...app.stroke(), c: o, r: dist(o, a) }], 'cercle', o);
  }

  protected draft(r: Renderer, app: App, pts: Pt[]): void {
    if (pts.length === 2) r.line(pts[0], pts[1], GUIDE_DARK);
    if (pts.length === 3) {
      const o = circumcenter(pts[0], pts[1], pts[2]);
      if (o) r.circle(o, dist(o, pts[0]), preview(app));
    }
  }
}

export class EllipseTool extends PointsTool {
  readonly id = 'ellipse';
  readonly tips = ['Ellipse : cliquez un premier foyer.', 'Ellipse : cliquez le second foyer.'];

  protected async finish(app: App, [f1, f2]: Pt[]): Promise<void> {
    const focal = dist(f1, f2);
    const k = app.unitPerPx();
    const unit = k ? app.project!.scale.unit : 'px';
    const v = await promptNumber(
      'Ellipse',
      'Somme des distances aux deux foyers (grand axe)',
      Math.round(focal * 1.5 * (k || 1) * 100) / 100,
      { min: 0, unit, hint: `Distance entre les foyers : ${fmt(focal * (k || 1), 2)} ${unit}. La somme doit être plus grande.` },
    );
    if (v === null || v <= 0) return;
    const dSum = k ? v / k : v;
    if (dSum <= focal) {
      await alertDialog('Tracé impossible', 'La somme des distances doit être plus grande que la distance entre les deux foyers.');
      return;
    }
    app.addItems([{ kind: 'ellipse', ...app.stroke(), f1, f2, dSum }], 'ellipse', mid(f1, f2));
  }

  protected draft(r: Renderer, _app: App, [a, b]: Pt[]): void {
    guideLine(r, a, b);
  }
}

/* ----------------------------------------------------- one-click lines */

export class HorizontalTool extends Tool {
  readonly id = 'horizontal';
  start(app: App): void {
    app.status('Horizontale : cliquez un point de passage.');
  }
  click(app: App, e: ToolEvent): void {
    const l = app.lineThrough(e.p, add(e.p, pt(1, 0)));
    if (l) app.addItems([l], 'horizontale');
  }
  overlay(r: Renderer, app: App): void {
    if (this.mouse) r.line(pt(-5e4, this.mouse.y), pt(5e4, this.mouse.y), preview(app));
  }
}

export class VerticalTool extends Tool {
  readonly id = 'vertical';
  start(app: App): void {
    app.status('Verticale : cliquez un point de passage.');
  }
  click(app: App, e: ToolEvent): void {
    const l = app.lineThrough(e.p, add(e.p, pt(0, 1)));
    if (l) app.addItems([l], 'verticale');
  }
  overlay(r: Renderer, app: App): void {
    if (this.mouse) r.line(pt(this.mouse.x, -5e4), pt(this.mouse.x, 5e4), preview(app));
  }
}

export class CircleRadiusValueTool extends Tool {
  readonly id = 'circleRadius';
  private lastRadius: number | null = null;

  start(app: App): void {
    app.status('Cercle de rayon donné : cliquez le centre.');
  }

  click(app: App, e: ToolEvent): void {
    void this.ask(app, e.p);
  }

  private async ask(app: App, c: Pt): Promise<void> {
    const k = app.unitPerPx();
    const unit = k ? app.project!.scale.unit : 'px';
    const v = await promptNumber('Cercle de rayon donné', 'Rayon', this.lastRadius ?? 1, {
      min: 0,
      unit,
      hint: k ? undefined : 'L\'échelle de la carte n\'est pas définie : le rayon est en pixels.',
    });
    if (v === null || v <= 0) return;
    this.lastRadius = v;
    app.addItems([{ kind: 'circle', ...app.stroke(), c, r: k ? v / k : v }], 'cercle', c);
  }
}

/* ------------------------------------------- tools on a reference item */

/**
 * A tool which first needs the user to pick a reference item (a line, a
 * circle...). The reference stays selected until another eligible item is
 * clicked, so several figures can be built on it in a row.
 */
abstract class RefTool<T extends Item> extends Tool {
  protected ref: T | null = null;
  abstract readonly kinds: ItemKind[];
  abstract readonly tips: [string, string];

  start(app: App): void {
    this.ref = null;
    // An item selected beforehand with the selection tool is taken as reference.
    const sel = app.selectedItems();
    if (app.previousToolId === 'select' && sel.length === 1 && this.kinds.includes(sel[0].item.kind)) this.setRef(app, sel[0].item as T);
    else {
      app.setSelection([]);
      app.status(this.tips[0]);
    }
  }

  protected setRef(app: App, item: T): void {
    this.ref = item;
    app.setSelection([item.id]);
    app.status(this.tips[1]);
    this.refChosen(app, item);
  }

  /** Called once the reference is known; may draw right away. */
  protected refChosen(_app: App, _ref: T): void {}

  protected abstract use(app: App, ref: T, e: ToolEvent): void;

  click(app: App, e: ToolEvent): void {
    const hit = app.isOnPoint(e.screen) ? null : app.pick(e.screen, this.kinds);
    if (hit && (!this.ref || hit.item.id !== this.ref.id)) {
      this.setRef(app, hit.item as T);
      return;
    }
    if (!this.ref) {
      app.status(`${this.tips[0]} (aucun élément adapté sous le curseur)`);
      return;
    }
    // The reference may have been deleted or changed meanwhile.
    const current = app.findItem(this.ref.id);
    if (!current) {
      this.start(app);
      return;
    }
    this.ref = current.item as T;
    this.use(app, this.ref, e);
  }
}

export class ParallelTool extends RefTool<SegmentItem | LineItem> {
  readonly id = 'parallel';
  readonly kinds: ItemKind[] = ['segment', 'line'];
  readonly tips: [string, string] = ['Parallèle : sélectionnez la droite de référence.', 'Parallèle : cliquez un point de passage.'];

  private through(ref: SegmentItem | LineItem, p: Pt): Seg {
    const s = railOf(ref);
    return seg(p, add(p, pt(dx(s), dy(s))));
  }

  protected use(app: App, ref: SegmentItem | LineItem, e: ToolEvent): void {
    const s = this.through(ref, e.p);
    const l = app.lineThrough(s.p1, s.p2);
    if (l) app.addItems([l], 'parallèle');
  }

  overlay(r: Renderer, app: App): void {
    if (!this.ref || !this.mouse) return;
    const s = this.through(this.ref, this.mouse);
    const l = extendLine(s.p1, s.p2);
    if (l) r.line(l.p1, l.p2, preview(app));
  }
}

export class PerpendicularTool extends RefTool<SegmentItem | LineItem> {
  readonly id = 'perpendicular';
  readonly kinds: ItemKind[] = ['segment', 'line'];
  readonly tips: [string, string] = ['Perpendiculaire : sélectionnez la droite de référence.', 'Perpendiculaire : cliquez un point de passage.'];

  private through(ref: SegmentItem | LineItem, p: Pt): Seg {
    const s = railOf(ref);
    return translated(normalVector(seg(pt(0, 0), pt(dx(s), dy(s)))), p);
  }

  protected use(app: App, ref: SegmentItem | LineItem, e: ToolEvent): void {
    const s = this.through(ref, e.p);
    const l = app.lineThrough(s.p1, s.p2);
    if (l) app.addItems([l], 'perpendiculaire');
  }

  overlay(r: Renderer, app: App): void {
    if (!this.ref || !this.mouse) return;
    const s = this.through(this.ref, this.mouse);
    const l = extendLine(s.p1, s.p2);
    if (l) r.line(l.p1, l.p2, preview(app));
    const foot = projectOnLine(this.mouse, this.ref.p1, this.ref.p2);
    r.point(foot, '#ffd400', 6);
  }
}

export class BisectionTool extends RefTool<SegmentItem> {
  readonly id = 'bisection';
  readonly kinds: ItemKind[] = ['segment'];
  readonly tips: [string, string] = ['Médiatrice : sélectionnez un segment.', 'Médiatrice : sélectionnez un autre segment.'];

  protected refChosen(app: App, ref: SegmentItem): void {
    if (samePt(ref.p1, ref.p2)) return;
    const half = seg(segCenter(railOf(ref)), ref.p2);
    const n = normalVector(half);
    const l = app.lineThrough(n.p1, n.p2);
    if (l) app.addItems([l], 'médiatrice');
  }

  protected use(): void {}
}

export class TangentTool extends RefTool<CircleItem> {
  readonly id = 'tangent';
  readonly kinds: ItemKind[] = ['circle'];
  readonly tips: [string, string] = ['Tangentes : sélectionnez le cercle de référence.', 'Tangentes : cliquez un point extérieur au cercle.'];

  protected use(app: App, ref: CircleItem, e: ToolEvent): void {
    const t = tangencyPoints(ref.c, ref.r, e.p);
    if (!t) {
      void alertDialog('Tracé impossible', 'Le point doit être à l\'extérieur du cercle.');
      return;
    }
    const lines = t.map((q) => app.lineThrough(e.p, q)).filter((l): l is LineItem => l !== null);
    app.addItems(lines, 'tangentes');
  }

  overlay(r: Renderer, app: App): void {
    if (!this.ref || !this.mouse) return;
    const t = tangencyPoints(this.ref.c, this.ref.r, this.mouse);
    if (!t) return;
    for (const q of t) {
      const l = extendLine(this.mouse, q);
      if (l) r.line(l.p1, l.p2, preview(app));
      r.point(q, '#ffd400', 6);
    }
  }
}

export class CircleFromRadiusTool extends RefTool<SegmentItem> {
  readonly id = 'circleFromRadius';
  readonly kinds: ItemKind[] = ['segment'];
  readonly tips: [string, string] = ['Cercle : sélectionnez un segment (le rayon).', 'Cercle : cliquez près de l\'extrémité qui sera le centre.'];

  private center(ref: SegmentItem, p: Pt): Pt {
    return dist(ref.p1, p) < dist(ref.p2, p) ? ref.p1 : ref.p2;
  }

  protected use(app: App, ref: SegmentItem, e: ToolEvent): void {
    const c = this.center(ref, e.p);
    app.addItems([{ kind: 'circle', ...app.stroke(), c, r: dist(ref.p1, ref.p2) }], 'cercle', c);
    this.ref = null;
    app.setSelection([]);
    app.status(this.tips[0]);
  }

  overlay(r: Renderer, app: App): void {
    if (!this.ref || !this.mouse) return;
    r.circle(this.center(this.ref, this.mouse), dist(this.ref.p1, this.ref.p2), preview(app));
  }
}

export class CircleFromDiameterTool extends RefTool<SegmentItem> {
  readonly id = 'circleFromDiameter';
  readonly kinds: ItemKind[] = ['segment'];
  readonly tips: [string, string] = ['Cercle : sélectionnez un segment (le diamètre).', 'Cercle : sélectionnez un autre segment.'];

  protected refChosen(app: App, ref: SegmentItem): void {
    if (samePt(ref.p1, ref.p2)) return;
    const c = mid(ref.p1, ref.p2);
    app.addItems([{ kind: 'circle', ...app.stroke(), c, r: dist(ref.p1, ref.p2) / 2 }], 'cercle', c);
  }

  protected use(): void {}
}

/** Cut an arc out of a circle: the circle is replaced by the arc. */
export class ArcFromCircleTool extends RefTool<CircleItem> {
  readonly id = 'arcFromCircle';
  readonly kinds: ItemKind[] = ['circle'];
  readonly tips: [string, string] = ['Arc : sélectionnez un cercle à découper.', 'Arc : cliquez la première extrémité.'];
  private first: Seg | null = null;
  private tracker = new ArcSpanTracker();

  protected refChosen(): void {
    this.first = null;
    this.tracker = new ArcSpanTracker();
  }

  click(app: App, e: ToolEvent): void {
    if (this.ref && this.first) {
      this.use(app, this.ref, e);
      return;
    }
    super.click(app, e);
  }

  protected use(app: App, ref: CircleItem, e: ToolEvent): void {
    if (!this.first) {
      if (samePt(e.raw, ref.c)) return;
      this.first = seg(ref.c, e.raw);
      app.status('Arc : cliquez la seconde extrémité.');
      return;
    }
    const span = this.tracker.span;
    const first = this.first;
    this.first = null;
    this.tracker = new ArcSpanTracker();
    if (Math.abs(span) < 0.5) return;
    const arc: Item = { kind: 'arc', ...app.stroke(), c: ref.c, r: ref.r, start: angleOf(first), span };
    // Layers stay independent: the circle is removed only from the current layer.
    app.replaceItems(app.inCurrentLayer(ref.id) ? [ref.id] : [], [arc], 'arc', ref.c);
    this.ref = null;
    app.status(this.tips[0]);
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.ref && this.first && !samePt(e.raw, this.ref.c)) {
      const span = this.tracker.update(this.first, seg(this.ref.c, e.raw));
      app.status(`Arc : ${fmt(Math.abs(span), 1)}° — cliquez la seconde extrémité.`);
    }
  }

  overlay(r: Renderer, app: App): void {
    if (!this.ref || !this.mouse) return;
    const c = this.ref.c, R = this.ref.r;
    const dir = (q: Pt) => withLength(seg(c, q), R * 1.15).p2;
    if (!this.first) {
      if (!samePt(this.mouse, c)) guideLine(r, c, dir(this.mouse));
      return;
    }
    guideLine(r, c, dir(this.first.p2));
    if (!samePt(this.mouse, c)) guideLine(r, c, dir(this.mouse));
    r.arc(c, R, angleOf(this.first), this.tracker.span, { color: app.project!.color, width: app.project!.width + 2, alpha: 0.6 });
  }
}

/** A line making a given angle with a reference line. */
export class AngleLineTool extends RefTool<SegmentItem | LineItem> {
  readonly id = 'angleLine';
  readonly kinds: ItemKind[] = ['segment', 'line'];
  readonly tips: [string, string] = ['Angle : sélectionnez la droite de référence.', 'Angle : cliquez le sommet de l\'angle sur la droite.'];
  private center: Pt | null = null;
  private tracker = new ArcSpanTracker();

  protected refChosen(): void {
    this.center = null;
    this.tracker = new ArcSpanTracker();
  }

  /** Projection of the mouse on the reference, kept within its ends. */
  private onRail(ref: SegmentItem | LineItem, p: Pt): Pt {
    const s = railOf(ref);
    const v = sub(s.p2, s.p1);
    const l2 = dot(v, v);
    if (l2 === 0) return s.p1;
    const t = Math.max(0, Math.min(1, dot(sub(p, s.p1), v) / l2));
    return add(s.p1, mul(v, t));
  }

  private firstSide(ref: SegmentItem | LineItem): Seg {
    const far = withLength(railOf(ref), segLength(railOf(ref)) + 1).p2;
    return seg(this.center!, far);
  }

  click(app: App, e: ToolEvent): void {
    if (this.ref && this.center) {
      this.use(app, this.ref, e);
      return;
    }
    super.click(app, e);
  }

  protected use(app: App, ref: SegmentItem | LineItem, e: ToolEvent): void {
    if (!this.center) {
      this.center = this.onRail(ref, e.raw);
      app.status('Angle : orientez la droite puis cliquez (ou [Entrée] pour saisir l\'angle).');
      return;
    }
    if (samePt(e.raw, this.center)) return;
    this.draw(app, seg(this.center, e.raw));
  }

  private draw(app: App, s: Seg): void {
    const l = app.lineThrough(s.p1, s.p2);
    if (l) app.addItems([l], 'droite à angle');
    this.center = null;
    this.tracker = new ArcSpanTracker();
    this.ref = null;
    app.setSelection([]);
    app.status(this.tips[0]);
  }

  key(app: App, e: KeyboardEvent): boolean {
    if (e.key !== 'Enter' || !this.ref || !this.center) return false;
    const ref = this.ref, center = this.center;
    void (async () => {
      const a = await promptNumber('Droite à angle', 'Angle avec la droite de référence (sens anti-horaire)', Math.round(Math.abs(this.tracker.span) * 10) / 10, { unit: '°', min: -360, max: 360 });
      if (a === null) return;
      this.draw(app, seg(center, polar(center, 100, angleOf(this.firstSide(ref)) + a)));
    })();
    return true;
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.ref && this.center && !samePt(e.raw, this.center)) {
      const span = this.tracker.update(this.firstSide(this.ref), seg(this.center, e.raw));
      app.status(`Angle : ${fmt(Math.abs(span), 1)}° — cliquez pour tracer, ou [Entrée] pour saisir l'angle.`);
    }
  }

  overlay(r: Renderer, app: App): void {
    if (!this.ref || !this.mouse) return;
    if (!this.center) {
      r.point(this.onRail(this.ref, this.mouse), '#000', app.project!.width + 3);
      return;
    }
    const c = this.center;
    const len = 80 / app.cam.zoom;
    if (!samePt(this.mouse, c)) {
      const l = extendLine(c, this.mouse);
      if (l) r.line(l.p1, l.p2, preview(app));
    }
    r.arc(c, len, angleOf(this.firstSide(this.ref)), this.tracker.span, { color: '#ffd400', width: 3 });
    r.point(c, '#000', app.project!.width + 3);
    r.text(c, `${fmt(Math.abs(this.tracker.span), 1)}°`, { dx: 10, dy: -10, size: 18, bold: true });
  }
}

/* ---------------------------------------------------------------- arcs */

export class ArcTool extends Tool {
  readonly id = 'arc';
  private center: Pt | null = null;
  private first: Seg | null = null;
  private tracker = new ArcSpanTracker();

  start(app: App): void {
    this.center = this.first = null;
    this.tracker = new ArcSpanTracker();
    app.status('Arc : cliquez le centre.');
  }

  click(app: App, e: ToolEvent): void {
    if (!this.center) {
      this.center = e.p;
      app.status('Arc : cliquez le point de départ.');
    } else if (!this.first) {
      if (samePt(this.center, e.p)) {
        app.status('Le centre et le point de départ doivent être différents !');
        return;
      }
      this.first = seg(this.center, e.p);
      app.status('Arc : cliquez pour fixer l\'angle (ou [Entrée] pour le saisir).');
    } else this.finish(app, this.tracker.span);
  }

  private finish(app: App, span: number): void {
    const c = this.center!, first = this.first!;
    const r = segLength(first);
    this.start(app);
    if (Math.abs(span) < 0.5) return;
    if (360 - Math.abs(span) < 1) app.addItems([{ kind: 'circle', ...app.stroke(), c, r }], 'cercle', c);
    else app.addItems([{ kind: 'arc', ...app.stroke(), c, r, start: angleOf(first), span }], 'arc', c);
  }

  key(app: App, e: KeyboardEvent): boolean {
    if (e.key !== 'Enter' || !this.first) return false;
    void (async () => {
      const a = await promptNumber('Arc', 'Angle de l\'arc (positif : sens anti-horaire)', Math.round(this.tracker.span * 10) / 10, { unit: '°', min: -360, max: 360 });
      if (a !== null && this.first) this.finish(app, a);
    })();
    return true;
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.center && this.first && !samePt(e.raw, this.center)) {
      const span = this.tracker.update(this.first, seg(this.center, e.raw));
      app.status(`Arc : ${fmt(Math.abs(span), 1)}° — cliquez pour fixer l'angle (ou [Entrée] pour le saisir).`);
    }
  }

  overlay(r: Renderer, app: App): void {
    if (!this.center || !this.mouse) return;
    const c = this.center;
    if (!this.first) {
      guideLine(r, c, this.mouse);
      r.circle(c, dist(c, this.mouse), { ...preview(app), alpha: 0.3 });
      return;
    }
    const R = segLength(this.first);
    guideLine(r, c, this.first.p2);
    if (!samePt(this.mouse, c)) guideLine(r, c, withLength(seg(c, this.mouse), R).p2);
    r.arc(c, R, angleOf(this.first), this.tracker.span, preview(app, []));
    r.text(c, `${fmt(Math.abs(this.tracker.span), 1)}°`, { dx: 10, dy: -10, size: 18, bold: true });
  }
}

/* -------------------------------------------------------------- spiral */

/**
 * 4 centers spiral (port of Item_spiralDrawer): 4 clicks for the 4 centers,
 * or [Enter] after 2 (square base) or 3 (trapezium base). [Shift] makes a
 * side perpendicular to the previous one.
 */
export class SpiralTool extends Tool {
  readonly id = 'spiral';
  private origin: Pt | null = null;
  private sides: Seg[] = [];
  private clicks = 0; // centers picked up so far
  private clockwise = false;
  private readonly tips = [
    'Spirale : cliquez le premier centre.',
    'Spirale : cliquez le deuxième centre.',
    'Spirale : cliquez le troisième centre (ou [Entrée] pour une base carrée).',
    'Spirale : cliquez le quatrième centre ([Entrée] : base en trapèze, [Maj] : côtés perpendiculaires).',
  ];

  start(app: App): void {
    this.origin = null;
    this.sides = [];
    this.clicks = 0;
    app.status(this.tips[0]);
  }

  /** Update the side being defined so that it ends at p. */
  private follow(p: Pt): void {
    const i = this.clicks - 1;
    if (i === 0) this.sides[0] = seg(this.origin!, p);
    else if (i === 1 || i === 2) {
      const prev = this.sides[i - 1];
      if (this.shift && segLength(prev) > 0) {
        // Side perpendicular to the previous one, its length given by the mouse.
        const hyp = seg(prev.p1, p);
        const len = segLength(hyp) * Math.sin(deg2rad(norm(angleOf(hyp) - angleOf(prev))));
        this.sides[i] = withLength(translated(normalVector(prev), sub(prev.p2, prev.p1)), len);
      } else this.sides[i] = seg(prev.p2, p);
      if (i === 1) this.clockwise = norm(angleOf(this.sides[1]) - angleOf(this.sides[0])) > 180;
    }
  }

  click(app: App, e: ToolEvent): void {
    this.shift = e.shift;
    if (this.clicks === 0) {
      this.origin = e.p;
      this.clicks = 1;
    } else {
      this.follow(e.p);
      if (segLength(this.sides[this.clicks - 1]) === 0) return;
      this.clicks++;
      if (this.clicks === 4) {
        this.finish(app, 4);
        return;
      }
    }
    app.status(this.tips[this.clicks]);
  }

  key(app: App, e: KeyboardEvent): boolean {
    if (e.key !== 'Enter') return false;
    if (this.clicks === 2 || this.clicks === 3) this.finish(app, this.clicks);
    else app.status('Il faut au moins 2 centres pour tracer une spirale.');
    return true;
  }

  private finish(app: App, clicks: number): void {
    const base = completeSpiralBase(this.sides, clicks, this.clockwise);
    this.start(app);
    if (typeof base === 'string') {
      void alertDialog('Tracé impossible', base);
      return;
    }
    const centers = [base[0].p1, base[1].p1, base[2].p1, base[2].p2] as [Pt, Pt, Pt, Pt];
    const opts = app.options.spiral;
    const items: Item[] = [];
    if (opts.oneItem) items.push({ kind: 'spiral', ...app.stroke(), centers });
    else for (const g of spiralArcs(centers)) items.push({ kind: 'arc', ...app.stroke(), c: g.c, r: g.r, start: g.start, span: g.span });
    if (opts.showBase) {
      if (opts.centersOnly) for (const c of centers) items.push({ kind: 'point', ...app.stroke(), p: c, weight: 0 });
      else for (const sd of base) items.push({ kind: 'segment', ...app.stroke(), p1: sd.p1, p2: sd.p2 });
    }
    app.addItems(items, 'spirale');
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.clicks > 0 && this.clicks < 4) this.follow(e.p);
  }

  overlay(r: Renderer, app: App): void {
    if (this.clicks === 0) return;
    const st = preview(app);
    for (let i = 0; i < this.clicks && i < 3; i++) {
      const sd = this.sides[i];
      if (sd) r.line(sd.p1, sd.p2, st);
    }
    if (this.clicks < 2 || !this.sides[1]) return;
    // Arc hint showing in which direction the spiral will turn.
    const { start } = spiralArcAngles(this.sides[0], this.sides[1]);
    r.arc(this.sides[0].p2, spiralArcRadius(0, this.sides), start, this.clockwise ? -30 : 30, st);
    // The spiral a click here would give (then [Enter] for 3 centers).
    const base = completeSpiralBase(this.sides, this.clicks + 1, this.clockwise);
    if (typeof base !== 'string' && base.every((sd) => segLength(sd) > 0)) {
      const centers = [base[0].p1, base[1].p1, base[2].p1, base[2].p2];
      for (const g of spiralArcs(centers)) r.arc(g.c, g.r, g.start, g.span, { ...st, dash: [], alpha: 0.35 });
    }
  }
}

const norm = (a: number) => ((a % 360) + 360) % 360;

/* ------------------------------------------------------------ registry */

export type ToolId =
  | 'select' | 'pan' | 'measure' | 'calibrate' | 'protractor'
  | 'point' | 'segment' | 'line' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular'
  | 'bisection' | 'angleLine' | 'tangent'
  | 'circleCenter' | 'circleFromRadius' | 'circleRadius' | 'circleDiameter' | 'circleFromDiameter' | 'circle3'
  | 'ellipse' | 'arcFromCircle' | 'arc' | 'spiral';

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string; // file name in resources/icons
  group: 'nav' | 'point' | 'lines' | 'circles' | 'arcs';
  key?: string;
  make: () => Tool;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Sélection', icon: 'cursor-arrow.png', group: 'nav', key: 'J', make: () => new SelectTool() },
  { id: 'pan', label: 'Déplacer la vue', icon: 'cursor-openhand.png', group: 'nav', key: 'H', make: () => new PanTool() },
  { id: 'measure', label: 'Mesurer une distance', icon: 'measure-tape-km.png', group: 'nav', key: 'M', make: () => new MeasureTool() },
  { id: 'protractor', label: 'Rapporteur (mesurer un angle)', icon: 'protractor.png', group: 'nav', make: () => new ProtractorTool() },
  { id: 'point', label: 'Point', icon: 'point.png', group: 'point', key: 'P', make: () => new PointTool() },
  { id: 'segment', label: 'Segment', icon: 'line-segment.png', group: 'lines', key: 'G', make: () => new SegmentTool() },
  { id: 'line', label: 'Droite passant par 2 points', icon: 'line.png', group: 'lines', key: 'D', make: () => new LineTool() },
  { id: 'horizontal', label: 'Horizontale', icon: 'line-horizontal.png', group: 'lines', make: () => new HorizontalTool() },
  { id: 'vertical', label: 'Verticale', icon: 'line-vertical.png', group: 'lines', make: () => new VerticalTool() },
  { id: 'parallel', label: 'Parallèle passant par un point', icon: 'line-point-parallel.png', group: 'lines', make: () => new ParallelTool() },
  { id: 'perpendicular', label: 'Perpendiculaire passant par un point', icon: 'line-point-perpendicular.png', group: 'lines', make: () => new PerpendicularTool() },
  { id: 'bisection', label: 'Médiatrice d\'un segment', icon: 'line-bisection.png', group: 'lines', make: () => new BisectionTool() },
  { id: 'angleLine', label: 'Droite faisant un angle avec une autre', icon: 'line-angle.png', group: 'lines', make: () => new AngleLineTool() },
  { id: 'tangent', label: 'Tangentes à un cercle', icon: 'line-tangent-circle.png', group: 'lines', make: () => new TangentTool() },
  { id: 'circleCenter', label: 'Cercle : centre et point', icon: 'circle-center-point.png', group: 'circles', key: 'O', make: () => new CircleCenterTool() },
  { id: 'circleFromRadius', label: 'Cercle : segment comme rayon', icon: 'circle-segment.png', group: 'circles', make: () => new CircleFromRadiusTool() },
  { id: 'circleRadius', label: 'Cercle : centre et rayon donné', icon: 'circle-radius-value.png', group: 'circles', make: () => new CircleRadiusValueTool() },
  { id: 'circleDiameter', label: 'Cercle : 2 points du diamètre', icon: 'circle-2points-diameter.png', group: 'circles', make: () => new CircleDiameterTool() },
  { id: 'circleFromDiameter', label: 'Cercle : segment comme diamètre', icon: 'circle-diameter.png', group: 'circles', make: () => new CircleFromDiameterTool() },
  { id: 'circle3', label: 'Cercle passant par 3 points', icon: 'circle-3points.png', group: 'circles', make: () => new Circle3Tool() },
  { id: 'ellipse', label: 'Ellipse : 2 foyers et somme des distances', icon: 'ellipse-foci.png', group: 'circles', make: () => new EllipseTool() },
  { id: 'arcFromCircle', label: 'Arc découpé dans un cercle', icon: 'arc-2boundaries.png', group: 'arcs', make: () => new ArcFromCircleTool() },
  { id: 'arc', label: 'Arc : centre, départ et angle', icon: 'arc-center-point-angle.png', group: 'arcs', make: () => new ArcTool() },
  { id: 'spiral', label: 'Spirale à 4 centres', icon: 'spiral.png', group: 'arcs', make: () => new SpiralTool() },
];

export const CALIBRATE_DEF: ToolDef = { id: 'calibrate', label: 'Mesurer l\'échelle sur la carte', icon: 'measure-tape-px.png', group: 'nav', make: () => new CalibrateTool() };

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? CALIBRATE_DEF;
}
