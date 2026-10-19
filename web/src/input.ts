/**
 * Mouse, touch and keyboard on the map: clicks go to the current tool, drags
 * move the view (or draw a selection rectangle, or move a picture), two
 * fingers zoom, the keys are the shortcuts of the desktop version.
 */

import type { App } from './app';
import { ZOOM_STEP } from './camera';
import { dist, mid, pt, type Pt, type Rect } from './geom';
import type { Layer, PixmapItem, PointItem } from './model';
import { itemTouchesRect } from './shapes';
import { TOOLS, type ToolEvent, type ToolId } from './tools';
import { popupMenu } from './ui/dialogs';
import { fmt } from './ui/dom';
import { icon } from './ui/icons';

const DRAG_THRESHOLD = 5; // px

type Drag =
  | { kind: 'pending'; start: Pt; last: Pt; button: number; pixmap?: PixmapItem; point?: PointItem; ctrl: boolean; shift: boolean }
  | { kind: 'pan'; last: Pt }
  | { kind: 'rubber'; start: Pt; end: Pt; additive: boolean }
  | { kind: 'movePixmap'; id: string; startScene: Pt; orig: Pt; before: Layer[] }
  | { kind: 'movePoint'; id: string; offset: Pt; before: Layer[] }
  | { kind: 'pinch'; dist: number; mid: Pt };

