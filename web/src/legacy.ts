/**
 * Read and write the file formats of the desktop version (Qt):
 * - the project file `<name>.grib`, a QSettings INI file;
 * - one `<layer name>.xml` file per layer.
 *
 * Writing them back lets a project go back and forth between the web and the
 * desktop versions.
 */

import { pt, type Pt } from './geom';
import {
  emptyLayer,
  newId,
  type Item,
  type Layer,
  type Link,
  type MapScale,
} from './model';

/* ------------------------------------------------------------------ INI */

export type Ini = Map<string, Map<string, string>>;

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);
const isOctal = (c: string) => /^[0-7]$/.test(c);

/** Undo the QSettings escaping of a value (quotes, \x.., \0, ...). */
export function iniUnescape(raw: string): string {
  let out = '';
  let inQuotes = false;
  let i = 0;
  const s = raw.trim();
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    i++;
    const e = s[i++];
    switch (e) {
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'v': out += '\v'; break;
      case 'x': {
        let h = '';
        while (h.length < 4 && i < s.length && isHex(s[i])) h += s[i++];
        out += String.fromCharCode(parseInt(h || '0', 16));
        break;
      }
      default:
        if (e !== undefined && isOctal(e)) {
          let o = e;
          while (o.length < 3 && i < s.length && isOctal(s[i])) o += s[i++];
          out += String.fromCharCode(parseInt(o, 8));
        } else if (e !== undefined) {
          out += e; // \" \' \\ \? and unknown escapes
        }
    }
  }
  return out;
}

/**
 * QSettings escaping of a value. Non-ASCII characters are escaped too, which
 * Qt 5 and Qt 6 both read back (Qt 6 itself would write raw UTF-8).
 */
export function iniEscape(value: string): string {
  let out = '';
  let needsQuotes = false;
  let escapeNextIfDigit = false;
  const variant = value.startsWith('@Variant(') || value.startsWith('@ByteArray(');
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === ';' || ch === ',' || ch === '=') needsQuotes = true;
    if (escapeNextIfDigit && isHex(ch)) {
      out += '\\x' + code.toString(16);
      continue;
    }
    escapeNextIfDigit = false;
    switch (ch) {
      case '\0': out += '\\0'; escapeNextIfDigit = true; break;
      case '\x07': out += '\\a'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\v': out += '\\v'; break;
      case '"':
      case '\\':
        out += '\\' + ch;
        break;
      default:
        if (code <= 0x1f || code >= 0x7f) {
          if (!variant && code > 0xffff) {
            // Outside of the BMP: Qt would need a surrogate pair, write raw UTF-8.
            out += ch;
          } else {
            out += '\\x' + code.toString(16);
            escapeNextIfDigit = true;
          }
        } else out += ch;
    }
  }
  if (needsQuotes || out.startsWith(' ') || out.endsWith(' ')) out = `"${out}"`;
  return out;
}

