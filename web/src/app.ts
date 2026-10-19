/**
 * The application: the open project, its selection and current tool, the
 * rendering loop and the editing commands.
 *
 * Every change of the layers goes through `commit` (one undo step, then
 * refresh and save); other changes of the project (scale, colors, names)
 * through `changed` (refresh and save). Input handling lives in input.ts,
 * the project's life (save, import, export) in session.ts.
 */

import { knownAnchors, knownMap, type KnownMap } from './calibrations';
import { Camera } from './camera';
import type { Shape } from './constructions';
import { describeSelection } from './describe';
import * as edits from './edits';
import { fitGeoref, formatLatLon, kmBetween, MODEL_LABELS, type Anchor, type Georef, type LatLon } from './geo';
import { clipSegment, dist, pt, seg, type Pt, type Rect } from './geom';
import { History } from './history';
import { clickSource, linksFor, propagate, uniqueIds } from './links';
import { centerOf, crossings, remarkablePoints, SNAP_LABELS, type SnapPoint } from './intersections';
import type { Picture } from './images';
import { Input } from './input';
import { importLayers } from './io';
import {
  emptyLayer,
  formatLength,
  freshLayerName,
  isStroke,
  newId,
  unitPerPx,
  type Item,
  type ItemKind,
  type Layer,
  type PixmapItem,
  type Project,
  type Source,
} from './model';
import { HIGHLIGHT, Renderer } from './render';
import { Session } from './session';
import { itemDistance, pickTolerance } from './shapes';
import * as store from './store';
import { toolDef, type Tool, type ToolId } from './tools';
import { alertDialog, confirmDialog, openDialog, promptNumber, promptText, styleDialog } from './ui/dialogs';
import { fmt, h, pickFiles } from './ui/dom';
import { placeDialog } from './ui/place';
import { nearbyDialog, type Around } from './ui/nearby';
import { townsDialog } from './ui/towns';

export interface Hit {
  item: Item;
  layer: Layer;
}

export interface Options {
  drawCenter: boolean;
  weights: boolean;
  minimap: boolean;
  gray: boolean;
  /** Clicks snap on intersections, middles, ends and centers (and always on points). */
  snapFigures: boolean;
  spiral: { oneItem: boolean; showBase: boolean; centersOnly: boolean };
}

const OPTIONS_KEY = 'gribouillot.options';
/** Distance in screen pixels within which a click snaps on a remarkable point. */
const SNAP_PX = 10;

function loadOptions(): Options {
  const def: Options = { drawCenter: false, weights: false, minimap: true, gray: false, snapFigures: true, spiral: { oneItem: true, showBase: false, centersOnly: true } };
  try {
    const s = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
    return { ...def, ...s, spiral: { ...def.spiral, ...(s.spiral ?? {}) }, gray: false };
  } catch {
    return def;
  }
}

export class App {
  project: Project | null = null;
  readonly cam = new Camera();
  readonly history = new History();
  readonly pictures = new Map<string, Picture>();
  readonly session = new Session(this);
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
  /** Hook for the minimap and the scale bar. */
  afterRender?: () => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: Renderer;
  private readonly input: Input;
  private readonly statusEl: HTMLElement;
  private dpr = 1;
  private renderQueued = false;
  private georefCache: { anchors?: Anchor[]; g: Georef | null } = { g: null };

