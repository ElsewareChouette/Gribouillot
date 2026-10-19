/**
 * Tools which do not draw: selection, moving the view, measuring.
 */

import type { App } from '../app';
import { angleOf, deg2rad, dist, mid, projectOnLine, pt, samePt, seg, segLength, withLength, type Pt, type Seg } from '../geom';
import type { LineItem, SegmentItem } from '../model';
import type { Renderer } from '../render';
import { ArcSpanTracker } from '../shapes';
import { fmt } from '../ui/dom';
import { Tool, guideLine, type ToolEvent } from './base';
import type { ToolId } from './index';

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

/* ------------------------------------------------------------- GPS */

/** Click on the map the places whose coordinates are known. */
export class GeorefTool extends Tool {
  readonly id = 'georef';
  draws = false;

  start(app: App): void {
    app.status(app.georefSummary(true));
  }

  click(app: App, e: ToolEvent): void {
    const near = app.anchorAt(e.screen);
    void app.placeAnchor(near ? near.p : e.p, near ?? undefined);
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    const near = app.anchorAt(e.screen);
    app.status(near ? `${near.name} — cliquez pour corriger ou retirer ce repère.` : app.georefSummary(true));
  }

  overlay(r: Renderer, app: App): void {
    const anchors = app.project?.anchors ?? [];
    const g = app.georef();
    anchors.forEach((a, i) => {
      // Where the other anchors place this one: the length of the red line is its error.
      const check = g?.checks[i];
      if (check) {
        r.line(a.p, check.p, { color: '#d00000', width: 2 });
        r.point(check.p, '#d00000', 5);
      }
      const s = 8 / app.cam.zoom;
      r.line(pt(a.p.x - s, a.p.y), pt(a.p.x + s, a.p.y), { color: '#0050d0', width: 3 });
      r.line(pt(a.p.x, a.p.y - s), pt(a.p.x, a.p.y + s), { color: '#0050d0', width: 3 });
      const err = check ? ` (${fmt(check.km, check.km < 10 ? 1 : 0)} km)` : '';
      r.text(a.p, `${a.name}${err}`, { color: '#0050d0', bold: true, dx: 10, dy: -8 });
    });
  }
}
