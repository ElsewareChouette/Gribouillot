/**
 * The life of a project in the browser: opening, closing, saving in
 * IndexedDB, the files it uses (map and pictures), import and export.
 */

import type { App } from './app';
import { Camera } from './camera';
import { pt } from './geom';
import { Picture } from './images';
import { download, exportProjectZip, importProject, isImageName, mimeOf, safeFileName, type ImportResult } from './io';
import { emptyLayer, emptyProject, type Project } from './model';
import { Renderer } from './render';
import { toGeoJSON } from './geojson';
import { organizeByEnigmas } from './enigmas';
import * as store from './store';
import { alertDialog, confirmDialog, openDialog, promptText } from './ui/dialogs';
import { h, pickFiles } from './ui/dom';

const SAVE_DELAY = 600; // ms

export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

export class Session {
  /** A change is waiting to be saved. */
  saving = false;
  private saveTimer: number | undefined;

  constructor(private readonly app: App) {}

  /* ------------------------------------------------------------ saving */

  scheduleSave(): void {
    if (!this.app.project) return;
    window.clearTimeout(this.saveTimer);
    this.saving = true;
    this.saveTimer = window.setTimeout(() => void this.saveNow(), SAVE_DELAY);
  }

  async saveNow(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const app = this.app;
    const p = app.project;
    if (!p) return;
    const c = app.cam.center();
    p.view = { zoom: app.cam.zoom, cx: c.x, cy: c.y };
    try {
      await store.saveProject(p);
      this.saving = false;
    } catch (e) {
      app.status(`Enregistrement dans le navigateur impossible : ${(e as Error).message}`);
    }
    app.onChange();
  }

  /* ------------------------------------------------------------- files */

