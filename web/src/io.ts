/**
 * Import and export of whole projects.
 *
 * The exchange format is the desktop one: a folder (or a .zip of it) holding
 * `<project>.grib`, one `<layer>.xml` per layer, the background map and the
 * imported pictures. A project exported here opens in the desktop version
 * once unzipped, and vice versa.
 */

import { unzipSync, zipSync, type Zippable } from 'fflate';
import { uniqueIds } from './links';
import { baseName, parseGrib, parseLayerXml, writeGrib, writeLayerXml } from './legacy';
import { emptyProject, newId, type Group, type Project } from './model';

export interface ImportResult {
  project: Project;
  files: Map<string, Blob>;
  warnings: string[];
  /** Base name of the map the .grib refers to, when it was not found. */
  missingMap?: string;
}

const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg|avif)$/i;
export const isImageName = (name: string) => IMAGE_RE.test(name);

export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (
    {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
      webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', avif: 'image/avif',
      xml: 'application/xml', grib: 'text/plain',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
}

interface NamedBlob {
  path: string; // relative path inside the folder or zip
  blob: Blob;
}

/** Expand .zip files into their entries. */
async function expand(files: NamedBlob[]): Promise<NamedBlob[]> {
  const out: NamedBlob[] = [];
  for (const f of files) {
    if (/\.(zip|gribz)$/i.test(f.path)) {
      const entries = unzipSync(new Uint8Array(await f.blob.arrayBuffer()));
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue;
        out.push({ path, blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeOf(path) }) });
      }
    } else out.push(f);
  }
  return out;
}

export function fromFileList(list: FileList | File[]): NamedBlob[] {
  return Array.from(list).map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }));
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Build a project from the files of a desktop project folder (or a zip of it).
 * Returns null if no .grib file is found.
 */
export async function importProject(input: NamedBlob[]): Promise<ImportResult | null> {
  const files = await expand(input);
  const gribs = files.filter((f) => /\.grib$/i.test(f.path));
  if (gribs.length === 0) return null;
  // Several projects in the selection: take the one closest to the root.
  gribs.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const grib = gribs[0];
  const dir = grib.path.includes('/') ? grib.path.slice(0, grib.path.lastIndexOf('/') + 1) : '';
  const inDir = files.filter((f) => f.path.startsWith(dir));
  const byName = new Map<string, Blob>();
  // Files of the project folder first, then any other selected file.
  for (const f of [...files.filter((f) => !f.path.startsWith(dir)), ...inDir]) byName.set(baseName(f.path), f.blob);
  const find = (name: string): [string, Blob] | undefined => {
    const exact = byName.get(name);
    if (exact) return [name, exact];
    const lower = name.toLowerCase();
    for (const [k, v] of byName) if (k.toLowerCase() === lower) return [k, v];
    return undefined;
  };

  const data = parseGrib(await grib.blob.text());
  const project = emptyProject(stem(baseName(grib.path)));
  const warnings: string[] = [];
  const projectFiles = new Map<string, Blob>();
  project.scale = data.scale;
  project.color = data.color;
  project.width = data.width;
  project.customColors = data.customColors;

  const extra = find(stem(baseName(grib.path)) + WEB_DATA_EXT);
  if (extra) readWebData(project, await extra[1].text(), warnings);

  let missingMap: string | undefined;
  if (data.mapPath) {
    const m = find(baseName(data.mapPath));
    if (m) {
      project.mapFile = m[0];
      projectFiles.set(m[0], m[1]);
    } else missingMap = baseName(data.mapPath);
  }
  project.mapName = data.mapName || (project.mapFile ? stem(project.mapFile) : '');

  const missingLayers: string[] = [];
  const missingPics = new Set<string>();
  for (const name of data.layerNames) {
    const f = find(`${name}.xml`);
    if (!f) {
      missingLayers.push(`${name}.xml`);
      continue;
    }
    const { layer, pixmapPaths } = parseLayerXml(name, await f[1].text());
    project.layers.push(layer);
    for (const p of pixmapPaths) {
      const pic = find(baseName(p));
      if (pic) projectFiles.set(pic[0], pic[1]);
      else missingPics.add(baseName(p));
    }
  }
  // Ids saved by the web version: kept, unless the same file was given twice.
  project.layers = uniqueIds(project.layers, new Set());
  const groups = pendingGroups.get(project);
  if (groups) {
    project.groups = groups.map(({ group, layers }) => ({
      ...group, layerIds: layers.map((n) => project.layers.find((l) => l.name === n)?.id).filter((x): x is string => !!x),
    }));
  }
  if (missingLayers.length) warnings.push(`Calque(s) introuvable(s) : ${missingLayers.join(', ')}`);
  if (missingPics.size) warnings.push(`Image(s) introuvable(s) : ${[...missingPics].join(', ')}`);
  return { project, files: projectFiles, warnings, missingMap };
}

/*
 * What only the web version knows (the GPS anchors) goes to a side file,
 * `<project>.web.json`, which the desktop version ignores.
 */
const WEB_DATA_EXT = '.web.json';

/** Groups read from a side file, waiting for the layers they name. */
const pendingGroups = new WeakMap<Project, { group: Group; layers: string[] }[]>();