export function parseIni(text: string): Ini {
  const ini: Ini = new Map();
  let section = 'General';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = /^\[(.*)\]$/.exec(line);
    if (sec) {
      section = decodeURIComponentSafe(sec[1]);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = decodeURIComponentSafe(line.slice(0, eq).trim());
    const value = iniUnescape(line.slice(eq + 1));
    if (!ini.has(section)) ini.set(section, new Map());
    ini.get(section)!.set(key, value);
  }
  return ini;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function writeIni(ini: Ini): string {
  const parts: string[] = [];
  for (const [section, entries] of ini) {
    parts.push(`[${section}]`);
    for (const [k, v] of entries) parts.push(`${k}=${iniEscape(v)}`);
    parts.push('');
  }
  return parts.join('\n');
}

/* --------------------------------------------------------------- QColor */

/** Decode a QColor serialized by QSettings as "@Variant(...)". */
export function parseQColorVariant(v: string | undefined): string | null {
  if (!v) return null;
  if (v.startsWith('#')) return v.slice(0, 7);
  const m = /^@Variant\(([\s\S]*)\)$/.exec(v);
  if (!m) return null;
  const b = Array.from(m[1], (c) => c.charCodeAt(0) & 0xff);
  // QVariant: quint32 type (67 = QColor) + quint8 isNull, then QColor:
  // qint8 spec, quint16 alpha, red, green, blue, pad.
  if (b.length < 15) return null;
  const type = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  if (type !== 67) return null;
  let o = 4;
  // Qt >= 4 streams a "null" flag byte after the type.
  if (b.length >= 16) o = 5;
  const spec = b[o];
  if (spec === 0) return null; // invalid color
  const word = (i: number) => (b[o + 1 + i * 2] << 8) | b[o + 2 + i * 2];
  const r = word(1) >> 8, g = word(2) >> 8, bl = word(3) >> 8;
  return '#' + [r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Encode a #rrggbb color the way QSettings stores a QColor. */
export function qColorVariant(color: string): string {
  const c = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? '000000';
  const comps = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  const bytes = [0, 0, 0, 0x43, 0x01, 0xff, 0xff];
  for (const v of comps) bytes.push(v, v); // 16 bits: v * 0x101
  bytes.push(0, 0);
  return '@Variant(' + String.fromCharCode(...bytes) + ')';
}

/* ------------------------------------------------------------ .grib file */

export interface GribData {
  mapName: string;
  mapPath: string;
  color: string;
  width: number;
  customColors: string[];
  scale: MapScale;
  layerNames: string[]; // in display order
}

export function parseGrib(text: string): GribData {
  const ini = parseIni(text);
  const get = (s: string, k: string) => ini.get(s)?.get(k);
  const customColors: string[] = [];
  const cc = ini.get('customColors') ?? ini.get('customColor');
  if (cc) {
    for (let i = 0; i < 16; i++) {
      const c = parseQColorVariant(cc.get(`color${i}`));
      if (c && c !== '#ffffff') customColors.push(c);
    }
  }
  const order = [...(ini.get('layersOrder') ?? new Map()).entries()]
    .map(([k, v]) => [parseInt(k, 10), v] as const)
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
  return {
    mapName: get('map', 'mapName') ?? '',
    mapPath: get('map', 'mapPath') ?? '',
    color: parseQColorVariant(get('drawing', 'color')) ?? '#000000',
    width: parseInt(get('drawing', 'width') ?? '5', 10) || 5,
    customColors,
    scale: {
      px: parseFloat(get('scale', 'pxSpinBx') ?? '0') || 0,
      value: parseFloat(get('scale', 'kmSpinBx') ?? '0') || 0,
      unit: get('scale', 'mkmUnit') === '1' ? 'm' : 'km',
    },
    layerNames: order,
  };
}

export function writeGrib(d: GribData): string {
  const ini: Ini = new Map();
  ini.set('GPS', new Map([['gpsEnabled', 'false']]));
  const cc = new Map<string, string>();
  for (let i = 0; i < 16; i++) cc.set(`color${i}`, qColorVariant(d.customColors[i] ?? '#ffffff'));
  ini.set('customColors', cc);
  ini.set(
    'drawing',
    new Map([
      ['color', qColorVariant(d.color)],
      ['width', String(d.width)],
    ]),
  );
  ini.set('layersOrder', new Map(d.layerNames.map((n, i) => [String(i + 1), n])));
  ini.set(
    'map',
    new Map([
      ['mapName', d.mapName],
      ['mapPath', d.mapPath],
    ]),
  );
  ini.set(
    'scale',
    new Map([
      ['kmSpinBx', String(d.scale.value)],
      ['mkmUnit', d.scale.unit === 'm' ? '1' : '0'],
      ['pxSpinBx', String(d.scale.px)],
    ]),
  );
  return writeIni(ini);
}

/** Last component of a path written by the desktop version (any OS). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/* ------------------------------------------------------------ layer XML */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[e] ?? m;
  });
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
}

