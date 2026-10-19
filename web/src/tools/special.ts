/**
 * Drawing tools with their own interaction: the point (with its weight) and
 * the 4 centers spiral.
 */

import type { App } from '../app';
import { angleOf, deg2rad, normalVector, seg, segLength, sub, translated, withLength, type Pt, type Seg } from '../geom';
import { spiralShapes } from '../constructions';
import type { Renderer } from '../render';
import { completeSpiralBase, spiralArcRadius, spiralArcAngles, spiralArcs } from '../shapes';
import { alertDialog } from '../ui/dialogs';
import { Tool, previewStyle, type ToolEvent } from './base';

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
    app.addShapes(spiralShapes(base, app.options.spiral), 'spirale');
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    if (this.clicks > 0 && this.clicks < 4) this.follow(e.p);
  }

  overlay(r: Renderer, app: App): void {
    if (this.clicks === 0) return;
    const st = previewStyle(app);
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
