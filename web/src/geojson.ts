/**
 * The figures in GPS coordinates (GeoJSON, RFC 7946: longitude first), for
 * QGIS, uMap, geojson.io or a GPS app. Drawn on the sheet, a straight line is
 * slightly curved on the ground: lines and circles are given as many points.
 */

import { groupOf } from './enigmas';
import type { Georef } from './geo';
import { clipSegment, polar, type Pt, type Rect } from './geom';
import type { Group, Item, Layer } from './model';
import { ITEM_LABELS } from './model';
import { nameOf, recipeText } from './names';
import { spiralArcs } from './shapes';

type Position = [number, number];

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: Position } | { type: 'LineString'; coordinates: Position[] };
  properties: Record<string, string | number>;
}

const STEPS = 64;

function samples(a: Pt, b: Pt, n = STEPS): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

function arcPoints(c: Pt, r: number, start: number, span: number): Pt[] {
  const n = Math.max(8, Math.ceil((Math.abs(span) / 360) * 128));
  return Array.from({ length: n + 1 }, (_, i) => polar(c, r, start + (span * i) / n));
}

/** The positions of an item on the sheet, as one or more polylines (a point: one position). */
function shapeOf(it: Item, map: Rect): Pt[][] {
  switch (it.kind) {
    case 'point':
      return [[it.p]];
    case 'segment': {
      const s = clipSegment(it.p1, it.p2, map); // half-lines run far beyond the map
      return s ? [samples(s.p1, s.p2)] : [];
    }
    case 'line': {
      const s = clipSegment(it.p1, it.p2, map);
      return s ? [samples(s.p1, s.p2)] : [];
    }
    case 'circle':
      return [arcPoints(it.c, it.r, 0, 360)];
    case 'arc':
      return [arcPoints(it.c, it.r, it.start, it.span)];
    case 'ellipse': {
      const cx = (it.f1.x + it.f2.x) / 2, cy = (it.f1.y + it.f2.y) / 2;
      const a = it.dSum / 2, c = Math.hypot(it.f2.x - it.f1.x, it.f2.y - it.f1.y) / 2, b = Math.sqrt(Math.max(0, a * a - c * c));
      const th = Math.atan2(it.f2.y - it.f1.y, it.f2.x - it.f1.x);
      return [Array.from({ length: 129 }, (_, i) => {
        const t = (i / 128) * 2 * Math.PI;
        const x = a * Math.cos(t), y = b * Math.sin(t);
        return { x: cx + x * Math.cos(th) - y * Math.sin(th), y: cy + x * Math.sin(th) + y * Math.cos(th) };
      })];
    }
    case 'spiral':
      return spiralArcs(it.centers).filter((a) => a.r > 0).map((a) => arcPoints(a.c, a.r, a.start, a.span));
    case 'pixmap':
      return [];
  }
}

export function toGeoJSON(layers: Layer[], groups: Group[], g: Georef, map: Rect, len: (px: number) => string): object {
  const find = (id: string) => layers.flatMap((l) => l.items).find((i) => i.id === id);
  const features: Feature[] = [];
  const pos = (p: Pt): Position => {
    const ll = g.toLatLon(p);
    return [+ll.lon.toFixed(6), +ll.lat.toFixed(6)];
  };
  for (const layer of layers) {
    const group = groupOf(groups, layer.id);
    for (const it of layer.items) {
      if (it.kind === 'pixmap') continue;
      const properties: Record<string, string | number> = { name: nameOf(it), type: ITEM_LABELS[it.kind], layer: layer.name, color: it.color };
      if (group) properties.enigme = `${group.code} ${group.title}`;
      if (it.note) properties.note = it.note;
      if (it.link) {
        const r = recipeText(it.link, find, len);
        if (r) properties.construction = r;
      }
      if (it.kind === 'point' && it.weight) properties.weight = it.weight;
      for (const line of shapeOf(it, map)) {
        features.push({
          type: 'Feature',
          geometry: it.kind === 'point' ? { type: 'Point', coordinates: pos(line[0]) } : { type: 'LineString', coordinates: line.map(pos) },
          properties,
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
