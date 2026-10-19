/**
 * What every tool shares: the event it receives and the drawing helpers of
 * the live previews.
 */

import type { App } from '../app';
import type { Pt } from '../geom';
import type { Renderer, StrokeStyle } from '../render';
import type { ToolId } from './index';

export interface ToolEvent {
  p: Pt; // scene position, snapped on a point if the mouse is over one
  raw: Pt; // scene position of the mouse
  screen: Pt;
  shift: boolean;
  ctrl: boolean;
}

/**
 * A tool is a small state machine fed with the clicks and moves of the user;
 * it shows its next step in the status bar ("drawing tips") and draws a live
 * preview of the figure being built.
 */
export abstract class Tool {
  abstract readonly id: ToolId;
  cursor = 'crosshair';
  /** The tool adds items: it needs a current layer. */
  draws = true;
  /** Mouse position (snapped), for previews. */
  protected mouse: Pt | null = null;
  /** Mouse position (not snapped). */
  protected raw: Pt | null = null;
  protected shift = false;

  start(_app: App): void {}
  click(_app: App, _e: ToolEvent): void {}
  move(_app: App, e: ToolEvent): void {
    this.mouse = e.p;
    this.raw = e.raw;
    this.shift = e.shift;
  }
  /** Return true if the key was used. */
  key(_app: App, _e: KeyboardEvent): boolean {
    return false;
  }
  overlay(_r: Renderer, _app: App): void {}
  /** Reset to the first step (Escape key). */
  reset(app: App): void {
    this.mouse = this.raw = null;
    this.start(app);
  }
}

const PREVIEW_DASH = [8, 6];

/** Style of the figure being drawn. */
export function previewStyle(app: App, dash = PREVIEW_DASH): StrokeStyle {
  return { color: app.project!.color, width: Math.max(1, app.project!.width - 1), dash, alpha: 0.8 };
}

export const GUIDE = { color: '#ffd400', width: 3, dash: [3, 4] };
export const GUIDE_DARK = { color: '#222', width: 1, dash: [3, 4] };

/** A construction line, visible on any background. */
export function guideLine(r: Renderer, a: Pt, b: Pt): void {
  r.line(a, b, GUIDE);
  r.line(a, b, GUIDE_DARK);
}
