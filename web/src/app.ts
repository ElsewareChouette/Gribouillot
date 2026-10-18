/**
 * The application: project state, user input, rendering loop and commands.
 */

import { Camera, ZOOM_STEP } from './camera';
import { angleTo, dist, extendLine, mid, pt, seg, type Pt, type Rect } from './geom';
import { History } from './history';
import { Picture } from './images';
import {
  exportProjectZip,
  importLayers,
  importProject,
  isImageName,
  mimeOf,
  safeFileName,
  download,
  type ImportResult,
} from './io';
import {
  emptyLayer,
  emptyProject,
  formatLength,
  freshLayerName,
  isStroke,
  newId,
  unitPerPx,
  type Item,
  type ItemKind,
  type Layer,
  type LineItem,
  type PixmapItem,
  type Project,
} from './model';
import { HIGHLIGHT, Renderer } from './render';
import { arcLength, itemDistance, itemTouchesRect, pickTolerance } from './shapes';
import * as store from './store';
import { TOOLS, toolDef, type Tool, type ToolEvent, type ToolId } from './tools';
import { alertDialog, confirmDialog, openDialog, popupMenu, promptNumber, promptText, styleDialog } from './ui/dialogs';
import { fmt, h, pickFiles } from './ui/dom';
import { icon } from './ui/icons';

export interface Hit {
  item: Item;
  layer: Layer;
}

export interface Options {
  drawCenter: boolean;
  weights: boolean;
  minimap: boolean;
  gray: boolean;
  spiral: { oneItem: boolean; showBase: boolean; centersOnly: boolean };
}

const OPTIONS_KEY = 'gribouillot.options';
const DRAG_THRESHOLD = 5; // px

function loadOptions(): Options {
  const def: Options = { drawCenter: false, weights: false, minimap: true, gray: false, spiral: { oneItem: true, showBase: false, centersOnly: true } };
  try {
    const s = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
    return { ...def, ...s, spiral: { ...def.spiral, ...(s.spiral ?? {}) }, gray: false };
  } catch {
    return def;
  }
}

type Drag =
  | { kind: 'pending'; start: Pt; last: Pt; button: number; pixmap?: PixmapItem; ctrl: boolean; shift: boolean }
  | { kind: 'pan'; last: Pt }
  | { kind: 'rubber'; start: Pt; end: Pt; additive: boolean }
  | { kind: 'movePixmap'; id: string; startScene: Pt; orig: Pt; before: Layer[] }
  | { kind: 'pinch'; dist: number; mid: Pt };

export class App {
  project: Project | null = null;
  readonly cam = new Camera();
  readonly history = new History();
  readonly pictures = new Map<string, Picture>();
  selection = new Set<string>();
  currentLayerId: string | null = null;
  options: Options = loadOptions();
  tool: Tool;
  toolId: ToolId = 'select';
  previousToolId: ToolId = 'select';

  /** Called whenever the UI (panels, toolbar) must be refreshed. */
  onChange: () => void = () => {};
  /** Called when the start screen must be shown or hidden. */
  onProjectOpen: (open: boolean) => void = () => {};

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: Renderer;
  private readonly statusEl: HTMLElement;
  private readonly coordsEl: HTMLElement;
  private dpr = 1;
  private renderQueued = false;
  private saveTimer: number | undefined;
  private drag: Drag | null = null;
  private pointers = new Map<number, Pt>();
  private mouseScreen: Pt | null = null;
  saving = false;

  constructor(canvas: HTMLCanvasElement, statusEl: HTMLElement, coordsEl: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.renderer = new Renderer(this.ctx, this.cam);
    this.statusEl = statusEl;
    this.coordsEl = coordsEl;
    this.tool = toolDef('select').make();
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
  }

  /* ============================================================ basics */

  get currentLayer(): Layer | null {
    return this.project?.layers.find((l) => l.id === this.currentLayerId) ?? null;
  }

  status(msg: string): void {
    this.statusEl.textContent = msg;
  }