/** Minimal parser for the flat layer files: start tags and their attributes. */
function xmlElements(text: string): XmlElement[] {
  const out: XmlElement[] = [];
  const tag = /<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attr.exec(m[2]))) attrs[a[1]] = xmlUnescape(a[2] ?? a[3] ?? '');
    out.push({ name: m[1], attrs });
  }
  return out;
}

const num = (a: Record<string, string>, k: string) => {
  const v = parseFloat(a[k] ?? '0');
  return Number.isFinite(v) ? v : 0;
};
const P = (a: Record<string, string>, kx: string, ky: string): Pt => pt(num(a, kx), num(a, ky));
const color = (a: Record<string, string>) => {
  const c = (a.color ?? '#000000').trim();
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : /^#[0-9a-f]{8}$/i.test(c) ? '#' + c.slice(3) : '#000000';
};
const width = (a: Record<string, string>) => Math.max(1, Math.round(num(a, 'penWidth')) || 1);

export interface ParsedLayer {
  layer: Layer;
  /** Picture paths referenced by the layer, as written in the file. */
  pixmapPaths: string[];
}

/** Parse a layer XML file. Pixmap items keep the base name of their path as `file`. */
export function parseLayerXml(name: string, text: string): ParsedLayer {
  const layer = emptyLayer(name);
  const pixmapPaths: string[] = [];
  const items: Item[] = [];
  for (const el of xmlElements(text)) {
    const a = el.attrs;
    const count = items.length;
    switch (el.name) {
      case 'GribouillotLayer':
        layer.visible = (a.Visibility ?? 'true') !== 'false';
        layer.opacity = a.Opacity === undefined ? 100 : Math.max(0, Math.min(100, Math.round(num(a, 'Opacity'))));
        break;
      case 'Point':
        items.push({ kind: 'point', id: newId(), p: P(a, 'x', 'y'), color: color(a), width: width(a), weight: Math.round(num(a, 'weight')) });
        break;
      case 'Segment':
        items.push({ kind: 'segment', id: newId(), p1: P(a, 'x0', 'y0'), p2: P(a, 'x1', 'y1'), color: color(a), width: width(a) });
        break;
      case 'Line':
        items.push({ kind: 'line', id: newId(), p1: P(a, 'x0', 'y0'), p2: P(a, 'x1', 'y1'), color: color(a), width: width(a) });
        break;
      case 'Circle':
        items.push({ kind: 'circle', id: newId(), c: P(a, 'x', 'y'), r: num(a, 'radius'), color: color(a), width: width(a) });
        break;
      case 'Arc':
        items.push({
          kind: 'arc', id: newId(), c: P(a, 'x', 'y'), r: num(a, 'radius'),
          start: num(a, 'startAngle'), span: num(a, 'spanAngle'), color: color(a), width: width(a),
        });
        break;
      case 'Ellipse':
        items.push({
          kind: 'ellipse', id: newId(), f1: P(a, 'x1', 'y1'), f2: P(a, 'x2', 'y2'),
          dSum: num(a, 'dSum'), color: color(a), width: width(a),
        });
        break;
      case 'Spiral':
        items.push({
          kind: 'spiral', id: newId(),
          centers: [P(a, 'x0', 'y0'), P(a, 'x1', 'y1'), P(a, 'x2', 'y2'), P(a, 'x3', 'y3')],
          color: color(a), width: width(a),
        });
        break;
      case 'Pixmap': {
        const path = a.imagePath ?? '';
        pixmapPaths.push(path);
        items.push({
          kind: 'pixmap', id: newId(), x: num(a, 'x'), y: num(a, 'y'),
          scale: num(a, 'scale') || 1, rotation: num(a, 'rotation'), file: baseName(path),
        });
        break;
      }
    }
    if (items.length > count) readWebAttrs(items[items.length - 1], a);
  }
  layer.items = items;
  return { layer, pixmapPaths };
}

/**
 * What the web version adds to an item element: its id, and how it was built.
 * The desktop version reads the attributes by name and skips these ones.
 */