  constructor(canvas: HTMLCanvasElement, statusEl: HTMLElement, coordsEl: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.renderer = new Renderer(this.ctx, this.cam);
    this.statusEl = statusEl;
    this.tool = toolDef('select').make();
    this.input = new Input(this, canvas, coordsEl);
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

  /** Identity and style of a new item. */
  stroke(): { id: string; color: string; width: number } {
    return { id: newId(), color: this.project!.color, width: this.project!.width };
  }

  unitPerPx(): number {
    return this.project ? unitPerPx(this.project.scale) : 0;
  }

  formatLength(px: number, digits = 1): string {
    return this.project ? formatLength(px, this.project.scale, digits).replace('.', ',') : '';
  }

  sizeOf = (file: string) => this.pictures.get(file);

  /* ========================================================= rendering */

  resize(): void {
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

  mapPicture(): Picture | undefined {
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
    const mouse = this.input.mouseScreen;
    if (mouse && this.snaps()) {
      const s = this.snap(mouse);
      if (s) this.drawSnap(s);
    }
    const band = this.input.rubberBand();
    if (band) r.rubberBand(band);
    this.afterRender?.();
  }

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

  /** The current tool places points: its clicks snap. */
  snaps(): boolean {
    return this.tool.draws || ['measure', 'protractor', 'calibrate', 'georef'].includes(this.toolId);
  }

  /**
   * Where a click at this screen position lands: on the visible point under
   * the mouse, else on the closest remarkable point of the figure nearby
   * (intersection, middle or end of a segment, center), if any.
   */
  snap(screen: Pt): SnapPoint | null {
    const hit = this.pick(screen, ['point']);
    if (hit && hit.item.kind === 'point') return { p: hit.item.p, kind: 'point', ids: [hit.item.id] };
    if (!this.options.snapFigures || !this.project) return null;
    const scene = this.cam.toScene(screen);
    const zoom = this.cam.zoom;
    const near: Item[] = [];
    const found: SnapPoint[] = [];
    for (const layer of this.project.layers) {
      if (!layer.visible) continue;
      for (const it of layer.items) {
        if (!isStroke(it) || it.kind === 'point') continue;
        if (itemDistance(it, scene, zoom, this.sizeOf) <= SNAP_PX + it.width / 2) near.push(it);
        const c = centerOf(it);
        if (c) found.push({ p: c, kind: 'center', ids: [it.id] });
      }
    }
    found.push(...remarkablePoints(near));
    let best: SnapPoint | null = null, bestD = SNAP_PX;
    for (const f of found) {
      // Intersections win a close call: they are what one aims at.
      const d = dist(f.p, scene) * zoom - (f.kind === 'intersection' ? 3 : 0);
      if (d < bestD) [best, bestD] = [f, d];
    }
    return best;
  }

  snapTarget(screen: Pt): Pt | null {
    return this.snap(screen)?.p ?? null;
  }

  /** A visible point is under the mouse (not just a remarkable point of the figure). */
  isOnPoint(screen: Pt): boolean {
    return this.pick(screen, ['point']) !== null;
  }

  private drawSnap(s: SnapPoint): void {
    const c = this.cam.toScreen(s.p);
    const x = this.ctx;
    x.beginPath();
    switch (s.kind) {
      case 'point':
        x.arc(c.x, c.y, 9, 0, Math.PI * 2);
        break;
      case 'intersection':
        x.moveTo(c.x - 7, c.y - 7);
        x.lineTo(c.x + 7, c.y + 7);
        x.moveTo(c.x - 7, c.y + 7);
        x.lineTo(c.x + 7, c.y - 7);
        break;
      case 'midpoint':
        x.moveTo(c.x, c.y - 8);
        x.lineTo(c.x + 7, c.y + 5);
        x.lineTo(c.x - 7, c.y + 5);
        x.closePath();
        break;
      case 'end':
        x.rect(c.x - 6, c.y - 6, 12, 12);
        break;
      case 'center':
        x.moveTo(c.x - 8, c.y);
        x.lineTo(c.x + 8, c.y);
        x.moveTo(c.x, c.y - 8);
        x.lineTo(c.x, c.y + 8);
        break;
    }
    x.lineWidth = 2.5;
    x.setLineDash([]);
    x.strokeStyle = HIGHLIGHT;
    x.stroke();
    if (s.kind !== 'point') this.renderer.text(s.p, SNAP_LABELS[s.kind], { color: HIGHLIGHT, size: 12, bold: true, dx: 11, dy: 16 });
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

  selectedPixmap(): PixmapItem | null {
    const sel = this.editableSelection();
    return sel.length === 1 && sel[0].kind === 'pixmap' ? sel[0] : null;
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
    this.onChange();
  }

  selectionStatus(): string {
    return describeSelection(this.selectedItems().map((h) => h.item), (px) => this.formatLength(px), (p) => this.gps(p));
  }

  /* ============================================================ editing */

  /** Replace the layers: one undo step, then refresh and save. */
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
    this.session.scheduleSave();
  }

  /** Show layers being edited (e.g. a picture being dragged) before they are committed. */
  showLayers(layers: Layer[]): void {
    this.project!.layers = layers;
    this.requestRender();
  }

  /** Constructions which could not follow the last move of a point. */
  private stale = 0;

  /** The layers with a point of the current layer moved, and what is built on it following. */
  movedPoint(layers: Layer[], id: string, p: Pt): Layer[] {
    const moved = edits.updateItems(layers, this.currentLayerId!, [id], (i) => (i.kind === 'point' ? { ...i, p } : i));
    const res = propagate(moved, [id]);
    this.stale = res.stale;
    return res.layers;
  }

  staleNote(): string {
    return this.stale ? ` — ${this.stale} élément(s) impossible(s) à construire à cette position, laissé(s) tel(s) quel(s).` : '';
  }

  /** The layers with some items of the current layer changed by f. */
  updatedItems(ids: Iterable<string>, f: (item: Item) => Item): Layer[] {
    return edits.updateItems(this.project!.layers, this.currentLayerId!, ids, f);
  }

  private requireLayer(): Layer | null {
    const l = this.currentLayer;
    if (!l) {
      this.status('Créez ou choisissez d\'abord un calque.');
      return null;
    }
    return l;
  }

  /** Add items to the current layer. */
  addItems(items: Item[], label: string): void {
    this.replaceItems([], items, label);
  }

  replaceItems(removeIds: string[], items: Item[], label: string): void {
    const l = this.requireLayer();
    if (!l || (items.length === 0 && removeIds.length === 0)) return;
    this.commit(label, edits.replaceItems(this.project!.layers, l.id, removeIds, items));
    for (const id of removeIds) this.selection.delete(id);
  }

  /**
   * Add the figures computed by a construction, in the current color and
   * width, plus its center point if that option is on. With `link`, they
   * follow their sources when these move.
   */
  addShapes(shapes: Shape[], label: string, opts: { center?: Pt; remove?: string[]; width?: number; link?: { recipe: string; sources: Source[] } } = {}): void {
    const links = opts.link ? linksFor(opts.link.recipe, opts.link.sources, shapes.length) : null;
    const items = shapes.map((s, i) => ({ ...s, ...this.stroke(), ...(opts.width ? { width: opts.width } : {}), ...(links ? { link: links.shapes[i] } : {}) }) as Item);
    if (opts.center && this.options.drawCenter) items.push({ kind: 'point', ...this.stroke(), p: opts.center, weight: 0, ...(links ? { link: links.center } : {}) });
    this.replaceItems(opts.remove ?? [], items, label);
  }

  /** A point; on an intersection, a middle, an end or a center, it follows that spot. */
  async addPoint(p: Pt, snap: SnapPoint | null = null): Promise<void> {
    if (!this.requireLayer()) return;
    let weight = 0;
    if (this.options.weights) {
      const w = await promptNumber('Point pondéré', 'Poids du point', 0, { integer: true, min: -999, max: 999 });
      if (w === null) return;
      weight = Math.round(w);
    }
    const link = snap && snap.kind !== 'point' ? { recipe: '@point', sources: [clickSource(p, snap, (id) => this.findItem(id)?.item)] } : undefined;
    this.addShapes([{ kind: 'point', p, weight }], 'point', { link });
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
    const ids = items.map((i) => i.id);
    this.commit('suppression', edits.replaceItems(this.project!.layers, this.currentLayerId!, ids, []));
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
    this.commit('style', this.updatedItems(ids, (i) => (isStroke(i) ? ({ ...i, ...patch } as Item) : i)));
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
    this.commit(label, edits.updateItems(this.project!.layers, hit.layer.id, [id], (i) => ({ ...i, ...patch }) as Item), mergeKey);
  }

  async editPointWeight(): Promise<void> {
    const pts = this.editableSelection().filter((i) => i.kind === 'point');
    if (!pts.length) return this.cannot('pondérer');
    const w = await promptNumber('Poids du point', 'Poids', pts[0].weight, { integer: true, min: -999, max: 999 });
    if (w === null) return;
    this.commit('poids', this.updatedItems(pts.map((p) => p.id), (i) => (i.kind === 'point' ? { ...i, weight: Math.round(w) } : i)));
    if (!this.options.weights) this.status('Astuce : activez « Pondération » pour afficher les poids.');
  }

  async editArcAngle(): Promise<void> {
    const arc = this.editableSelection().find((i) => i.kind === 'arc');
    if (!arc || arc.kind !== 'arc') return this.cannot('modifier');
    const a = await promptNumber('Angle de l\'arc', 'Angle (positif : sens anti-horaire)', arc.span, { unit: '°', min: -360, max: 360, hint: `soit ${fmt((arc.span * Math.PI) / 180, 4)} rad` });
    // Changed by hand: the arc no longer follows its construction.
    if (a !== null) this.updateItem(arc.id, { span: a, link: undefined }, 'angle de l\'arc');
  }

  async addPicture(): Promise<void> {
    if (!this.requireLayer()) return;
    const [file] = await pickFiles({ accept: 'image/*' });
    if (file) await this.addPictureFile(file);
  }

  async addPictureFile(file: File | Blob, name?: string): Promise<void> {
    const l = this.requireLayer();
    if (!l) return;
    const fileName = await this.session.storeFile(name ?? (file as File).name ?? 'image.png', file);
    const pic = await this.session.loadPicture(fileName, file, false);
    if (!pic) return;
    const c = this.cam.center();
    const fit = Math.min(1, (this.cam.width / this.cam.zoom) * 0.6 / pic.w, (this.cam.height / this.cam.zoom) * 0.6 / pic.h);
    const item: PixmapItem = { kind: 'pixmap', id: newId(), x: c.x - pic.w / 2, y: c.y - pic.h / 2, scale: fit, rotation: 0, file: fileName };
    this.addItems([item], 'image');
    this.setTool('select');
    this.setSelection([item.id]);
  }

  /** Points at the intersections of the selected items (I key). */
  addIntersections(): void {
    if (!this.requireLayer()) return;
    const items = this.selectedItems().map((h) => h.item).filter((i) => isStroke(i) && i.kind !== 'point');
    if (items.length < 2) return this.status('Sélectionnez au moins 2 droites, cercles ou arcs (Ctrl+clic), puis [I] pour placer leurs points d\'intersection.');
    const existing = this.currentLayer!.items.flatMap((i) => (i.kind === 'point' ? [i.p] : []));
    const pts = crossings(items).filter((c) => !existing.some((q) => dist(c.p, q) < 1e-6));
    if (!pts.length) return this.status('Aucune nouvelle intersection entre les éléments sélectionnés.');
    const find = (id: string) => this.findItem(id)?.item;
    const points = pts.map((c) => ({ kind: 'point', ...this.stroke(), p: c.p, weight: 0, link: linksFor('@point', [clickSource(c.p, c, find)], 1).shapes[0] }) as Item);
    this.addItems(points, 'intersections');
    this.status(`${pts.length} point(s) d'intersection ajouté(s) : ils suivront les éléments si ceux-ci bougent.`);
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
    this.addShapes([{ kind: 'point', p: com, weight: 0 }], 'centre de masse');
    this.cam.centerOn(com);
    this.requestRender();
  }

  /* ============================================================ layers */

  setCurrentLayer(id: string): void {
    this.currentLayerId = id;
    this.tool.reset(this);
    this.onChange();
    this.session.scheduleSave();
  }

  addLayer(): void {
    const p = this.project!;
    const layer = emptyLayer(freshLayerName(p.layers));
    const layers = edits.insertLayer(p.layers, layer, this.currentLayerId);
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
    this.commit('renommer le calque', edits.patchLayer(p.layers, id, { name }));
  }

  async deleteLayer(id: string): Promise<void> {
    const p = this.project!;
    const l = p.layers.find((x) => x.id === id);
    if (!l) return;
    if (l.items.length && !(await confirmDialog('Supprimer le calque', `Supprimer le calque « ${l.name} » et ses ${l.items.length} élément(s) ? (Ctrl+Z pour annuler)`, 'Supprimer', true))) return;
    const idx = p.layers.indexOf(l);
    const layers = edits.removeLayer(p.layers, id);
    if (this.currentLayerId === id) this.currentLayerId = layers[Math.max(0, idx - 1)]?.id ?? null;
    this.commit('supprimer le calque', layers);
  }

  toggleLayerVisibility(id: string): void {
    const p = this.project!;
    const l = p.layers.find((x) => x.id === id);
    if (l) this.commit(l.visible ? 'masquer le calque' : 'afficher le calque', edits.patchLayer(p.layers, id, { visible: !l.visible }));
  }

  setLayerOpacity(id: string, opacity: number): void {
    // The moves of the slider make a single undo step.
    this.commit('opacité du calque', edits.patchLayer(this.project!.layers, id, { opacity }), `opacity-${id}`);
  }

  moveLayer(id: string, toIndex: number): void {
    const layers = edits.moveLayer(this.project!.layers, id, toIndex);
    if (layers) this.commit('ordre des calques', layers);
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
      await this.session.loadPicture(name, blob, false);
    }
    let added: Layer[] = [];
    for (const { layer } of layers) added.push({ ...layer, name: edits.uniqueLayerName([...p.layers, ...added], layer.name) });
    // A layer imported twice gets new ids, its links following.
    added = uniqueIds(added, new Set(p.layers.flatMap((l) => l.items.map((i) => i.id))));
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

  /* ================================================================ GPS */

  /** The map's calibration, null until 2 anchors are placed. */
  georef(): Georef | null {
    const anchors = this.project?.anchors;
    if (this.georefCache.anchors !== anchors) this.georefCache = { anchors, g: fitGeoref(anchors ?? []) };
    return this.georefCache.g;
  }

  /** GPS coordinates of a scene position, null if the map is not calibrated. */
  gps(p: Pt): string | null {
    const g = this.georef();
    return g ? formatLatLon(g.toLatLon(p)) : null;
  }

  /** The anchor under a screen position. */
  anchorAt(screen: Pt): Anchor | null {
    let best: Anchor | null = null, bestD = 12;
    for (const a of this.project?.anchors ?? []) {
      const c = this.cam.toScreen(a.p);
      const d = Math.hypot(c.x - screen.x, c.y - screen.y);
      if (d < bestD) [best, bestD] = [a, d];
    }
    return best;
  }

  /** Where the calibration stands, for the status bar and the panel. */
  georefSummary(tip = false): string {
    const anchors = this.project?.anchors ?? [];
    const g = this.georef();
    const next = tip ? ' Cliquez une ville de la carte que vous savez situer.' : '';
    if (!anchors.length) return `Calage GPS : aucun repère.${next}`;
    if (!g) return `Calage GPS : 1 repère, il en faut au moins 2.${next}`;
    if (g.rms === null) return `Calage GPS : ${anchors.length} repères, précision encore inconnue (ajoutez-en un ${anchors.length + 1}ᵉ).${next}`;
    const worst = anchors[g.checks.findIndex((c) => c?.km === g.max)];
    return `Calage GPS : ${anchors.length} repères, précision ≈ ${fmt(g.rms, 1)} km (pire : ${worst?.name ?? '?'}, ${fmt(g.max!, 1)} km) — transformation ${MODEL_LABELS[g.model]}.${tip ? ' Cliquez une autre ville, ou un repère pour le corriger.' : ''}`;
  }

  /** A map known to be calibrated (calibrations.ts), opened in a project without anchors: its calibration. */
  applyKnownCalibration(size: { w: number; h: number }): void {
    const p = this.project;
    const known = knownMap(size);
    if (!p || !known || p.anchors?.length) return;
    this.setAnchors(knownAnchors(known));
    // The scale too, if none was given: measured by the calibration, across the middle of the map.
    const g = this.georef();
    let scale = '';
    if (g && (!p.scale.px || !p.scale.value)) {
      const c = pt(size.w / 2, size.h / 2);
      const k = (kmBetween(g.toLatLon(c), g.toLatLon(pt(c.x + 1000, c.y))) + kmBetween(g.toLatLon(c), g.toLatLon(pt(c.x, c.y + 1000)))) / 2;
      this.setScale({ px: 1000, value: Math.round(k * 10) / 10, unit: 'km' });
      scale = ` Échelle réglée : 1 px = ${fmt(k, 1)} m.`;
    }
    this.status(`Carte reconnue : ${known.name}. Calage GPS appliqué (${known.anchors.length} villes, précision ≈ ${fmt(g?.rms ?? 0, 1)} km).${scale}`);
  }

  /** The default calibration of the map, if it is a known one and the project has another. */
  knownCalibration(): KnownMap | null {
    const map = this.mapPicture();
    const known = map ? knownMap(map) : undefined;
    if (!known) return null;
    const names = (this.project?.anchors ?? []).map((a) => a.name).sort().join('|');
    return names === known.anchors.map((a) => a[0]).sort().join('|') ? null : known;
  }

  setAnchors(anchors: Anchor[]): void {
    this.project!.anchors = anchors;
    this.changed();
  }

  /** Name a place of the map (a new anchor), or correct or remove an anchor. */
  async placeAnchor(p: Pt, existing?: Anchor): Promise<void> {
    const prj = this.project!;
    const r = await placeDialog(existing ? `Repère « ${existing.name} »` : 'Quel est ce lieu ?', existing ? { name: existing.name, ll: existing } : undefined);
    if (!r || this.project !== prj) return;
    const others = (prj.anchors ?? []).filter((a) => a !== existing);
    if (r === 'delete') this.setAnchors(others);
    else this.setAnchors([...others, { id: existing?.id ?? newId('g'), p, name: r.name || 'repère', lat: r.ll.lat, lon: r.ll.lon }]);
    this.status(this.georefSummary(this.toolId === 'georef'));
  }

  /** Points on towns given by their name, with their weights (needs the GPS calibration). */
  async placeTowns(): Promise<void> {
    const layer = this.requireLayer();
    if (!layer) return;
    const g = this.georef();
    if (!g) {
      await alertDialog('Placer des villes par leur nom', 'Calez d\'abord la carte : panneau « Position GPS », au moins 2 villes (mieux : 6 à 10).');
      return;
    }
    const map = this.mapPicture();
    const inMap = (ll: LatLon) => {
      const p = g.toPx(ll);
      return !map || (p.x >= 0 && p.y >= 0 && p.x <= map.w && p.y <= map.h);
    };
    const towns = await townsDialog(inMap);
    if (!towns?.length || this.georef() !== g) return;
    this.addShapes(towns.map((t) => ({ kind: 'point', p: g.toPx(t.ll), weight: t.weight, label: t.name })), 'villes');
    const weighted = towns.some((t) => t.weight !== 0);
    this.status(`${towns.length} ville(s) placée(s) dans le calque « ${layer.name} ».${weighted && !this.options.weights ? ' Affichage → « Afficher les poids » pour voir les poids.' : ''}`);
  }

  /** The monuments and places around the selected point or circle center, or along the selected line. */
  async aroundSelection(): Promise<void> {
    const g = this.georef();
    const sel = this.selectedItems();
    const it = sel.length === 1 ? sel[0].item : null;
    if (!g || !it) return;
    let target: Around | null = null;
    if (it.kind === 'point') target = { kind: 'point', ll: g.toLatLon(it.p), what: it.label ? `Point « ${it.label} »` : 'Point sélectionné' };
    else if (it.kind === 'circle' || it.kind === 'arc') target = { kind: 'point', ll: g.toLatLon(it.c), what: 'Centre du cercle sélectionné' };
    else if (it.kind === 'segment' || it.kind === 'line') {
      // A line is followed across the map only: the calibration means nothing beyond.
      const map = this.mapPicture();
      const s = it.kind === 'line' && map ? clipSegment(it.p1, it.p2, { x: 0, y: 0, w: map.w, h: map.h }) : seg(it.p1, it.p2);
      if (!s) return this.status('Cette droite ne traverse pas la carte.');
      const pts = Array.from({ length: 33 }, (_, i) => g.toLatLon(pt(s.p1.x + ((s.p2.x - s.p1.x) * i) / 32, s.p1.y + ((s.p2.y - s.p1.y) * i) / 32)));
      target = { kind: 'line', pts, what: `${it.kind === 'line' ? 'Droite' : 'Segment'} de ${fmt(kmBetween(pts[0], pts[pts.length - 1]), 1)} km sur la carte` };
    }
    if (!target) return;
    // Below twice the precision of the calibration, a search radius means little.
    const defaultKm = Math.max(0.5, 2 * (g.rms ?? 0.5));
    await nearbyDialog(target, defaultKm, {
      place: (spots) => {
        const g2 = this.georef();
        if (!g2 || !this.requireLayer()) return;
        this.addShapes(spots.map((s) => ({ kind: 'point', p: g2.toPx(s.ll), weight: 0, label: s.name })), spots.length > 1 ? 'monuments' : 'lieu');
        this.status(`${spots.length} point(s) placé(s) dans le calque « ${this.currentLayer!.name} ».`);
      },
    });
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

  async renameMap(): Promise<void> {
    const p = this.project!;
    const n = await promptText('Nom de la carte', 'Nom affiché (le fichier n\'est pas renommé)', p.mapName || '');
    if (n !== null) {
      p.mapName = n;
      this.changed();
    }
  }

  async renameProject(): Promise<void> {
    const p = this.project!;
    const n = await promptText('Renommer le projet', 'Nom du projet', p.name);
    if (n) {
      p.name = n;
      this.changed();
    }
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

  /** The view moved: redraw, and remember it with the project. */
  viewChanged(): void {
    this.requestRender();
    this.session.scheduleSave();
  }

  /* ============================================================= tools */

  setTool(id: ToolId): void {
    if (!this.project) return;
    const t = toolDef(id).make();
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

  toggleOption(k: 'drawCenter' | 'weights' | 'minimap' | 'snapFigures'): void {
    this.options[k] = !this.options[k];
    this.saveOptions();
    this.onChange();
    this.requestRender();
  }
}