function writeWebData(project: Project, fileNames: Map<string, string>): string | null {
  const anchors = project.anchors ?? [];
  const units = project.units && Object.keys(project.units).length ? project.units : undefined;
  // The layers of a group by their file name: the ids do not survive an import.
  const groups = (project.groups ?? []).map(({ code, title, color, text, notes, layerIds }) => ({
    code, title, color, text, notes, layers: layerIds.map((id) => fileNames.get(id)).filter((n): n is string => !!n),
  }));
  if (!anchors.length && !units && !groups.length) return null;
  return JSON.stringify({
    format: 'gribouillot-web', version: 1, units, ...(groups.length ? { groups } : {}),
    anchors: anchors.map(({ name, p, lat, lon }) => ({ name, x: p.x, y: p.y, lat, lon })),
  }, null, 1);
}

function readWebData(project: Project, text: string, warnings: string[]): void {
  try {
    const d = JSON.parse(text) as {
      units?: Record<string, unknown>;
      groups?: { code?: unknown; title?: unknown; color?: unknown; text?: unknown; notes?: unknown; layers?: unknown }[];
      anchors?: { name?: unknown; x: unknown; y: unknown; lat: unknown; lon: unknown }[];
    };
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (Array.isArray(d.groups)) {
      // The layers are read later: their names are kept here, made ids by importProject.
      pendingGroups.set(project, d.groups.map((g) => ({
        group: { id: newId('e'), code: str(g.code), title: str(g.title), color: /^#[0-9a-f]{6}$/i.test(str(g.color)) ? str(g.color) : '#000000', text: str(g.text), notes: str(g.notes), layerIds: [] },
        layers: Array.isArray(g.layers) ? g.layers.filter((x): x is string => typeof x === 'string') : [],
      })));
    }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    if (d.units && typeof d.units === 'object') {
      const u = d.units;
      project.units = {
        ...(num(u.paper) ? { paper: num(u.paper)! } : {}),
        ...(num(u.measure) ? { measure: num(u.measure)! } : {}),
        ...(num(u.precisionMm) ? { precisionMm: num(u.precisionMm)! } : {}),
        ...(u.north === 'sheet' || u.north === 'meridian' ? { north: u.north } : {}),
      };
    }
    project.anchors = [];
    for (const a of d.anchors ?? []) {
      const x = num(a.x), y = num(a.y), lat = num(a.lat), lon = num(a.lon);
      if (x === null || y === null || lat === null || lon === null) continue;
      project.anchors.push({ id: newId('g'), name: typeof a.name === 'string' ? a.name : 'repère', p: { x, y }, lat, lon });
    }
  } catch {
    warnings.push('Fichier des repères GPS illisible : calage ignoré.');
  }
}

/** Layer files (.xml) found among the given files, to add them to a project. */
export async function importLayers(input: NamedBlob[]): Promise<{ layers: ReturnType<typeof parseLayerXml>[]; files: Map<string, Blob> }> {
  const files = await expand(input);
  const layers = [];
  const byName = new Map(files.map((f) => [baseName(f.path), f.blob]));
  const pics = new Map<string, Blob>();
  for (const f of files.filter((f) => /\.xml$/i.test(f.path))) {
    const text = await f.blob.text();
    if (!text.includes('<GribouillotLayer')) continue;
    const parsed = parseLayerXml(stem(baseName(f.path)), text);
    layers.push(parsed);
    for (const p of parsed.pixmapPaths) {
      const b = byName.get(baseName(p));
      if (b) pics.set(baseName(p), b);
    }
  }
  return { layers, files: pics };
}

/** Characters that can not appear in a file name on any OS. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'sans_nom';
}

/** Zip the project in the desktop folder layout. */
export async function exportProjectZip(project: Project, getFile: (name: string) => Promise<Blob | null>): Promise<Blob> {
  const folder = safeFileName(project.name) + '/';
  const entries: Zippable = {};
  const used = new Set<string>();
  const layerNames: string[] = [];
  const layerFiles = new Map<string, string>();
  for (const layer of project.layers) {
    let name = safeFileName(layer.name);
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safeFileName(layer.name)}_${i}`;
    used.add(name.toLowerCase());
    layerNames.push(name);
    layerFiles.set(layer.id, name);
    entries[folder + name + '.xml'] = [new TextEncoder().encode(writeLayerXml(layer)), { level: 6 }];
  }
  const grib = writeGrib({
    mapName: project.mapName,
    mapPath: project.mapFile ?? '',
    color: project.color,
    width: project.width,
    customColors: project.customColors,
    scale: project.scale,
    layerNames,
  });
  entries[folder + safeFileName(project.name) + '.grib'] = [new TextEncoder().encode(grib), { level: 6 }];
  const extra = writeWebData(project, layerFiles);
  if (extra) entries[folder + safeFileName(project.name) + WEB_DATA_EXT] = [new TextEncoder().encode(extra), { level: 6 }];
  const fileNames = new Set<string>();
  if (project.mapFile) fileNames.add(project.mapFile);
  for (const l of project.layers) for (const it of l.items) if (it.kind === 'pixmap') fileNames.add(it.file);
  for (const name of fileNames) {
    const blob = await getFile(name);
    if (blob) entries[folder + name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  const zipped = zipSync(entries);
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
