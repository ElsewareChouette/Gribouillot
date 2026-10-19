/**
 * The interactive side of the constructions: one tool that runs any recipe of
 * constructions.ts. It collects the inputs step by step (clicks on the map or
 * on items, typed lengths and angles), keeps the status bar up to date, draws
 * the live preview, and adds the figure to the current layer.
 */

import type { App } from '../app';
import { isItem, isPt, type Draft, type Input, type Recipe, type Shape, type Step } from '../constructions';
import { samePt, seg, type Pt } from '../geom';
import { clickSource, itemSource } from '../links';
import type { Item, Source, StrokeItem } from '../model';
import type { Renderer, StrokeStyle } from '../render';
import { ArcSpanTracker } from '../shapes';
import { alertDialog, promptNumber } from '../ui/dialogs';
import { promptAzimuth, promptLength } from '../ui/length';
import { meridianAngle } from '../geo';
import { fmt } from '../ui/dom';
import { Tool, previewStyle, type ToolEvent } from './base';
import type { ToolId } from './index';

export class ConstructionTool extends Tool {
  readonly id: ToolId;
  private inputs: Input[] = [];
  /** Where each input comes from, so that the figure can follow it (links.ts). */
  private sources: Source[] = [];
  private tracker = new ArcSpanTracker();
  /** Last length typed, proposed again next time (as typed). */
  private lastLength: string | null = null;
  /** A warning about the last length: under the precision of the map. */
  private belowPrecision = '';
  /** Changes at each new figure: a pending dialog of an older one is ignored. */
  private round = 0;

  constructor(readonly recipe: Recipe) {
    super();
    this.id = recipe.id as ToolId;
  }

  private get step(): Step | undefined {
    return this.recipe.steps[this.inputs.length];
  }

  /** The recipe starts with a reference item (only the first step may be one). */
  private tip(step = this.step): string | undefined {
    return step && 'tip' in step ? step.tip : undefined;
  }

  private get onItem(): boolean {
    return this.recipe.steps[0].take === 'item';
  }

  start(app: App): void {
    this.inputs = [];
    this.sources = [];
    this.round++;
    const pre = this.preselection(app);
    if (pre) {
      this.inputs = pre;
      this.sources = app.selectedItems().map((h) => itemSource(h.item as StrokeItem));
      if (!this.onItem) app.setSelection([]);
      this.next(app);
      return;
    }
    if (this.onItem) app.setSelection([]);
    app.status(this.tip(this.recipe.steps[0]) ?? '');
  }

  /** Items selected beforehand with the selection tool, taken as the first inputs. */
  private preselection(app: App): Input[] | null {
    const n = this.recipe.preselect;
    if (!n || app.previousToolId !== 'select' || app.selection.size !== n) return null;
    const sel = app.selectedItems();
    if (sel.length !== n) return null;
    const inputs: Input[] = [];
    for (const [i, { item }] of sel.entries()) {
      const step = this.recipe.steps[i];
      if (step?.take === 'item' && step.kinds.includes(item.kind)) inputs.push(item);
      else if (step?.take === 'point' && item.kind === 'point') inputs.push(item.p);
      else return null;
    }
    return inputs;
  }

  /** An input was added: go to the next step, or draw the figure. */
  private next(app: App): void {
    if (this.onItem) app.setSelection(this.inputs.filter(isItem).map((i) => i.id));
    const step = this.step;
    if (!step) return this.finish(app);
    if (step.take === 'angle') this.tracker = new ArcSpanTracker();
    if (step.take === 'length') void this.askLength(app, step);
    else if (step.take === 'azimuth') void this.askAzimuth(app, step);
    else app.status(step.tip);
  }