  saveOptions(): void {
    try {
      const { gray: _gray, ...rest } = this.options;
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(rest));
    } catch {
      /* private mode */
    }
  }

  stroke(): { id: string; color: string; width: number } {
    return { id: newId(), color: this.project!.color, width: this.project!.width };
  }

  lineThrough(a: Pt, b: Pt): LineItem | null {
    const s = extendLine(a, b);
    return s ? { kind: 'line', ...this.stroke(), p1: s.p1, p2: s.p2 } : null;
  }

  unitPerPx(): number {
    return this.project ? unitPerPx(this.project.scale) : 0;
  }

  formatLength(px: number, digits = 1): string {
    return this.project ? formatLength(px, this.project.scale, digits).replace('.', ',') : '';
  }

  sizeOf = (file: string) => this.pictures.get(file);

  /* ========================================================= rendering */

  private resize(): void {
    const parent = this.canvas.parentElement!;
    const r = parent.getBoundingClientRect();
    const center = this.project ? this.cam.center() : null;
    this.dpr = window.devicePixelRatio || 1;
    this.cam.width = Math.max(1, r.width);
    this.cam.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cam.width * this.dpr);
    this.canvas.height = Math.round(this.cam.height * this.dpr);
    this.canvas.style.width = `${this.cam.width}px`;
    this.canvas.style.height = `${this.cam.height}px`;
    if (center) this.cam.centerOn(center);
    this.requestRender();
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.draw();
    });
  }

  private mapPicture(): Picture | undefined {
    const f = this.project?.mapFile;
    return f ? this.pictures.get(f) : undefined;
  }

  private draw(): void {
    const r = this.renderer;
    r.clear('#e9e7e1', this.dpr);
    const p = this.project;
    if (!p) return;
    const map = this.mapPicture();
    if (map) r.map(map, this.options.gray && map.hasGray(), this.dpr);
    r.layers(p.layers, { selection: this.selection, showWeight: this.options.weights, pictures: this.pictures, dpr: this.dpr });
    this.tool.overlay(r, this);
    // Snap indicator on the point under the mouse.
    if (this.mouseScreen && this.tool.draws) {
      const s = this.snapTarget(this.mouseScreen);
      if (s) {
        const c = this.cam.toScreen(s);
        this.ctx.beginPath();
        this.ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);
        this.ctx.strokeStyle = HIGHLIGHT;
        this.ctx.stroke();
      }
    }
    if (this.drag?.kind === 'rubber') r.rubberBand(normRect(this.drag.start, this.drag.end));
    this.afterRender?.();
  }

  /** Hook for the minimap and the scale bar. */
  afterRender?: () => void;

  /* ========================================================== picking */

  /**
   * The item under a screen position: the closest one within its pick
   * tolerance, points first. Only visible layers are considered.
   */
  pick(screen: Pt, kinds?: ItemKind[], layerId?: string): Hit | null {
    const p = this.project;
    if (!p) return null;
    const scene = this.cam.toScene(screen);
    let best: Hit | null = null;
    let bestScore = Infinity;
    for (let li = p.layers.length - 1; li >= 0; li--) {
      const layer = p.layers[li];
      if (!layer.visible || (layerId && layer.id !== layerId)) continue;
      for (let i = layer.items.length - 1; i >= 0; i--) {
        const it = layer.items[i];
        if (kinds && !kinds.includes(it.kind)) continue;
        const d = itemDistance(it, scene, this.cam.zoom, this.sizeOf);
        if (d > pickTolerance(it)) continue;
        // Points win over lines, lines over pictures.
        const score = d + (it.kind === 'point' ? -100 : it.kind === 'pixmap' ? 100 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = { item: it, layer };
        }
      }
    }
    return best;
  }

  /** Center of the visible point under the given screen position, if any. */
  snapTarget(screen: Pt): Pt | null {
    const hit = this.pick(screen, ['point']);
    return hit && hit.item.kind === 'point' ? hit.item.p : null;
  }

  isOnPoint(screen: Pt): boolean {
    return this.snapTarget(screen) !== null;
  }

  findItem(id: string): Hit | null {
    for (const layer of this.project?.layers ?? []) {
      const item = layer.items.find((i) => i.id === id);
      if (item) return { item, layer };
    }
    return null;
  }

  inCurrentLayer(id: string): boolean {
    return this.currentLayer?.items.some((i) => i.id === id) ?? false;
  }

  selectedItems(): Hit[] {
    return [...this.selection].map((id) => this.findItem(id)).filter((h): h is Hit => h !== null);
  }

  /** Selected items which belong to the current layer (the only ones that can be edited). */
  editableSelection(): Item[] {
    const l = this.currentLayer;
    return l ? l.items.filter((i) => this.selection.has(i.id)) : [];
  }

  setSelection(ids: string[]): void {
    this.selection = new Set(ids);
    this.selectionChanged();
  }

  toggleSelection(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.selectionChanged();
  }

  private selectionChanged(): void {
    if (this.toolId === 'select') this.status(this.selectionStatus());
    this.requestRender();
  }

  /** Information about the selection for the status bar (port of sceneSelectionChanged). */
  private selectionStatus(): string {
    const sel = this.selectedItems().map((h) => h.item);
    const L = (px: number) => this.formatLength(px);
    if (sel.length === 0) return '';
    if (sel.length === 1) {
      const it = sel[0];
      switch (it.kind) {
        case 'point':
          return `Point (${fmt(it.p.x, 1)} ; ${fmt(it.p.y, 1)})${it.weight ? `, poids ${it.weight}` : ''} — [W] : changer le poids`;
        case 'segment':
          return `Segment de longueur ${L(dist(it.p1, it.p2))}`;
        case 'line':
          return 'Droite infinie';
        case 'circle':
          return `Cercle de rayon ${L(it.r)} — circonférence ${L(2 * Math.PI * it.r)}`;
        case 'arc':
          return `Arc de ${fmt(Math.abs(it.span), 1)}° — longueur ${L(arcLength(it))}, rayon ${L(it.r)} — [A] : changer l'angle`;
        case 'ellipse':
          return `Ellipse : somme des distances aux foyers ${L(it.dSum)}, distance entre les foyers ${L(dist(it.f1, it.f2))}`;
        case 'spiral':
          return 'Spirale à 4 centres';
        case 'pixmap':
          return `Image ${it.file} — échelle ${fmt(it.scale, 3)}, rotation ${fmt(((it.rotation % 360) + 360) % 360, 1)}° — [←][→] tourner, [+][−] ou [Maj]+molette : échelle, [0][1][2] : pas`;
      }
    }
    const lines = sel.filter((i) => i.kind === 'segment' || i.kind === 'line') as LineItem[];
    const points = sel.filter((i) => i.kind === 'point');
    const circles = sel.filter((i) => i.kind === 'circle');
    if (sel.length === 2 && lines.length === 2) {
      let a = angleTo(seg(lines[0].p1, lines[0].p2), seg(lines[1].p1, lines[1].p2));
      if (a > 180) a = 360 - a;
      if (Math.abs(a) < 1e-9 || Math.abs(a - 180) < 1e-9) return 'Les 2 droites sont strictement parallèles.';
      if (Math.abs(a - 90) < 1e-9) return 'Les 2 droites sont strictement perpendiculaires.';
      return `Angle entre les 2 droites : ${fmt(a, 2)}° / ${fmt(180 - a, 2)}°`;
    }
    if (sel.length === 2 && lines.length === 1 && points.length === 1) {
      const p = (points[0] as { p: Pt }).p, l = lines[0];
      const d = Math.abs((l.p2.y - l.p1.y) * p.x - (l.p2.x - l.p1.x) * p.y + l.p2.x * l.p1.y - l.p2.y * l.p1.x) / dist(l.p1, l.p2);
      return `Distance orthogonale entre le point et la droite : ${L(d)}`;
    }
    if (sel.length === 2 && points.length === 2) {
      const [a, b] = points.map((i) => (i as { p: Pt }).p);
      return `Distance entre les 2 points : ${L(dist(a, b))}`;
    }
    if (sel.length === 2 && points.length === 1 && circles.length === 1) {
      const p = (points[0] as { p: Pt }).p, c = circles[0] as { c: Pt; r: number };
      const d = dist(p, c.c);
      return `Distance du point au centre du cercle : ${L(d)} ; au cercle : ${L(d - c.r)}`;
    }
    return `${sel.length} éléments sélectionnés`;
  }

  /* ============================================================ editing */

  /** Replace the layers (an undoable change). */
  commit(label: string, layers: Layer[], mergeKey?: string): void {
    const p = this.project!;
    this.history.push(label, p.layers, layers, mergeKey);
    p.layers = layers;
    this.changed();
  }

  /** Something changed in the project: refresh, save. */
  changed(): void {
    this.requestRender();
    this.onChange();
    this.scheduleSave();
  }

  private withLayer(layerId: string, f: (items: Item[]) => Item[]): Layer[] {
    return this.project!.layers.map((l) => (l.id === layerId ? { ...l, items: f(l.items) } : l));
  }

  private requireLayer(): Layer | null {
    const l = this.currentLayer;
    if (!l) {
      this.status('Créez ou choisissez d\'abord un calque.');
      return null;
    }
    return l;
  }

  /** Add items to the current layer, plus the center point if that option is on. */
  addItems(items: Item[], label: string, center?: Pt): void {
    this.replaceItems([], items, label, center);
  }

  replaceItems(removeIds: string[], items: Item[], label: string, center?: Pt): void {
    const l = this.requireLayer();
    if (!l || (items.length === 0 && removeIds.length === 0)) return;
    const all = [...items];
    if (center && this.options.drawCenter) all.push({ kind: 'point', ...this.stroke(), p: center, weight: 0 });
    const rm = new Set(removeIds);
    this.commit(label, this.withLayer(l.id, (its) => [...its.filter((i) => !rm.has(i.id)), ...all]));
    for (const id of rm) this.selection.delete(id);
  }

  async addPoint(p: Pt, width?: number): Promise<void> {
    if (!this.requireLayer()) return;
    let weight = 0;
    if (this.options.weights) {
      const w = await promptNumber('Point pondéré', 'Poids du point', 0, { integer: true, min: -999, max: 999 });
      if (w === null) return;
      weight = Math.round(w);
    }
    this.addItems([{ kind: 'point', ...this.stroke(), width: width ?? this.project!.width, p, weight }], 'point');
  }

  undo(): void {
    const e = this.history.undo();
    if (!e || !this.project) return this.status('Rien à annuler.');
    this.project.layers = e.before;
    this.afterHistory(`Annulé : ${e.label}`);
  }

  redo(): void {
    const e = this.history.redo();
    if (!e || !this.project) return this.status('Rien à rétablir.');
    this.project.layers = e.after;
    this.afterHistory(`Rétabli : ${e.label}`);
  }

  private afterHistory(msg: string): void {
    const p = this.project!;
    if (!p.layers.some((l) => l.id === this.currentLayerId)) this.currentLayerId = p.layers[p.layers.length - 1]?.id ?? null;
    for (const id of [...this.selection]) if (!this.findItem(id)) this.selection.delete(id);
    this.tool.reset(this);
    this.status(msg);
    this.changed();
  }

  private cannot(what: string): void {
    this.status(this.selection.size > 0
      ? `Les éléments sélectionnés appartiennent à un autre calque : impossible de ${what}.`
      : `Aucun élément à ${what}.`);
  }

  deleteSelection(): void {
    const items = this.editableSelection();
    if (!items.length) return this.cannot('supprimer');
    const ids = new Set(items.map((i) => i.id));
    this.commit('suppression', this.withLayer(this.currentLayerId!, (its) => its.filter((i) => !ids.has(i.id))));
    for (const id of ids) this.selection.delete(id);
    this.status(`${items.length} élément(s) supprimé(s).`);
  }

  /** Color (C key): of the selection if any, else of the next drawings. */
  async chooseColor(): Promise<void> {
    const p = this.project;
    if (!p) return;
    const items = this.editableSelection().filter(isStroke);
    const first = items[0];
    const r = await styleDialog(items.length ? 'Couleur des éléments sélectionnés' : 'Couleur de dessin', first?.color ?? p.color, first?.width ?? p.width, p.customColors, { showWidth: false });
    if (!r) return;
    this.rememberColor(r.color);
    if (items.length) this.restyle(items.map((i) => i.id), { color: r.color });
    else {
      p.color = r.color;
      this.changed();
    }
  }

  /** Thickness (T key) of the selection. */
  async chooseWidth(): Promise<void> {
    const items = this.editableSelection().filter(isStroke);
    if (!items.length) return this.cannot('changer d\'épaisseur');
    const r = await styleDialog('Épaisseur des éléments sélectionnés', items[0].color, items[0].width, this.project!.customColors, { showColor: false });
    if (r) this.restyle(items.map((i) => i.id), { width: r.width });
  }

  /** Color and thickness together (right-click on a selected item). */
  async chooseStyle(): Promise<void> {
    const items = this.editableSelection().filter(isStroke);
    if (!items.length) return this.cannot('modifier');
    const r = await styleDialog('Couleur et épaisseur', items[0].color, items[0].width, this.project!.customColors);
    if (!r) return;
    this.rememberColor(r.color);
    this.restyle(items.map((i) => i.id), r);
  }

  private rememberColor(c: string): void {
    const p = this.project!;
    p.customColors = [c, ...p.customColors.filter((x) => x !== c)].slice(0, 16);
  }

  private restyle(ids: string[], patch: { color?: string; width?: number }): void {
    const set = new Set(ids);
    this.commit('style', this.withLayer(this.currentLayerId!, (its) => its.map((i) => (set.has(i.id) && isStroke(i) ? { ...i, ...patch } as Item : i))));
  }

  /** Space: select the next item of the current layer. */
  selectNext(): void {
    const l = this.currentLayer;
    if (!l?.items.length) return;
    let idx = -1;
    l.items.forEach((i, k) => {
      if (this.selection.has(i.id)) idx = k;
    });
    this.setSelection([l.items[(idx + 1) % l.items.length].id]);
  }

  updateItem(id: string, patch: Partial<Item>, label: string, mergeKey?: string): void {
    const hit = this.findItem(id);
    if (!hit) return;
    this.commit(label, this.withLayer(hit.layer.id, (its) => its.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i))), mergeKey);
  }

  async editPointWeight(): Promise<void> {
    const pts = this.editableSelection().filter((i) => i.kind === 'point');
    if (!pts.length) return this.cannot('pondérer');
    const w = await promptNumber('Poids du point', 'Poids', pts[0].kind === 'point' ? pts[0].weight : 0, { integer: true, min: -999, max: 999 });
    if (w === null) return;
    const ids = new Set(pts.map((p) => p.id));
    this.commit('poids', this.withLayer(this.currentLayerId!, (its) => its.map((i) => (ids.has(i.id) && i.kind === 'point' ? { ...i, weight: Math.round(w) } : i))));
    if (!this.options.weights) this.status('Astuce : activez « Pondération » pour afficher les poids.');
  }

  async editArcAngle(): Promise<void> {
    const arc = this.editableSelection().find((i) => i.kind === 'arc');
    if (!arc || arc.kind !== 'arc') return this.cannot('modifier');
    const a = await promptNumber('Angle de l\'arc', 'Angle (positif : sens anti-horaire)', arc.span, { unit: '°', min: -360, max: 360, hint: `soit ${fmt((arc.span * Math.PI) / 180, 4)} rad` });
    if (a !== null) this.updateItem(arc.id, { span: a }, 'angle de l\'arc');
  }

  /** Keyboard control of the selected picture (port of Item_pixmap::keyPressEvent). */
  private pixmapStep = 1.0204;

  private selectedPixmap(): PixmapItem | null {
    const sel = this.editableSelection();
    return sel.length === 1 && sel[0].kind === 'pixmap' ? sel[0] : null;
  }

  private pixmapKey(e: KeyboardEvent): boolean {
    const px = this.selectedPixmap();
    if (!px) return false;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowLeft':
        this.updateItem(px.id, { rotation: px.rotation - step }, 'rotation de l\'image', `rot-${px.id}`);
        break;
      case 'ArrowRight':
        this.updateItem(px.id, { rotation: px.rotation + step }, 'rotation de l\'image', `rot-${px.id}`);
        break;
      case '+':
        this.updateItem(px.id, { scale: px.scale * this.pixmapStep }, 'échelle de l\'image', `scale-${px.id}`);
        break;
      case '-':
        this.updateItem(px.id, { scale: px.scale * (2 - this.pixmapStep) }, 'échelle de l\'image', `scale-${px.id}`);
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
    this.status(this.selectionStatus() + ` — pas d'échelle ${fmt((this.pixmapStep - 1) * 100, 2)} %`);
    return true;
  }

  async addPicture(): Promise<void> {
    if (!this.requireLayer()) return;
    const [file] = await pickFiles({ accept: 'image/*' });
    if (file) await this.addPictureFile(file);
  }

  async addPictureFile(file: File | Blob, name?: string): Promise<void> {
    const l = this.requireLayer();
    if (!l) return;
    const fileName = await this.storeFile(name ?? (file as File).name ?? 'image.png', file);
    const pic = await this.loadPicture(fileName, file, false);
    if (!pic) return;
    const c = this.cam.center();
    const fit = Math.min(1, (this.cam.width / this.cam.zoom) * 0.6 / pic.w, (this.cam.height / this.cam.zoom) * 0.6 / pic.h);
    const item: PixmapItem = { kind: 'pixmap', id: newId(), x: c.x - pic.w / 2, y: c.y - pic.h / 2, scale: fit, rotation: 0, file: fileName };
    this.addItems([item], 'image');
    this.setTool('select');
    this.setSelection([item.id]);
  }

  /** Store a file of the project, renaming it if another file has the same name. */
  private async storeFile(name: string, blob: Blob): Promise<string> {
    const p = this.project!;
    const existing = await store.listFiles(p.id);
    let fileName = safeFileName(name);
    if (existing.includes(fileName)) {
      const old = await store.getFile(p.id, fileName);
      if (!old || old.size !== blob.size) {
        const [stem, ext] = splitExt(fileName);
        for (let i = 2; existing.includes(fileName); i++) fileName = `${stem}_${i}${ext}`;
      }
    }
    await store.putFile(p.id, fileName, blob);
    return fileName;
  }

  private async loadPicture(name: string, blob: Blob, mips = true): Promise<Picture | null> {
    try {
      const pic = await Picture.load(blob, mips);
      this.pictures.get(name)?.close();
      this.pictures.set(name, pic);
      this.requestRender();
      return pic;
    } catch (e) {
      await alertDialog('Image illisible', `Impossible de lire l'image « ${name} » : ${(e as Error).message ?? e}`);
      return null;
    }
  }

  async centerOfMass(): Promise<void> {
    const l = this.requireLayer();
    if (!l) return;
    const pts = l.items.filter((i) => i.kind === 'point' && i.weight !== 0) as { p: Pt; weight: number }[];
    if (!pts.length) {
      await alertDialog('Centre de masse', 'Aucun point pondéré dans ce calque. Activez « Pondération » puis créez des points avec un poids (ou sélectionnez un point et appuyez sur [W]).');
      return;
    }
    const wSum = pts.reduce((s, q) => s + q.weight, 0);
    if (wSum === 0) {
      await alertDialog('Centre de masse', 'La somme des poids est nulle : le centre de masse n\'est pas défini.');
      return;
    }
    const com = pt(pts.reduce((s, q) => s + q.weight * q.p.x, 0) / wSum, pts.reduce((s, q) => s + q.weight * q.p.y, 0) / wSum);
    const list = h('ol', { class: 'com-list' }, ...pts.map((q) => h('li', {}, `Point (${fmt(q.p.x, 0)} ; ${fmt(q.p.y, 0)}) — poids ${q.weight}`)));
    const ok = await openDialog('Centre de masse', h('div', {}, list, h('p', {}, `Centre de masse : (${fmt(com.x, 1)} ; ${fmt(com.y, 1)})`)), [
      { label: 'Annuler', value: false },
      { label: 'Placer le point', value: true, primary: true },
    ]);
    if (!ok) return;
    this.addItems([{ kind: 'point', ...this.stroke(), p: com, weight: 0 }], 'centre de masse');
    this.cam.centerOn(com);
    this.requestRender();
  }

  /* ============================================================ layers */

  setCurrentLayer(id: string): void {
    this.currentLayerId = id;
    this.tool.reset(this);
    this.onChange();
    this.scheduleSave();
  }

  addLayer(): void {
    const p = this.project!;
    const layer = emptyLayer(freshLayerName(p.layers));
    const idx = p.layers.findIndex((l) => l.id === this.currentLayerId);
    const layers = [...p.layers];
    layers.splice(idx < 0 ? layers.length : idx + 1, 0, layer);
    this.currentLayerId = layer.id;
    this.commit('nouveau calque', layers);
  }

  async renameLayer(id: string): Promise<void> {
    const p = this.project!;
    const l = p.layers.find((x) => x.id === id);
    if (!l) return;
    const name = await promptText('Renommer le calque', 'Nom du calque', l.name, 'Le nom sert aussi de nom de fichier (.xml) à l\'export.');
    if (!name || name === l.name) return;
    if (p.layers.some((x) => x.id !== id && x.name === name)) {
      await alertDialog('Nom déjà utilisé', `Un autre calque s'appelle déjà « ${name} ».`);
      return;
    }
    this.commit('renommer le calque', p.layers.map((x) => (x.id === id ? { ...x, name } : x)));
  }

  async deleteLayer(id: string): Promise<void> {
    const p = this.project!;
    const l = p.layers.find((x) => x.id === id);
    if (!l) return;
    if (l.items.length && !(await confirmDialog('Supprimer le calque', `Supprimer le calque « ${l.name} » et ses ${l.items.length} élément(s) ? (Ctrl+Z pour annuler)`, 'Supprimer', true))) return;
    const idx = p.layers.indexOf(l);
    const layers = p.layers.filter((x) => x.id !== id);
    if (this.currentLayerId === id) this.currentLayerId = layers[Math.max(0, idx - 1)]?.id ?? null;
    this.commit('supprimer le calque', layers);
  }

  toggleLayerVisibility(id: string): void {
    const p = this.project!;
    p.layers = p.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    this.changed();
  }

  setLayerOpacity(id: string, opacity: number): void {
    const p = this.project!;
    p.layers = p.layers.map((l) => (l.id === id ? { ...l, opacity } : l));
    this.requestRender();
    this.scheduleSave();
  }

  moveLayer(id: string, toIndex: number): void {
    const p = this.project!;
    const from = p.layers.findIndex((l) => l.id === id);
    if (from < 0 || from === toIndex) return;
    const layers = [...p.layers];
    const [l] = layers.splice(from, 1);
    layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
    this.commit('ordre des calques', layers);
  }

  async importLayerFiles(files: File[] | { path: string; blob: Blob }[]): Promise<void> {
    const p = this.project!;
    const input = files.map((f) => ('path' in f ? f : { path: f.webkitRelativePath || f.name, blob: f }));
    const { layers, files: pics } = await importLayers(input);
    if (!layers.length) {
      await alertDialog('Import de calque', 'Aucun fichier de calque Gribouillot (.xml) trouvé.');
      return;
    }
    for (const [name, blob] of pics) {
      await store.putFile(p.id, name, blob);
      await this.loadPicture(name, blob, false);
    }
    const added = layers.map(({ layer }) => {
      let name = layer.name;
      for (let i = 2; p.layers.some((l) => l.name === name); i++) name = `${layer.name}_${i}`;
      return { ...layer, name };
    });
    this.currentLayerId = added[added.length - 1].id;
    this.commit('import de calque', [...p.layers, ...added]);
    this.status(`${added.length} calque(s) importé(s).`);
  }

  async pickLayerFiles(): Promise<void> {
    const files = await pickFiles({ accept: '.xml,.zip', multiple: true });
    if (files.length) await this.importLayerFiles(files);
  }

  /* =========================================================== map/scale */

  setScale(patch: Partial<Project['scale']>): void {
    const p = this.project!;
    p.scale = { ...p.scale, ...patch };
    this.changed();
  }

  async calibrate(px: number): Promise<void> {
    const p = this.project!;
    const v = await promptNumber('Échelle de la carte', `Cette distance de ${fmt(px, 2)} px correspond à :`, p.scale.value || 1, {
      min: 0,
      unit: p.scale.unit,
      hint: 'Saisissez la distance réelle (vous pouvez changer l\'unité km / m dans le panneau Carte).',
    });
    if (v !== null && v > 0) {
      this.setScale({ px, value: v });
      this.status(`Échelle définie : ${fmt(px, 2)} px = ${fmt(v, 3)} ${p.scale.unit}.`);
    }
    this.setTool('select');
  }

  async toggleGray(): Promise<void> {
    const map = this.mapPicture();
    this.options.gray = !this.options.gray;
    if (this.options.gray && map && !map.hasGray()) {
      this.status('Conversion de la carte en noir et blanc…');
      try {
        await map.ensureGray();
        this.status('');
      } catch (e) {
        this.options.gray = false;
        this.status(`Conversion impossible : ${(e as Error).message}`);
      }
    }
    this.changed();
  }

  async changeMap(): Promise<void> {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (file) await this.setMapFile(file.name, file);
  }

  private async setMapFile(name: string, blob: Blob): Promise<void> {
    const p = this.project!;
    const fileName = await this.storeFile(name, blob);
    p.mapFile = fileName;
    if (!p.mapName) p.mapName = splitExt(fileName)[0];
    this.options.gray = false;
    await this.loadMap(true);
    this.changed();
  }

  async renameMap(): Promise<void> {
    const p = this.project!;
    const n = await promptText('Nom de la carte', 'Nom affiché (le fichier n\'est pas renommé)', p.mapName || '');
    if (n !== null) {
      p.mapName = n;
      this.changed();
    }
  }

  private async loadMap(fit: boolean): Promise<void> {
    const p = this.project!;
    this.cam.bounds = null;
    if (!p.mapFile) return;
    const blob = await store.getFile(p.id, p.mapFile);
    if (!blob) {
      this.status(`Carte « ${p.mapFile} » introuvable dans le navigateur.`);
      return;
    }
    this.status('Chargement de la carte…');
    const pic = await this.loadPicture(p.mapFile, blob, true);
    if (!pic) return;
    this.cam.bounds = { x: 0, y: 0, w: pic.w, h: pic.h };
    if (fit) this.zoomToFit();
    this.status('');
  }

  /* ============================================================== view */

  zoomToFit(): void {
    const map = this.mapPicture();
    let r: Rect | null = map ? { x: 0, y: 0, w: map.w, h: map.h } : null;
    if (!r) {
      // No map: fit the drawings.
      const pts: Pt[] = [];
      for (const l of this.project?.layers ?? []) for (const it of l.items) if (it.kind === 'point') pts.push(it.p);
      if (pts.length) {
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        r = { x: Math.min(...xs) - 50, y: Math.min(...ys) - 50, w: Math.max(...xs) - Math.min(...xs) + 100, h: Math.max(...ys) - Math.min(...ys) + 100 };
      }
    }
    if (r) this.cam.fit(r);
    this.viewChanged();
  }

  zoom(factor: number, anchor?: Pt): void {
    this.cam.zoomBy(factor, anchor);
    this.viewChanged();
  }

  setZoom(z: number): void {
    this.cam.setZoom(z);
    this.viewChanged();
  }

  private viewChanged(): void {
    this.requestRender();
    this.scheduleSave();
  }

  /* ============================================================= tools */

  setTool(id: ToolId): void {
    if (!this.project) return;
    const def = toolDef(id);
    const t = def.make();
    if (t.draws && !this.currentLayer) {
      this.status('Créez ou choisissez d\'abord un calque.');
      return;
    }
    this.previousToolId = this.toolId;
    this.tool = t;
    this.toolId = id;
    this.canvas.style.cursor = t.cursor;
    t.start(this);
    this.onChange();
    this.requestRender();
  }

  /* ============================================================ input */

  private toolEvent(screen: Pt, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): ToolEvent {
    const raw = this.cam.toScene(screen);
    const snapped = this.tool.draws || this.toolId === 'measure' || this.toolId === 'protractor' || this.toolId === 'calibrate' ? this.snapTarget(screen) : null;
    return { p: snapped ?? raw, raw, screen, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private screenPos(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.drag = null;
      this.requestRender();
    });
    c.addEventListener('pointerleave', () => {
      this.mouseScreen = null;
      this.coordsEl.textContent = '';
      this.requestRender();
    });
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void this.contextMenu(this.screenPos(e), e.clientX, e.clientY);
    });
    c.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
    window.addEventListener('keydown', (e) => this.keyDown(e));
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.project) return;
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
    if (e.button === 1 || (e.button === 0 && this.toolId === 'pan')) {
      e.preventDefault();
      this.drag = { kind: 'pan', last: s };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    let pixmap: PixmapItem | undefined;
    if (this.toolId === 'select') {
      const hit = this.pick(s);
      if (hit?.item.kind === 'pixmap' && hit.layer.id === this.currentLayerId) pixmap = hit.item;
    }
    this.drag = { kind: 'pending', start: s, last: s, button: e.button, pixmap, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.project) return;
    const s = this.screenPos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);
    this.mouseScreen = s;
    const scene = this.cam.toScene(s);
    this.coordsEl.textContent = `x ${fmt(scene.x, 0)} · y ${fmt(scene.y, 0)} px`;
    const d = this.drag;
    if (d?.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const nd = dist(a, b), nm = mid(a, b);
      if (d.dist > 0) this.cam.zoomBy(nd / d.dist, nm);
      this.cam.panBy(nm.x - d.mid.x, nm.y - d.mid.y);
      d.dist = nd;
      d.mid = nm;
      this.viewChanged();
      return;
    }
    if (d?.kind === 'pending' && dist(s, d.start) > DRAG_THRESHOLD) {
      if (this.toolId === 'select' && d.pixmap) {
        this.setSelection([d.pixmap.id]);
        this.drag = { kind: 'movePixmap', id: d.pixmap.id, startScene: this.cam.toScene(d.start), orig: pt(d.pixmap.x, d.pixmap.y), before: this.project.layers };
      } else if (this.toolId === 'select') {
        this.drag = { kind: 'rubber', start: d.start, end: s, additive: d.ctrl || d.shift };
      } else {
        this.drag = { kind: 'pan', last: d.start };
        this.canvas.style.cursor = 'grabbing';
      }
    }
    const d2 = this.drag;
    if (d2?.kind === 'pan') {
      this.cam.panBy(s.x - d2.last.x, s.y - d2.last.y);
      d2.last = s;
      this.viewChanged();
      return;
    }
    if (d2?.kind === 'rubber') {
      d2.end = s;
      this.requestRender();
      return;
    }
    if (d2?.kind === 'movePixmap') {
      const delta = { x: scene.x - d2.startScene.x, y: scene.y - d2.startScene.y };
      const p = this.project;
      p.layers = p.layers.map((l) => (l.id !== this.currentLayerId ? l : {
        ...l,
        items: l.items.map((i) => (i.id === d2.id && i.kind === 'pixmap' ? { ...i, x: d2.orig.x + delta.x, y: d2.orig.y + delta.y } : i)),
      }));
      this.requestRender();
      return;
    }
    this.tool.move(this, this.toolEvent(s, e));
    this.requestRender();
  }

  private pointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!this.project || !d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    this.drag = null;
    const s = this.screenPos(e);
    this.canvas.style.cursor = this.tool.cursor;
    switch (d.kind) {
      case 'pending':
        if (d.button === 0) {
          this.tool.click(this, this.toolEvent(s, e));
          this.tool.move(this, this.toolEvent(s, e));
        }
        break;
      case 'rubber': {
        const r = this.cam.toScene(d.start), q = this.cam.toScene(d.end);
        const rect = normRect(r, q);
        const ids: string[] = d.additive ? [...this.selection] : [];
        for (const l of this.project.layers) {
          if (!l.visible) continue;
          for (const it of l.items) if (itemTouchesRect(it, rect, this.sizeOf) && !ids.includes(it.id)) ids.push(it.id);
        }
        this.setSelection(ids);
        break;
      }
      case 'movePixmap': {
        const after = this.project.layers;
        this.project.layers = d.before;
        if (after !== d.before) this.commit('déplacer l\'image', after);
        break;
      }
    }
    this.requestRender();
  }

  private wheel(e: WheelEvent): void {
    if (!this.project) return;
    e.preventDefault();
    const s = this.screenPos(e);
    const px = this.selectedPixmap();
    if (e.shiftKey && px) {
      const f = e.deltaY + e.deltaX < 0 ? this.pixmapStep : 2 - this.pixmapStep;
      this.updateItem(px.id, { scale: px.scale * f }, 'échelle de l\'image', `scale-${px.id}`);
      this.status(this.selectionStatus());
      return;
    }
    // Lines (mouse wheel) or pixels (touchpad); ctrlKey = touchpad pinch.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = Math.pow(ZOOM_STEP, -delta / (e.ctrlKey ? 25 : 100));
    this.zoom(factor, s);
  }

  private async contextMenu(screen: Pt, cx: number, cy: number): Promise<void> {
    if (!this.project) return;
    const hit = this.pick(screen);
    if (hit && hit.item.kind !== 'pixmap' && this.selection.has(hit.item.id)) {
      await this.chooseStyle();
      return;
    }
    if (!this.currentLayer) return this.status('Créez ou choisissez d\'abord un calque.');
    const scene = this.snapTarget(screen) ?? this.cam.toScene(screen);
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
    this.setTool(chosen);
    // Mark the spot with a point, a handy anchor for the next clicks.
    this.addItems([{ kind: 'point', ...this.stroke(), width: 7, p: scene, weight: 0 }], 'point');
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.project) return;
    const t = e.target as HTMLElement;
    if (t && (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]'))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl) {
      if (k === 'z' && !e.shiftKey) this.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) this.redo();
      else if (k === 's') void this.exportZip();
      else if (k === 'a') this.setSelection(this.currentLayer?.items.map((i) => i.id) ?? []);
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    if (this.tool.key(this, e)) {
      e.preventDefault();
      return;
    }
    if (this.pixmapKey(e)) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Escape':
        if (this.toolId === 'select') this.setSelection([]);
        else this.tool.reset(this);
        break;
      case 'Delete':
      case 'Backspace':
        this.deleteSelection();
        break;
      case ' ':
        this.selectNext();
        break;
      default: {
        if (k === 'c') void this.chooseColor();
        else if (k === 't') void this.chooseWidth();
        else if (k === 'w') void this.editPointWeight();
        else if (k === 'a') void this.editArcAngle();
        else if (k === 's') void this.spiralOptions();
        else if (k === 'f') this.zoomToFit();
        else if (k === '+' || k === '=') this.zoom(ZOOM_STEP);
        else if (k === '-') this.zoom(1 / ZOOM_STEP);
        else {
          const def = TOOLS.find((d) => d.key?.toLowerCase() === k);
          if (!def) return;
          this.setTool(def.id);
        }
      }
    }
    e.preventDefault();
  }

  /* ========================================================== options */

  async spiralOptions(): Promise<void> {
    const o = this.options.spiral;
    const one = h('input', { type: 'radio', name: 'sp-kind', checked: o.oneItem });
    const four = h('input', { type: 'radio', name: 'sp-kind', checked: !o.oneItem });
    const base = h('input', { type: 'checkbox', checked: o.showBase });
    const centers = h('input', { type: 'radio', name: 'sp-base', checked: o.centersOnly });
    const sides = h('input', { type: 'radio', name: 'sp-base', checked: !o.centersOnly });
    const body = h('div', { class: 'options' },
      h('p', { class: 'hint' }, 'Placez les 4 centres un par un. Après 2 centres, [Entrée] déduit une base carrée ; après 3 centres, une base en trapèze. Maintenez [Maj] pour un côté perpendiculaire au précédent.'),
      h('fieldset', {}, h('legend', {}, 'Construire la spirale'),
        h('label', { class: 'check' }, one, 'comme un seul élément'),
        h('label', { class: 'check' }, four, 'comme 4 arcs indépendants')),
      h('fieldset', {}, h('legend', {}, h('label', { class: 'check' }, base, 'Dessiner aussi la base')),
        h('label', { class: 'check' }, centers, 'les 4 centres seulement'),
        h('label', { class: 'check' }, sides, 'les 4 côtés (segments)')),
    );
    const ok = await openDialog('Options de la spirale', body, [
      { label: 'Annuler', value: false },
      { label: 'OK', value: true, primary: true },
    ]);
    if (!ok) return;
    this.options.spiral = { oneItem: one.checked, showBase: base.checked, centersOnly: centers.checked };
    this.saveOptions();
  }

  toggleOption(k: 'drawCenter' | 'weights' | 'minimap'): void {
    this.options[k] = !this.options[k];
    this.saveOptions();
    this.onChange();
    this.requestRender();
  }

  /* =========================================================== projects */

  private scheduleSave(): void {
    if (!this.project) return;
    window.clearTimeout(this.saveTimer);
    this.saving = true;
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 600);
  }

  async saveNow(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const p = this.project;
    if (!p) return;
    const c = this.cam.center();
    p.view = { zoom: this.cam.zoom, cx: c.x, cy: c.y };
    try {
      await store.saveProject(p);
      this.saving = false;
    } catch (e) {
      this.status(`Enregistrement dans le navigateur impossible : ${(e as Error).message}`);
    }
    this.onChange();
  }

  private async open(project: Project, fit: boolean): Promise<void> {
    await this.closeProject(false);
    this.project = project;
    this.currentLayerId = project.layers[project.layers.length - 1]?.id ?? null;
    store.setLastProjectId(project.id);
    this.onProjectOpen(true);
    this.resize();
    this.setTool('select');
    await this.loadMap(fit || !project.view);
    if (!fit && project.view) {
      this.cam.setZoom(project.view.zoom);
      this.cam.centerOn(pt(project.view.cx, project.view.cy));
    } else if (!project.mapFile) this.zoomToFit();
    // Pictures of the layers.
    const files = new Set<string>();
    for (const l of project.layers) for (const it of l.items) if (it.kind === 'pixmap') files.add(it.file);
    for (const f of files) {
      const blob = await store.getFile(project.id, f);
      if (blob) await this.loadPicture(f, blob, false);
    }
    this.onChange();
    this.requestRender();
  }

  async openStored(id: string): Promise<void> {
    const p = await store.loadProject(id);
    if (!p) {
      await alertDialog('Projet introuvable', 'Ce projet n\'existe plus dans ce navigateur.');
      return;
    }
    await this.open(p, false);
  }

  async closeProject(showStart = true): Promise<void> {
    if (this.project) await this.saveNow();
    this.project = null;
    for (const p of this.pictures.values()) p.close();
    this.pictures.clear();
    this.history.clear();
    this.selection.clear();
    this.currentLayerId = null;
    this.options.gray = false;
    this.cam.bounds = null;
    if (showStart) {
      store.setLastProjectId(null);
      this.onProjectOpen(false);
    }
    this.requestRender();
  }

  /** New project from a map picture. */
  async newProject(mapFile?: File): Promise<void> {
    const file = mapFile ?? (await pickFiles({ accept: 'image/*' }))[0];
    if (!file) return;
    const name = await promptText('Nouveau projet', 'Nom du projet', splitExt(file.name)[0]);
    if (!name) return;
    const p = emptyProject(name);
    p.mapFile = safeFileName(file.name);
    p.mapName = splitExt(file.name)[0];
    p.layers = [emptyLayer('calque_1')];
    await store.putFile(p.id, p.mapFile, file);
    await store.saveProject(p);
    void store.requestPersistence();
    await this.open(p, true);
    this.status('Projet créé. Mesurez l\'échelle dans le panneau « Carte » pour obtenir des distances réelles.');
  }

  /** Import a desktop project (folder or zip). */
  async importProjectFiles(files: { path: string; blob: Blob }[]): Promise<boolean> {
    let res: ImportResult | null;
    try {
      res = await importProject(files);
    } catch (e) {
      await alertDialog('Import impossible', `Lecture des fichiers impossible : ${(e as Error).message}`);
      return false;
    }
    if (!res) return false;
    const { project, files: pf, warnings } = res;
    if (!project.layers.length) project.layers = [emptyLayer('calque_1')];
    this.status('Import du projet…');
    for (const [name, blob] of pf) await store.putFile(project.id, name, blob.type ? blob : new Blob([blob], { type: mimeOf(name) }));
    await store.saveProject(project);
    void store.requestPersistence();
    await this.open(project, true);
    if (res.missingMap) {
      const ok = await confirmDialog('Carte introuvable', `La carte « ${res.missingMap} » n'était pas dans les fichiers sélectionnés. Voulez-vous la choisir maintenant ?`, 'Choisir la carte');
      if (ok) {
        const [f] = await pickFiles({ accept: 'image/*' });
        if (f) await this.setMapFile(f.name, f);
      }
    }
    if (warnings.length) await alertDialog('Import terminé avec des avertissements', h('ul', {}, ...warnings.map((w) => h('li', {}, w))));
    else this.status(`Projet « ${project.name} » importé (${project.layers.length} calque(s)).`);
    return true;
  }

  async pickProjectFolder(): Promise<void> {
    const files = await pickFiles({ directory: true });
    if (files.length) await this.handleFiles(files.map((f) => ({ path: f.webkitRelativePath || f.name, blob: f })));
  }

  async pickProjectFiles(): Promise<void> {
    const files = await pickFiles({ multiple: true, accept: '.zip,.gribz,.grib,.xml,image/*' });
    if (files.length) await this.handleFiles(files.map((f) => ({ path: f.webkitRelativePath || f.name, blob: f })));
  }

  /** Files dropped or picked: a project, layers, a map or a picture. */
  async handleFiles(files: { path: string; blob: Blob }[]): Promise<void> {
    const hasProject = files.some((f) => /\.(grib|zip|gribz)$/i.test(f.path));
    if (hasProject) {
      if (await this.importProjectFiles(files)) return;
      if (this.project && files.some((f) => /\.(xml|zip)$/i.test(f.path))) return this.importLayerFiles(files);
      await alertDialog('Aucun projet', 'Aucun fichier de projet Gribouillot (.grib) n\'a été trouvé.');
      return;
    }
    if (this.project && files.some((f) => /\.xml$/i.test(f.path))) return this.importLayerFiles(files);
    const img = files.find((f) => isImageName(f.path));
    if (img) {
      const file = new File([img.blob], img.path.split('/').pop()!, { type: img.blob.type || mimeOf(img.path) });
      if (!this.project) return this.newProject(file);
      const choice = await openDialog('Image déposée', `Que faire de « ${file.name} » ?`, [
        { label: 'Annuler', value: null },
        { label: 'Remplacer la carte', value: 'map' as const },
        { label: 'Ajouter au calque', value: 'pic' as const, primary: true },
      ]);
      if (choice === 'map') await this.setMapFile(file.name, file);
      else if (choice === 'pic') await this.addPictureFile(file, file.name);
      return;
    }
    await alertDialog('Fichiers non reconnus', 'Déposez un dossier de projet Gribouillot, un .zip, un calque .xml ou une image.');
  }

  async exportZip(): Promise<void> {
    const p = this.project;
    if (!p) return;
    this.status('Préparation du fichier .zip…');
    await this.saveNow();
    const blob = await exportProjectZip(p, (name) => store.getFile(p.id, name));
    download(blob, `${safeFileName(p.name)}.zip`);
    this.status('Projet exporté. Décompressé, il s\'ouvre aussi dans Gribouillot pour ordinateur.');
  }

  async renameProject(): Promise<void> {
    const p = this.project!;
    const n = await promptText('Renommer le projet', 'Nom du projet', p.name);
    if (n) {
      p.name = n;
      this.changed();
    }
  }

  /** Export the current view, or the whole map, as a picture. */
  async exportImage(): Promise<void> {
    const p = this.project;
    if (!p) return;
    const map = this.mapPicture();
    const what = h('select', {},
      h('option', { value: 'view' }, 'La vue actuelle'),
      map ? h('option', { value: '1' }, `Toute la carte, taille réelle (${map.w} × ${map.h} px)`) : null,
      map ? h('option', { value: '0.5' }, `Toute la carte, 50 % (${Math.round(map.w / 2)} × ${Math.round(map.h / 2)} px)`) : null,
      map ? h('option', { value: '0.25' }, `Toute la carte, 25 % (${Math.round(map.w / 4)} × ${Math.round(map.h / 4)} px)`) : null,
    );
    const format = h('select', {}, h('option', { value: 'image/png' }, 'PNG'), h('option', { value: 'image/jpeg' }, 'JPEG (plus léger)'));
    const ok = await openDialog('Exporter une image', h('div', { class: 'options' },
      h('label', {}, 'Contenu', what), h('label', {}, 'Format', format)), [
      { label: 'Annuler', value: false },
      { label: 'Exporter', value: true, primary: true },
    ]);
    if (!ok) return;
    let canvas: HTMLCanvasElement;
    if (what.value === 'view') canvas = this.renderOffscreen(this.cam.width, this.cam.height, this.cam.zoom, this.cam.panX, this.cam.panY, this.dpr);
    else {
      const k = parseFloat(what.value);
      const w = Math.round(map!.w * k), hh = Math.round(map!.h * k);
      if (w > 16384 || hh > 16384 || w * hh > 250e6) {
        await alertDialog('Image trop grande', 'Le navigateur ne peut pas produire une image aussi grande : choisissez une taille plus petite.');
        return;
      }
      this.status('Rendu de l\'image…');
      canvas = this.renderOffscreen(w, hh, k, 0, 0, 1);
    }
    const type = format.value;
    canvas.toBlob((blob) => {
      if (!blob) return void alertDialog('Export impossible', 'Le navigateur n\'a pas pu produire l\'image.');
      download(blob, `${safeFileName(p.name)}.${type === 'image/png' ? 'png' : 'jpg'}`);
      this.status('Image exportée.');
    }, type, 0.92);
  }

  private renderOffscreen(w: number, hh: number, zoom: number, panX: number, panY: number, dpr: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
    const cam = new Camera();
    cam.width = w;
    cam.height = hh;
    cam.zoom = zoom;
    cam.panX = panX;
    cam.panY = panY;
    const r = new Renderer(canvas.getContext('2d')!, cam);
    r.clear('#ffffff', dpr);
    const map = this.mapPicture();
    if (map) r.map(map, this.options.gray && map.hasGray(), dpr);
    r.layers(this.project!.layers, { selection: new Set(), showWeight: this.options.weights, pictures: this.pictures, dpr });
    return canvas;
  }

  /** Restore the last opened project, if any. */
  async restore(): Promise<boolean> {
    const id = store.lastProjectId();
    if (!id) return false;
    const p = await store.loadProject(id);
    if (!p) return false;
    await this.open(p, false);
    return true;
  }
}

function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}