  /** Store a file of the project, renaming it if another file has the same name. */
  async storeFile(name: string, blob: Blob): Promise<string> {
    const p = this.app.project!;
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

  async loadPicture(name: string, blob: Blob, mips = true): Promise<Picture | null> {
    const app = this.app;
    try {
      const pic = await Picture.load(blob, mips);
      app.pictures.get(name)?.close();
      app.pictures.set(name, pic);
      app.requestRender();
      return pic;
    } catch (e) {
      await alertDialog('Image illisible', `Impossible de lire l'image « ${name} » : ${(e as Error).message ?? e}`);
      return null;
    }
  }

  async changeMap(): Promise<void> {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (file) await this.setMapFile(file.name, file);
  }

  private async setMapFile(name: string, blob: Blob): Promise<void> {
    const app = this.app;
    const p = app.project!;
    const fileName = await this.storeFile(name, blob);
    p.mapFile = fileName;
    if (!p.mapName) p.mapName = splitExt(fileName)[0];
    app.options.gray = false;
    await this.loadMap(true);
    app.changed();
  }

  private async loadMap(fit: boolean): Promise<void> {
    const app = this.app;
    const p = app.project!;
    app.cam.bounds = null;
    if (!p.mapFile) return;
    const blob = await store.getFile(p.id, p.mapFile);
    if (!blob) {
      app.status(`Carte « ${p.mapFile} » introuvable dans le navigateur.`);
      return;
    }
    app.status('Chargement de la carte…');
    const pic = await this.loadPicture(p.mapFile, blob, true);
    if (!pic) return;
    app.cam.bounds = { x: 0, y: 0, w: pic.w, h: pic.h };
    if (fit) app.zoomToFit();
    app.status('');
    app.applyKnownCalibration(pic);
  }

  /* --------------------------------------------------------- projects */

  private async open(project: Project, fit: boolean): Promise<void> {
    const app = this.app;
    await this.closeProject(false);
    // Work by énigmes by default: a project that never had them gets them (not one whose groups were removed).
    if (project.groups === undefined) project.groups = organizeByEnigmas(project.layers);
    app.project = project;
    app.currentLayerId = project.layers[project.layers.length - 1]?.id ?? null;
    store.setLastProjectId(project.id);
    app.onProjectOpen(true);
    app.resize();
    app.setTool('select');
    await this.loadMap(fit || !project.view);
    if (!fit && project.view) {
      app.cam.setZoom(project.view.zoom);
      app.cam.centerOn(pt(project.view.cx, project.view.cy));
    } else if (!project.mapFile) app.zoomToFit();
    // Pictures of the layers.
    const files = new Set<string>();
    for (const l of project.layers) for (const it of l.items) if (it.kind === 'pixmap') files.add(it.file);
    for (const f of files) {
      const blob = await store.getFile(project.id, f);
      if (blob) await this.loadPicture(f, blob, false);
    }
    app.onChange();
    app.requestRender();
  }

  async openStored(id: string): Promise<void> {
    const p = await store.loadProject(id);
    if (!p) {
      await alertDialog('Projet introuvable', 'Ce projet n\'existe plus dans ce navigateur.');
      return;
    }
    await this.open(p, false);
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

  async closeProject(showStart = true): Promise<void> {
    const app = this.app;
    if (app.project) await this.saveNow();
    app.project = null;
    for (const p of app.pictures.values()) p.close();
    app.pictures.clear();
    app.history.clear();
    app.selection.clear();
    app.currentLayerId = null;
    app.options.gray = false;
    app.cam.bounds = null;
    if (showStart) {
      store.setLastProjectId(null);
      app.onProjectOpen(false);
    }
    app.requestRender();
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
    // It starts at the first énigme.
    const first = emptyLayer('530 constructions');
    p.layers = [first];
    p.groups = organizeByEnigmas(p.layers);
    p.color = p.groups[0].color;
    await store.putFile(p.id, p.mapFile, file);
    await store.saveProject(p);
    void store.requestPersistence();
    await this.open(p, true);
    // A known map got its calibration and its scale meanwhile (see App.applyKnownCalibration).
    if (!p.scale.px) this.app.status('Projet créé. Mesurez l\'échelle dans le panneau « Carte » pour obtenir des distances réelles.');
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
    this.app.status('Import du projet…');
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
    else this.app.status(`Projet « ${project.name} » importé (${project.layers.length} calque(s)).`);
    return true;
  }

  async pickProjectFolder(): Promise<void> {
    const files = await pickFiles({ directory: true });
    if (files.length) await this.handleFiles(files.map((f) => ({ path: f.webkitRelativePath || f.name, blob: f })));
  }

  async pickProjectFiles(): Promise<void> {
    const files = await pickFiles({ multiple: true, accept: '.zip,.gribz,.grib,.xml,.json,image/*' });
    if (files.length) await this.handleFiles(files.map((f) => ({ path: f.webkitRelativePath || f.name, blob: f })));
  }

  /** Files dropped or picked: a project, layers, a map or a picture. */
  async handleFiles(files: { path: string; blob: Blob }[]): Promise<void> {
    const app = this.app;
    const hasProject = files.some((f) => /\.(grib|zip|gribz)$/i.test(f.path));
    if (hasProject) {
      if (await this.importProjectFiles(files)) return;
      if (app.project && files.some((f) => /\.(xml|zip)$/i.test(f.path))) return app.importLayerFiles(files);
      await alertDialog('Aucun projet', 'Aucun fichier de projet Gribouillot (.grib) n\'a été trouvé.');
      return;
    }
    if (app.project && files.some((f) => /\.xml$/i.test(f.path))) return app.importLayerFiles(files);
    const img = files.find((f) => isImageName(f.path));
    if (img) {
      const file = new File([img.blob], img.path.split('/').pop()!, { type: img.blob.type || mimeOf(img.path) });
      if (!app.project) return this.newProject(file);
      const choice = await openDialog('Image déposée', `Que faire de « ${file.name} » ?`, [
        { label: 'Annuler', value: null },
        { label: 'Remplacer la carte', value: 'map' as const },
        { label: 'Ajouter au calque', value: 'pic' as const, primary: true },
      ]);
      if (choice === 'map') await this.setMapFile(file.name, file);
      else if (choice === 'pic') await app.addPictureFile(file, file.name);
      return;
    }
    await alertDialog('Fichiers non reconnus', 'Déposez un dossier de projet Gribouillot, un .zip, un calque .xml ou une image.');
  }

  /* ------------------------------------------------------------ export */

  async exportZip(): Promise<void> {
    const app = this.app;
    const p = app.project;
    if (!p) return;
    app.status('Préparation du fichier .zip…');
    await this.saveNow();
    const blob = await exportProjectZip(p, (name) => store.getFile(p.id, name));
    download(blob, `${safeFileName(p.name)}.zip`);
    app.status('Projet exporté. Décompressé, il s\'ouvre aussi dans Gribouillot pour ordinateur.');
  }

  /** The figures in GPS coordinates, as GeoJSON (needs the calibration). */
  async exportGeoJSON(): Promise<void> {
    const app = this.app;
    const p = app.project;
    const g = app.georef();
    if (!p) return;
    if (!g) {
      await alertDialog('Export GeoJSON', 'Calez d\'abord la carte (onglet « Carte ») : il faut connaître la position GPS des tracés.');
      return;
    }
    const map = app.mapPicture();
    const rect = map ? { x: 0, y: 0, w: map.w, h: map.h } : app.cam.visibleRect();
    const data = toGeoJSON(app.shownLayers().filter((l) => l.visible), app.groups(), g, rect, (px) => app.formatLength(px));
    download(new Blob([JSON.stringify(data)], { type: 'application/geo+json' }), `${safeFileName(p.name)}.geojson`);
    app.status(`GeoJSON exporté (${(data as { features: unknown[] }).features.length} objets, calques visibles${app.untilRank !== null ? ', état à l\'énigme en cours' : ''}) : il s'ouvre dans QGIS, uMap, geojson.io…`);
  }

  /** Export the current view, or the whole map, as a picture. */
  async exportImage(): Promise<void> {
    const app = this.app;
    const p = app.project;
    if (!p) return;
    const map = app.mapPicture();
    const what = h('select', {},
      h('option', { value: 'view' }, 'La vue actuelle'),
      map ? h('option', { value: '1' }, `Toute la carte, taille réelle (${map.w} × ${map.h} px)`) : null,
      map ? h('option', { value: '0.5' }, `Toute la carte, 50 % (${Math.round(map.w / 2)} × ${Math.round(map.h / 2)} px)`) : null,
      map ? h('option', { value: '0.25' }, `Toute la carte, 25 % (${Math.round(map.w / 4)} × ${Math.round(map.h / 4)} px)`) : null,
    );
    const format = h('select', {}, h('option', { value: 'image/png' }, 'PNG'), h('option', { value: 'image/jpeg' }, 'JPEG (plus léger)'));
    const legend = h('input', { type: 'checkbox', checked: true });
    const groups = app.groups();
    const state = app.untilRank !== null && groups[app.untilRank]
      ? `État à l'énigme ${groups[app.untilRank].code} : les énigmes suivantes ne sont pas dessinées.`
      : groups.length ? 'Toutes les énigmes (cochez « état à cette énigme » en haut pour n\'exporter que l\'état à une énigme).' : '';
    const ok = await openDialog('Exporter une image', h('div', { class: 'options' },
      h('label', {}, 'Contenu', what), h('label', {}, 'Format', format),
      h('label', { class: 'check' }, legend, 'Légende, échelle et nord'),
      state ? h('p', { class: 'hint' }, state) : null), [
      { label: 'Annuler', value: false },
      { label: 'Exporter', value: true, primary: true },
    ]);
    if (!ok) return;
    let canvas: HTMLCanvasElement;
    const cam = app.cam;
    if (what.value === 'view') canvas = this.renderOffscreen(cam.width, cam.height, cam.zoom, cam.panX, cam.panY, window.devicePixelRatio || 1);
    else {
      const k = parseFloat(what.value);
      const w = Math.round(map!.w * k), hh = Math.round(map!.h * k);
      if (w > 16384 || hh > 16384 || w * hh > 250e6) {
        await alertDialog('Image trop grande', 'Le navigateur ne peut pas produire une image aussi grande : choisissez une taille plus petite.');
        return;
      }
      app.status('Rendu de l\'image…');
      canvas = this.renderOffscreen(w, hh, k, 0, 0, 1);
    }
    if (legend.checked) this.drawLegend(canvas, what.value === 'view' ? cam.zoom : parseFloat(what.value), what.value === 'view' ? window.devicePixelRatio || 1 : 1);
    const type = format.value;
    canvas.toBlob((blob) => {
      if (!blob) return void alertDialog('Export impossible', 'Le navigateur n\'a pas pu produire l\'image.');
      download(blob, `${safeFileName(p.name)}.${type === 'image/png' ? 'png' : 'jpg'}`);
      app.status('Image exportée.');
    }, type, 0.92);
  }

  /** The legend of an exported picture: the énigmes shown, a scale bar, the north. */
  private drawLegend(canvas: HTMLCanvasElement, zoom: number, dpr: number): void {
    const app = this.app;
    const p = app.project!;
    const x = canvas.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const groups = app.groups();
    const until = app.untilRank ?? groups.length - 1;
    const shown = groups.filter((g, i) => i <= until && g.layerIds.length);
    const lines: { text: string; color?: string; bold?: boolean }[] = [{ text: p.name, bold: true }];
    if (app.untilRank !== null && groups[app.untilRank]) lines.push({ text: `État à l'énigme ${groups[app.untilRank].code} (${app.untilRank + 1}/${groups.length})` });
    for (const g of shown) lines.push({ text: `${g.code} — ${g.title}`, color: g.color });
    const pad = 12, lh = 20, size = 14;
    x.font = `${size}px system-ui, sans-serif`;
    const width = Math.max(220, ...lines.map((l) => x.measureText(l.text).width + (l.color ? 26 : 0))) + pad * 2;
    // A round length of the ground for the scale bar, about 150 px long.
    const m = app.mPerPx();
    let bar: { px: number; label: string } | null = null;
    if (m) {
      const target = (150 / zoom) * m;
      const pow = Math.pow(10, Math.floor(Math.log10(target)));
      const nice = [5, 2, 1].map((k) => k * pow).find((v) => v <= target) ?? pow;
      bar = { px: (nice / m) * zoom, label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
    }
    const height = pad * 2 + lines.length * lh + (bar ? 34 : 0);
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const left = 16, top = H - height - 16;
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.strokeStyle = '#888';
    x.lineWidth = 1;
    x.beginPath();
    x.roundRect(left, top, width, height, 8);
    x.fill();
    x.stroke();
    lines.forEach((l, i) => {
      const y = top + pad + i * lh + 14;
      if (l.color) {
        x.fillStyle = l.color;
        x.fillRect(left + pad, y - 10, 16, 10);
      }
      x.fillStyle = '#111';
      x.font = `${l.bold ? 'bold ' : ''}${size}px system-ui, sans-serif`;
      x.fillText(l.text, left + pad + (l.color ? 26 : 0), y);
    });
    if (bar) {
      const y = top + pad + lines.length * lh + 10;
      x.fillStyle = '#111';
      x.fillRect(left + pad, y, bar.px, 6);
      x.font = `${size - 2}px system-ui, sans-serif`;
      x.fillText(bar.label, left + pad + bar.px + 8, y + 7);
    }
    // The north: the top of the sheet.
    x.fillStyle = '#111';
    x.font = 'bold 16px system-ui, sans-serif';
    x.fillText('N', W - 32, 30);
    x.beginPath();
    x.moveTo(W - 26, 36);
    x.lineTo(W - 32, 56);
    x.lineTo(W - 20, 56);
    x.closePath();
    x.fill();
  }

  private renderOffscreen(w: number, hh: number, zoom: number, panX: number, panY: number, dpr: number): HTMLCanvasElement {
    const app = this.app;
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
    const map = app.mapPicture();
    if (map) r.map(map, app.options.gray && map.hasGray(), dpr);
    r.layers(app.shownLayers(), { selection: new Set(), showWeight: app.options.weights, showNames: app.options.showNames, pictures: app.pictures, dpr });
    return canvas;
  }
}