  private finish(app: App): void {
    const r = this.recipe;
    const res = r.build(this.inputs);
    const sources = this.sources;
    this.inputs = this.inputs.slice(0, r.keep ?? 0);
    this.sources = this.sources.slice(0, r.keep ?? 0);
    this.round++;
    if (this.onItem) app.setSelection(this.inputs.filter(isItem).map((i) => i.id));
    app.status(this.tip() ?? r.again ?? '');
    if ('fail' in res) {
      if (res.alert) void alertDialog('Tracé impossible', res.fail);
      else app.status(res.fail);
      return;
    }
    // Layers stay independent: a replaced item is only removed from the current layer.
    const remove = (res.remove ?? []).filter((i) => app.inCurrentLayer(i.id)).map((i) => i.id);
    app.addShapes(res.shapes, r.label, { center: res.center, remove, link: { recipe: r.id, sources } });
    if (this.belowPrecision) app.status(`Attention : ${this.belowPrecision}`);
    this.belowPrecision = '';
  }

  click(app: App, e: ToolEvent): void {
    const first = this.recipe.steps[0];
    if (first.take === 'item' && this.inputs.length <= 1) {
      // Choosing the reference item, or another one.
      const hit = app.isOnPoint(e.screen) ? null : app.pick(e.screen, first.kinds);
      const ref = this.inputs[0] as Item | undefined;
      if (hit && hit.item.id !== ref?.id) {
        this.inputs = [hit.item];
        this.sources = [itemSource(hit.item as StrokeItem)];
        this.round++;
        this.next(app);
        return;
      }
      if (!ref) {
        app.status(`${first.tip} (aucun élément adapté sous le curseur)`);
        return;
      }
      // The reference may have been deleted or changed meanwhile.
      const current = app.findItem(ref.id);
      if (!current) {
        this.start(app);
        return;
      }
      this.inputs[0] = current.item;
      this.sources[0] = itemSource(current.item as StrokeItem);
    }
    const step = this.step;
    if (step?.take === 'point') {
      const p = this.position(step, e.p, e.raw);
      const refused = step.refuse?.(p, this.inputs);
      if (refused !== undefined) {
        if (refused) app.status(refused);
        return;
      }
      this.inputs.push(p);
      this.sources.push(step.raw ? { k: 'pt', p: e.raw } : clickSource(e.raw, e.snap, (id) => app.findItem(id)?.item));
      this.next(app);
    } else if (step?.take === 'angle') {
      const side = step.side(this.inputs);
      if (samePt(e.raw, side.p1)) return;
      const span = this.tracker.update(side, seg(side.p1, e.raw));
      this.inputs.push(span);
      this.sources.push({ k: 'num', v: span });
      this.next(app);
    }
  }

  private position(step: Extract<Step, { take: 'point' }>, snapped: Pt, raw: Pt): Pt {
    const p = step.raw ? raw : snapped;
    return step.onto ? step.onto(p, this.inputs) : p;
  }

  move(app: App, e: ToolEvent): void {
    super.move(app, e);
    const step = this.step;
    if (step?.take !== 'angle') return;
    const side = step.side(this.inputs);
    if (!samePt(e.raw, side.p1)) app.status(step.live(this.tracker.update(side, seg(side.p1, e.raw))));
  }

  key(app: App, e: KeyboardEvent): boolean {
    const step = this.step;
    if (e.key !== 'Enter' || step?.take !== 'angle' || !step.prompt) return false;
    const { title, label, initial } = step.prompt;
    const round = this.round;
    void (async () => {
      const a = await promptNumber(title, label, initial(this.tracker.span), { unit: '°', min: -360, max: 360 });
      if (a === null || round !== this.round) return;
      this.inputs.push(a);
      this.sources.push({ k: 'num', v: a });
      this.next(app);
    })();
    return true;
  }

  /** Last direction typed. */
  private lastAzimuth = 'S';