function readWebAttrs(it: Item, a: Record<string, string>): void {
  if (a.wid) it.id = a.wid;
  if (a.label && it.kind !== 'pixmap') it.label = a.label;
  if (a.note && it.kind !== 'pixmap') it.note = a.note;
  if (a.place && it.kind !== 'pixmap') it.place = a.place;
  if (a.link && it.kind !== 'pixmap') {
    try {
      const link = JSON.parse(a.link) as Link;
      if (link && typeof link.recipe === 'string' && Array.isArray(link.sources)) it.link = link;
    } catch {
      /* an unreadable link: the item stays as it is drawn */
    }
  }
}

function webAttrs(it: Item): [string, string][] {
  const out: [string, string][] = [['wid', it.id]];
  if (it.kind !== 'pixmap' && it.label) out.push(['label', it.label]);
  if (it.kind !== 'pixmap' && it.note) out.push(['note', it.note]);
  if (it.kind !== 'pixmap' && it.place) out.push(['place', it.place]);
  if (it.kind !== 'pixmap' && it.link) out.push(['link', JSON.stringify(it.link)]);
  return out;
}

const n = (v: number) => String(Number.isInteger(v) ? v : +v.toPrecision(12));

export function writeLayerXml(layer: Layer): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<GribouillotLayer Visibility="${layer.visible}" Opacity="${Math.round(layer.opacity)}">`,
    '    <GraphicsItemList>',
  ];
  for (const it of layer.items) {
    let attrs: [string, string][];
    switch (it.kind) {
      case 'point':
        attrs = [['x', n(it.p.x)], ['y', n(it.p.y)], ['color', it.color], ['penWidth', n(it.width)], ['weight', n(it.weight)]];
        lines.push(el('Point', [...attrs, ...webAttrs(it)]));
        break;
      case 'segment':
      case 'line':
        attrs = [['x0', n(it.p1.x)], ['y0', n(it.p1.y)], ['x1', n(it.p2.x)], ['y1', n(it.p2.y)], ['color', it.color], ['penWidth', n(it.width)]];
        lines.push(el(it.kind === 'line' ? 'Line' : 'Segment', [...attrs, ...webAttrs(it)]));
        break;
      case 'circle':
        attrs = [['x', n(it.c.x)], ['y', n(it.c.y)], ['radius', n(it.r)], ['color', it.color], ['penWidth', n(it.width)]];
        lines.push(el('Circle', [...attrs, ...webAttrs(it)]));
        break;
      case 'arc':
        attrs = [['x', n(it.c.x)], ['y', n(it.c.y)], ['radius', n(it.r)], ['startAngle', n(it.start)], ['spanAngle', n(it.span)], ['color', it.color], ['penWidth', n(it.width)]];
        lines.push(el('Arc', [...attrs, ...webAttrs(it)]));
        break;
      case 'ellipse':
        attrs = [['x1', n(it.f1.x)], ['y1', n(it.f1.y)], ['x2', n(it.f2.x)], ['y2', n(it.f2.y)], ['dSum', n(it.dSum)], ['color', it.color], ['penWidth', n(it.width)]];
        lines.push(el('Ellipse', [...attrs, ...webAttrs(it)]));
        break;
      case 'spiral':
        attrs = it.centers.flatMap((c, i): [string, string][] => [[`x${i}`, n(c.x)], [`y${i}`, n(c.y)]]);
        attrs.push(['color', it.color], ['penWidth', n(it.width)]);
        lines.push(el('Spiral', [...attrs, ...webAttrs(it)]));
        break;
      case 'pixmap':
        attrs = [['x', n(it.x)], ['y', n(it.y)], ['scale', n(it.scale)], ['rotation', n(it.rotation)], ['imagePath', './' + it.file]];
        lines.push(el('Pixmap', [...attrs, ...webAttrs(it)]));
        break;
    }
  }
  lines.push('    </GraphicsItemList>', '</GribouillotLayer>', '');
  return lines.join('\n');
}

function el(name: string, attrs: [string, string][]): string {
  return `        <${name} ${attrs.map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(' ')}/>`;
}
