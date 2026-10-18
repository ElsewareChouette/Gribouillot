/**
 * The view transform: screen = scene * zoom + pan.
 */

import type { Pt, Rect } from './geom';

export const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.005;
const MAX_ZOOM = 64;

export class Camera {
  zoom = 1;
  panX = 0;
  panY = 0;
  width = 1; // viewport size in CSS pixels
  height = 1;
  /** Scene rectangle the center of the view must stay in (the map), if any. */
  bounds: Rect | null = null;

  toScreen(p: Pt): Pt {
    return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY };
  }

  toScene(p: Pt): Pt {
    return { x: (p.x - this.panX) / this.zoom, y: (p.y - this.panY) / this.zoom };
  }

  /** The scene rectangle visible on screen. */
  visibleRect(): Rect {
    const a = this.toScene({ x: 0, y: 0 });
    return { x: a.x, y: a.y, w: this.width / this.zoom, h: this.height / this.zoom };
  }

  center(): Pt {
    return this.toScene({ x: this.width / 2, y: this.height / 2 });
  }

  centerOn(p: Pt): void {
    this.panX = this.width / 2 - p.x * this.zoom;
    this.panY = this.height / 2 - p.y * this.zoom;
    this.clamp();
  }

  setZoom(zoom: number, screenAnchor: Pt = { x: this.width / 2, y: this.height / 2 }): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const anchor = this.toScene(screenAnchor);
    this.zoom = z;
    this.panX = screenAnchor.x - anchor.x * z;
    this.panY = screenAnchor.y - anchor.y * z;
    this.clamp();
  }

  zoomBy(factor: number, screenAnchor?: Pt): void {
    this.setZoom(this.zoom * factor, screenAnchor);
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.panX += dxScreen;
    this.panY += dyScreen;
    this.clamp();
  }

  fit(rect: Rect, margin = 0.97): void {
    if (rect.w <= 0 || rect.h <= 0) return;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(this.width / rect.w, this.height / rect.h) * margin));
    this.centerOn({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
  }

  /** Keep at least one point of the map at the center of the view. */
  clamp(): void {
    const b = this.bounds;
    if (!b) return;
    const c = this.center();
    const cx = Math.min(b.x + b.w, Math.max(b.x, c.x));
    const cy = Math.min(b.y + b.h, Math.max(b.y, c.y));
    if (cx !== c.x || cy !== c.y) {
      this.panX = this.width / 2 - cx * this.zoom;
      this.panY = this.height / 2 - cy * this.zoom;
    }
  }
}