  private async askAzimuth(app: App, step: Extract<Step, { take: 'azimuth' }>): Promise<void> {
    const round = this.round;
    const g = app.georef();
    const geographic = app.units().north === 'meridian' && !!g;
    const north = geographic ? 'le nord géographique (méridien local)' : 'le haut de la feuille';
    const r = await promptAzimuth(step.title, step.label, this.lastAzimuth, north);
    if (round !== this.round) return;
    if (!r) {
      this.start(app);
      return;
    }
    this.lastAzimuth = r.typed;
    // The north of the meridian leans on a conic map: turned into the sheet's one, at the origin.
    const origin = [...this.inputs].reverse().find(isPt);
    const sheet = geographic && origin ? (r.az + meridianAngle(g!, origin) + 360) % 360 : r.az;
    this.inputs.push(sheet);
    this.sources.push({ k: 'num', v: sheet, expr: `${r.typed} (${geographic ? 'nord géographique' : 'nord de la feuille'})` });
    this.next(app);
  }

  private async askLength(app: App, step: Extract<Step, { take: 'length' }>): Promise<void> {
    const round = this.round;
    const c = app.lengthContext();
    const k = app.unitPerPx();
    const units = { scaled: k > 0, len: (px: number) => app.sheetText(px) };
    const initial = step.initial ? String(Math.round(step.initial(this.inputs) * (k || 1) * 100) / 100).replace('.', ',') : (this.lastLength ?? '1');
    const r = await promptLength(step.title, step.label, initial, c, step.hint?.(this.inputs, units));
    if (round !== this.round) return;
    if (!r) {
      this.start(app);
      return;
    }
    if (!step.initial) this.lastLength = r.expr ?? String(Math.round(r.px * (k || 1) * 1e6) / 1e6).replace('.', ',');
    this.inputs.push(r.px);
    this.sources.push({ k: 'num', v: r.px, ...(r.expr ? { expr: r.expr } : {}) });
    // Below the precision of the map: done, but said.
    const mm = c.mPerPx ? ((r.px * c.mPerPx) / c.units.paper) * 1000 : Infinity;
    const p = c.units.precisionMm;
    this.belowPrecision = mm < p
      ? `${fmt(mm, 3)} mm sur la carte : c'est sous la précision de la carte (± ${fmt(p, 1)} mm), illisible sur cette carte — à refaire sur une carte plus précise.`
      : mm < 10 * p ? `${fmt(mm, 2)} mm sur la carte : c'est au niveau de la précision de la carte (± ${fmt(p, 1)} mm).` : '';
    this.next(app);
  }

  overlay(r: Renderer, app: App): void {
    const mouse = this.mouse;
    const step = this.step;
    if (!mouse || !step || step.take === 'item') return;
    const rec = this.recipe;
    // The inputs as they would be after a click here.
    const inputs = [...this.inputs];
    if (step.take === 'point') inputs.push(this.position(step, mouse, this.raw ?? mouse));
    if (step.take === 'angle') inputs.push(this.tracker.span);
    const p = app.project!;
    const style = this.style(app);
    if (rec.markers) for (const q of this.inputs) if (isPt(q)) r.point(q, p.color, 5, 0.8);
    if (inputs.length === rec.steps.length) {
      const res = rec.build(inputs);
      if (!('fail' in res)) for (const s of res.shapes) drawShape(r, s, style);
    }
    const d: Draft = { r, mouse, color: p.color, width: p.width, zoom: app.cam.zoom, style, len: (px) => app.formatLength(px) };
    rec.draft?.(d, inputs);
  }

  private style(app: App): StrokeStyle {
    switch (this.recipe.previewStyle) {
      case 'solid':
        return previewStyle(app, []);
      case 'bold':
        return { color: app.project!.color, width: app.project!.width + 2, alpha: 0.6 };
      default:
        return previewStyle(app);
    }
  }
}

function drawShape(r: Renderer, s: Shape, style: StrokeStyle): void {
  if (s.kind === 'point') r.point(s.p, style.color, 5, 0.8);
  else r.outline({ ...s, id: '', color: style.color, width: style.width } as Exclude<Item, { kind: 'pixmap' }>, style);
}