export function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export class Input {
  /** Mouse position on the canvas, null when it is outside. */
  mouseScreen: Pt | null = null;
  private drag: Drag | null = null;
  private pointers = new Map<number, Pt>();
  /** Scale step of the pictures (port of Item_pixmap::keyPressEvent). */
  private pixmapStep = 1.0204;

  constructor(
    private readonly app: App,
    private readonly canvas: HTMLCanvasElement,
    private readonly coordsEl: HTMLElement,
  ) {
    const c = canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.drag = null;
      this.app.requestRender();
    });
    c.addEventListener('pointerleave', () => {
      this.mouseScreen = null;
      this.coordsEl.textContent = '';
      this.app.requestRender();
    });
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void this.contextMenu(this.screenPos(e), e.clientX, e.clientY);
    });
    c.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
    window.addEventListener('keydown', (e) => this.keyDown(e));
  }

  /** The selection rectangle being drawn, in screen coordinates. */
  rubberBand(): Rect | null {
    return this.drag?.kind === 'rubber' ? normRect(this.drag.start, this.drag.end) : null;
  }

  private toolEvent(screen: Pt, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): ToolEvent {
    const app = this.app;
    const raw = app.cam.toScene(screen);
    const snap = app.snaps() ? app.snap(screen) : null;
    return { p: snap?.p ?? raw, raw, snap, screen, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private screenPos(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* ---------------------------------------------------------- pointer */

  private pointerDown(e: PointerEvent): void {
    const app = this.app;
    if (!app.project) return;
    const s = this.screenPos(e);
    // Take the focus from any field of the panel, so that shortcuts work.
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, s);
    if (this.pointers.size === 2) {
      // Second finger: pinch-zoom and pan, cancel the pending click.
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', dist: dist(a, b), mid: mid(a, b) };
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 1 || (e.button === 0 && app.toolId === 'pan')) {
      e.preventDefault();
      this.drag = { kind: 'pan', last: s };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    let pixmap: PixmapItem | undefined;
    let point: PointItem | undefined;
    if (app.toolId === 'select') {
      const hit = app.pick(s);
      if (hit?.layer.id === app.currentLayerId && hit.item.kind === 'pixmap') pixmap = hit.item;
      if (hit?.layer.id === app.currentLayerId && hit.item.kind === 'point') point = hit.item;
    }
    this.drag = { kind: 'pending', start: s, last: s, button: e.button, pixmap, point, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
  }

  private pointerMove(e: PointerEvent): void {
    const app = this.app;
    const p = app.project;
    if (!p) return;
    const s = this.screenPos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);
    this.mouseScreen = s;
    const scene = app.cam.toScene(s);
    const gps = app.gps(scene);
    this.coordsEl.textContent = gps ?? `x ${fmt(scene.x, 0)} · y ${fmt(scene.y, 0)} px`;
    this.coordsEl.title = gps ? `x ${fmt(scene.x, 0)} · y ${fmt(scene.y, 0)} px` : '';
    const d = this.drag;
    if (d?.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const nd = dist(a, b), nm = mid(a, b);
      if (d.dist > 0) app.cam.zoomBy(nd / d.dist, nm);
      app.cam.panBy(nm.x - d.mid.x, nm.y - d.mid.y);
      d.dist = nd;
      d.mid = nm;
      app.viewChanged();
      return;
    }
    if (d?.kind === 'pending' && dist(s, d.start) > DRAG_THRESHOLD) {
      if (app.toolId === 'select' && d.pixmap) {
        app.setSelection([d.pixmap.id]);
        this.drag = { kind: 'movePixmap', id: d.pixmap.id, startScene: app.cam.toScene(d.start), orig: pt(d.pixmap.x, d.pixmap.y), before: p.layers };
      } else if (app.toolId === 'select' && d.point && !d.point.link) {
        app.setSelection([d.point.id]);
        const start = app.cam.toScene(d.start);
        this.drag = { kind: 'movePoint', id: d.point.id, offset: pt(d.point.p.x - start.x, d.point.p.y - start.y), before: p.layers };
      } else if (app.toolId === 'select') {
        if (d.point?.link) app.status('Ce point est construit (intersection, milieu…) : il suit les éléments dont il dépend. Déplacez plutôt ceux-ci.');
        this.drag = { kind: 'rubber', start: d.start, end: s, additive: d.ctrl || d.shift };
      } else {
        this.drag = { kind: 'pan', last: d.start };
        this.canvas.style.cursor = 'grabbing';
      }
    }
    const d2 = this.drag;
    if (d2?.kind === 'pan') {
      app.cam.panBy(s.x - d2.last.x, s.y - d2.last.y);
      d2.last = s;
      app.viewChanged();
      return;
    }
    if (d2?.kind === 'rubber') {
      d2.end = s;
      app.requestRender();
      return;
    }
    if (d2?.kind === 'movePoint') {
      // Each move starts from the previous one: the figure follows step by step.
      app.showLayers(app.movedPoint(p.layers, d2.id, pt(scene.x + d2.offset.x, scene.y + d2.offset.y)));
      return;
    }
    if (d2?.kind === 'movePixmap') {
      // Live move, recorded as one undoable change when the button is released.
      const x = d2.orig.x + scene.x - d2.startScene.x, y = d2.orig.y + scene.y - d2.startScene.y;
      app.showLayers(app.updatedItems([d2.id], (i) => (i.kind === 'pixmap' ? { ...i, x, y } : i)));
      return;
    }
    if (!d2 && app.toolId === 'select') {
      const hit = app.pick(s);
      const movable = hit?.layer.id === app.currentLayerId && hit.item.kind === 'point' && !hit.item.link;
      this.canvas.style.cursor = movable ? 'move' : app.tool.cursor;
    }
    app.tool.move(app, this.toolEvent(s, e));
    app.requestRender();
  }

  private pointerUp(e: PointerEvent): void {
    const app = this.app;
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!app.project || !d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    this.drag = null;
    const s = this.screenPos(e);
    this.canvas.style.cursor = app.tool.cursor;
    switch (d.kind) {
      case 'pending':
        if (d.button === 0) {
          app.tool.click(app, this.toolEvent(s, e));
          app.tool.move(app, this.toolEvent(s, e));
        }
        break;
      case 'rubber': {
        const rect = normRect(app.cam.toScene(d.start), app.cam.toScene(d.end));
        const ids: string[] = d.additive ? [...app.selection] : [];
        for (const l of app.project.layers) {
          if (!l.visible) continue;
          for (const it of l.items) if (itemTouchesRect(it, rect, app.sizeOf) && !ids.includes(it.id)) ids.push(it.id);
        }
        app.setSelection(ids);
        break;
      }
      case 'movePixmap':
      case 'movePoint': {
        const after = app.project.layers;
        app.showLayers(d.before);
        if (after !== d.before) app.commit(d.kind === 'movePoint' ? 'déplacer le point' : 'déplacer l\'image', after);
        if (d.kind === 'movePoint') app.status(app.selectionStatus() + app.staleNote());
        break;
      }
    }
    app.requestRender();
  }

  private wheel(e: WheelEvent): void {
    const app = this.app;
    if (!app.project) return;
    e.preventDefault();
    const s = this.screenPos(e);
    const px = app.selectedPixmap();
    if (e.shiftKey && px) {
      const f = e.deltaY + e.deltaX < 0 ? this.pixmapStep : 2 - this.pixmapStep;
      app.updateItem(px.id, { scale: px.scale * f }, 'échelle de l\'image', `scale-${px.id}`);
      app.status(app.selectionStatus());
      return;
    }
    // Lines (mouse wheel) or pixels (touchpad); ctrlKey = touchpad pinch.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    app.zoom(Math.pow(ZOOM_STEP, -delta / (e.ctrlKey ? 25 : 100)), s);
  }

  private async contextMenu(screen: Pt, cx: number, cy: number): Promise<void> {
    const app = this.app;
    if (!app.project) return;
    const hit = app.pick(screen);
    if (hit && hit.item.kind !== 'pixmap' && app.selection.has(hit.item.id)) {
      await app.chooseStyle();
      return;
    }
    if (!app.currentLayer) return app.status('Créez ou choisissez d\'abord un calque.');
    const scene = app.snapTarget(screen) ?? app.cam.toScene(screen);
    const groups: Record<string, string> = { lines: 'Droites', circles: 'Cercles et ellipse', arcs: 'Arcs et spirale' };
    const entries: ({ label: string; value: ToolId; icon?: string } | { group: string })[] = [];
    let last = '';
    for (const t of TOOLS.filter((t) => t.group !== 'nav')) {
      if (t.group !== last && groups[t.group]) entries.push({ group: groups[t.group] });
      last = t.group;
      entries.push({ label: t.label, value: t.id, icon: icon(t.icon) });
    }
    const chosen = await popupMenu(cx, cy, entries);
    if (!chosen) return;
    app.setTool(chosen);
    // Mark the spot with a point, a handy anchor for the next clicks.
    app.addShapes([{ kind: 'point', p: scene, weight: 0 }], 'point', { width: 7 });
  }

  /* --------------------------------------------------------- keyboard */

  private keyDown(e: KeyboardEvent): void {
    const app = this.app;
    if (!app.project) return;
    const t = e.target as HTMLElement;
    if (t && (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]'))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl) {
      if (k === 'z' && !e.shiftKey) app.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) app.redo();
      else if (k === 's') void app.session.exportZip();
      else if (k === 'a') app.setSelection(app.currentLayer?.items.map((i) => i.id) ?? []);
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    if (app.tool.key(app, e) || this.pixmapKey(e)) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Escape':
        if (app.toolId === 'select') app.setSelection([]);
        else app.tool.reset(app);
        break;
      case 'Delete':
      case 'Backspace':
        app.deleteSelection();
        break;
      case ' ':
        app.selectNext();
        break;
      default: {
        if (k === 'c') void app.chooseColor();
        else if (k === 't') void app.chooseWidth();
        else if (k === 'w') void app.editPointWeight();
        else if (k === 'a') void app.editArcAngle();
        else if (k === 'i') app.addIntersections();
        else if (k === 's') void app.spiralOptions();
        else if (k === 'f') app.zoomToFit();
        else if (k === '+' || k === '=') app.zoom(ZOOM_STEP);
        else if (k === '-') app.zoom(1 / ZOOM_STEP);
        else {
          const def = TOOLS.find((d) => d.key?.toLowerCase() === k);
          if (!def) return;
          app.setTool(def.id);
        }
      }
    }
    e.preventDefault();
  }

  /** Keyboard control of the selected picture (port of Item_pixmap::keyPressEvent). */
  private pixmapKey(e: KeyboardEvent): boolean {
    const app = this.app;
    const px = app.selectedPixmap();
    if (!px) return false;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowLeft':
        app.updateItem(px.id, { rotation: px.rotation - step }, 'rotation de l\'image', `rot-${px.id}`);
        break;
      case 'ArrowRight':
        app.updateItem(px.id, { rotation: px.rotation + step }, 'rotation de l\'image', `rot-${px.id}`);
        break;
      case '+':
        app.updateItem(px.id, { scale: px.scale * this.pixmapStep }, 'échelle de l\'image', `scale-${px.id}`);
        break;
      case '-':
        app.updateItem(px.id, { scale: px.scale * (2 - this.pixmapStep) }, 'échelle de l\'image', `scale-${px.id}`);
        break;
      case '0':
        this.pixmapStep = 1.0204;
        break;
      case '1':
        this.pixmapStep = 1.005;
        break;
      case '2':
        this.pixmapStep = 1.0005;
        break;
      default:
        return false;
    }
    app.status(app.selectionStatus() + ` — pas d'échelle ${fmt((this.pixmapStep - 1) * 100, 2)} %`);
    return true;
  }
}
