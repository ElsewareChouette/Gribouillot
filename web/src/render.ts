/**
 * Canvas rendering of the map, the layers and the drawing helpers.
 *
 * Strokes are drawn in screen coordinates so that their width does not depend
 * on the zoom (the "cosmetic" pens of the desktop version).
 */

import type { Camera } from './camera';
import { deg2rad, mid, angleOf, seg, type Pt, type Rect } from './geom';
import type { Picture } from './images';
import type { Item, Layer, PixmapItem } from './model';
import { pixmapCorners, spiralArcs } from './shapes';

export interface StrokeStyle {
  color: string;
  width: number;
  dash?: number[];
  alpha?: number;
}

export const HIGHLIGHT = 'rgba(37, 140, 255, 0.45)';

export class Renderer {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly cam: Camera,
  ) {}

  private stroke(s: StrokeStyle): void {
    const c = this.ctx;
    c.strokeStyle = s.color;
    c.lineWidth = s.width;
    c.setLineDash(s.dash ?? []);
    c.lineCap = 'butt';
    c.globalAlpha = s.alpha ?? 1;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** Segment p1-p2 (clipped to the viewport to keep coordinates small). */
  line(p1: Pt, p2: Pt, s: StrokeStyle): void {
    const a = this.cam.toScreen(p1), b = this.cam.toScreen(p2);
    const m = 50 + s.width;
    const clipped = clipSegment(a, b, { x: -m, y: -m, w: this.cam.width + 2 * m, h: this.cam.height + 2 * m });
    if (!clipped) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(clipped[0].x, clipped[0].y);
    c.lineTo(clipped[1].x, clipped[1].y);
    this.stroke(s);
  }

  circle(center: Pt, r: number, s: StrokeStyle): void {
    const c = this.cam.toScreen(center);
    const rr = r * this.cam.zoom;
    if (!this.circleVisible(c, rr, s.width)) return;
    this.ctx.beginPath();
    this.ctx.arc(c.x, c.y, Math.max(0, rr), 0, Math.PI * 2);
    this.stroke(s);
  }

  /** Arc with Qt angles: degrees, counter-clockwise on screen. */
  arc(center: Pt, r: number, start: number, span: number, s: StrokeStyle): void {
    const c = this.cam.toScreen(center);
    const rr = r * this.cam.zoom;
    if (!this.circleVisible(c, rr, s.width)) return;
    this.ctx.beginPath();
    this.ctx.arc(c.x, c.y, Math.max(0, rr), -deg2rad(start), -deg2rad(start + span), span > 0);
    this.stroke(s);
  }

  ellipse(f1: Pt, f2: Pt, dSum: number, s: StrokeStyle): void {
    const a = dSum / 2;
    const cHalf = Math.hypot(f2.x - f1.x, f2.y - f1.y) / 2;
    const b = Math.sqrt(Math.max(0, a * a - cHalf * cHalf));
    const c = this.cam.toScreen(mid(f1, f2));
    if (!this.circleVisible(c, a * this.cam.zoom, s.width, true)) return;
    this.ctx.beginPath();
    this.ctx.ellipse(c.x, c.y, a * this.cam.zoom, b * this.cam.zoom, -deg2rad(angleOf(seg(f1, f2))), 0, Math.PI * 2);
    this.stroke(s);
  }

  /** A point: a disc of constant screen size with a thin black outline. */
  point(p: Pt, color: string, width: number, alpha = 1): void {
    const c = this.cam.toScreen(p);
    const r = Math.max(width, 3) / 2;
    const x = this.ctx;
    x.globalAlpha = alpha;
    x.beginPath();
    x.arc(c.x, c.y, r, 0, Math.PI * 2);
    x.fillStyle = color;
    x.fill();
    x.lineWidth = 1;
    x.strokeStyle = '#000';
    x.setLineDash([]);
    x.stroke();
    x.globalAlpha = 1;
  }

  /** A text label at a scene position, offset in screen pixels. */
  text(p: Pt, str: string, opts: { color?: string; size?: number; dx?: number; dy?: number; bold?: boolean; halo?: boolean } = {}): void {
    const c = this.cam.toScreen(p);
    const x = this.ctx;
    x.font = `${opts.bold ? 'bold ' : ''}${opts.size ?? 14}px system-ui, sans-serif`;
    x.textBaseline = 'alphabetic';
    const tx = c.x + (opts.dx ?? 0), ty = c.y + (opts.dy ?? 0);
    if (opts.halo !== false) {
      x.lineWidth = 3;
      x.strokeStyle = 'rgba(255,255,255,0.85)';
      x.setLineDash([]);
      x.strokeText(str, tx, ty);
    }
    x.fillStyle = opts.color ?? '#000';
    x.fillText(str, tx, ty);
  }

  private circleVisible(c: Pt, r: number, w: number, loose = false): boolean {
    const m = w + 4;
    const W = this.cam.width, H = this.cam.height;
    // Entirely outside of the viewport?
    if (c.x + r < -m || c.x - r > W + m || c.y + r < -m || c.y - r > H + m) return false;
    if (loose) return true;
    // The viewport entirely inside the circle: nothing of the outline to draw.
    const far = Math.max(
      Math.hypot(c.x, c.y), Math.hypot(W - c.x, c.y), Math.hypot(c.x, H - c.y), Math.hypot(W - c.x, H - c.y),
    );
    return far >= r - m;
  }

  /* ---------------------------------------------------------- scene */

  clear(background: string, dpr: number): void {
    const x = this.ctx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = background;
    x.fillRect(0, 0, this.cam.width, this.cam.height);
  }

  map(pic: Picture, gray: boolean, dpr: number): void {
    const cam = this.cam;
    const view = cam.visibleRect();
    const sx = Math.max(0, view.x), sy = Math.max(0, view.y);
    const ex = Math.min(pic.w, view.x + view.w), ey = Math.min(pic.h, view.y + view.h);
    if (ex <= sx || ey <= sy) return;
    const mip = pic.pick(Math.min(1, cam.zoom * dpr), gray);
    const k = mip.scale;
    const x = this.ctx;
    x.imageSmoothingEnabled = cam.zoom * dpr < 2;
    x.imageSmoothingQuality = 'high';
    const tl = cam.toScreen({ x: sx, y: sy });
    x.drawImage(mip.bitmap, sx * k, sy * k, (ex - sx) * k, (ey - sy) * k, tl.x, tl.y, (ex - sx) * cam.zoom, (ey - sy) * cam.zoom);
  }

  pixmap(p: PixmapItem, pic: Picture | undefined, dpr: number, alpha: number): void {
    if (!pic) return;
    const x = this.ctx;
    const cam = this.cam;
    const mip = pic.pick(Math.min(1, cam.zoom * p.scale * dpr));
    x.save();
    x.globalAlpha = alpha;
    x.translate(cam.panX, cam.panY);
    x.scale(cam.zoom, cam.zoom);
    x.translate(p.x + pic.w / 2, p.y + pic.h / 2);
    x.rotate(deg2rad(p.rotation));
    x.scale(p.scale, p.scale);
    x.imageSmoothingEnabled = true;
    x.drawImage(mip.bitmap, -pic.w / 2, -pic.h / 2, pic.w, pic.h);
    x.restore();
  }

  /** Draw one item, with its selection highlight if needed. */
  item(it: Item, opts: { selected: boolean; alpha: number; showWeight: boolean; pictures: Map<string, Picture>; dpr: number }): void {
    const a = opts.alpha;
    if (it.kind === 'pixmap') {
      const pic = opts.pictures.get(it.file);
      this.pixmap(it, pic, opts.dpr, a);
      if (opts.selected && pic) this.pixmapOutline(it, pic);
      return;
    }
    if (opts.selected) this.outline(it, { color: HIGHLIGHT, width: it.width + 8 });
    const s: StrokeStyle = { color: it.color, width: it.width, alpha: a };
    switch (it.kind) {
      case 'point':
        this.point(it.p, it.color, it.width, a);
        if (opts.showWeight && it.weight !== 0) this.text(it.p, String(it.weight), { color: it.color, size: 20, bold: true, dx: 7, dy: 16 });
        break;
      default:
        this.outline(it, s);
    }
  }

  /** The geometry of a stroke item, with any style. */
  outline(it: Exclude<Item, PixmapItem>, s: StrokeStyle): void {
    switch (it.kind) {
      case 'point': {
        // Selection halo of a point: a disc around it.
        const c = this.cam.toScreen(it.p);
        this.ctx.beginPath();
        this.ctx.arc(c.x, c.y, Math.max(it.width, 3) / 2 + 5, 0, Math.PI * 2);
        this.ctx.fillStyle = s.color;
        this.ctx.fill();
        break;
      }
      case 'segment':
      case 'line':
        this.line(it.p1, it.p2, s);
        break;
      case 'circle':
        this.circle(it.c, it.r, s);
        break;
      case 'arc':
        this.arc(it.c, it.r, it.start, it.span, s);
        break;
      case 'ellipse':
        this.ellipse(it.f1, it.f2, it.dSum, s);
        break;
      case 'spiral':
        for (const g of spiralArcs(it.centers)) this.arc(g.c, g.r, g.start, g.span, s);
        break;
    }
  }

  pixmapOutline(p: PixmapItem, pic: Picture): void {
    const x = this.ctx;
    const corners = pixmapCorners(p, pic).map((c) => this.cam.toScreen(c));
    x.beginPath();
    corners.forEach((c, i) => (i ? x.lineTo(c.x, c.y) : x.moveTo(c.x, c.y)));
    x.closePath();
    x.lineWidth = 2;
    x.setLineDash([6, 4]);
    x.strokeStyle = '#258cff';
    x.stroke();
    x.setLineDash([]);
  }

  layers(layers: Layer[], opts: { selection: Set<string>; showWeight: boolean; pictures: Map<string, Picture>; dpr: number }): void {
    for (const l of layers) {
      if (!l.visible) continue;
      const alpha = l.opacity / 100;
      for (const it of l.items) {
        this.item(it, { selected: opts.selection.has(it.id), alpha, showWeight: opts.showWeight, pictures: opts.pictures, dpr: opts.dpr });
      }
    }
  }

  rubberBand(r: Rect): void {
    const x = this.ctx;
    x.fillStyle = 'rgba(37, 140, 255, 0.12)';
    x.fillRect(r.x, r.y, r.w, r.h);
    x.strokeStyle = '#258cff';
    x.lineWidth = 1;
    x.setLineDash([]);
    x.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  }
}

/** Liang-Barsky clipping of segment a-b to rectangle r, in screen space. */
export function clipSegment(a: Pt, b: Pt, r: Rect): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}
