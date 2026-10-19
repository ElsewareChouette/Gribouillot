/**
 * Historical monuments (base Mérimée, see scripts/merimee.mjs) near a point
 * or along a line, and the links to know more about them.
 */

import { toLambert, type LatLon } from './geo';
import type { Pt } from './geom';

export interface Monument extends LatLon {
  ref: string; // Mérimée reference, e.g. PA00078066
  title: string;
  town: string;
  dept: string;
  kinds: string[]; // « église », « croix de chemin »…
  /** Year of the first protection, 0 if unknown. */
  year: number;
  status: 'C' | 'I' | ''; // classé, inscrit
  /** Position in Lambert-93 meters. */
  xy: Pt;
}

interface File {
  kinds: string[];
  monuments: [string, string, string, string, number, number, number[], number, string][];
}

/** Where the site is published: the page opened from the disk fetches the data there. */
const SITE = 'https://elsewarechouette.github.io/Gribouillot/';

export function dataUrl(): string {
  return location.protocol === 'file:' ? `${SITE}data/merimee.json` : new URL('data/merimee.json', document.baseURI).href;
}

export function readMonuments(file: File): Monument[] {
  return file.monuments.map(([ref, title, town, dept, lat, lon, kinds, year, status]) => ({
    ref, title, town, dept, lat, lon, year,
    kinds: kinds.map((k) => file.kinds[k]),
    status: status === 'C' || status === 'I' ? status : '',
    xy: toLambert({ lat, lon }),
  }));
}

let loading: Promise<Monument[]> | null = null;

/** The monuments, downloaded once (about 1 MB compressed). */
export function loadMonuments(): Promise<Monument[]> {
  loading ??= (async () => {
    let res: Response;
    try {
      res = await fetch(dataUrl());
    } catch {
      throw new Error('Impossible de télécharger la base des monuments : vérifiez la connexion à internet.');
    }
    if (!res.ok) throw new Error(`La base des monuments n'a pas pu être téléchargée (erreur ${res.status}).`);
    return readMonuments((await res.json()) as File);
  })();
  loading.catch(() => (loading = null)); // try again next time
  return loading;
}

export interface Found {
  m: Monument;
  km: number;
}

/** Monuments within `km` of a position, the closest first. */
export function nearPoint(all: Monument[], ll: LatLon, km: number): Found[] {
  const c = toLambert(ll);
  const r = km * 1000;
  const out: Found[] = [];
  for (const m of all) {
    const dx = m.xy.x - c.x, dy = m.xy.y - c.y;
    if (Math.abs(dx) > r || Math.abs(dy) > r) continue;
    const d = Math.hypot(dx, dy);
    if (d <= r) out.push({ m, km: d / 1000 });
  }
  return out.sort((a, b) => a.km - b.km);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

/**
 * Monuments within `km` of a line given by successive positions, sorted
 * along it (`along`: km from its first position).
 */
export function nearLine(all: Monument[], pts: LatLon[], km: number): (Found & { along: number })[] {
  const line = pts.map(toLambert);
  const r = km * 1000;
  const xs = line.map((p) => p.x), ys = line.map((p) => p.y);
  const box = { x0: Math.min(...xs) - r, x1: Math.max(...xs) + r, y0: Math.min(...ys) - r, y1: Math.max(...ys) + r };
  const starts = [0];
  for (let i = 1; i < line.length; i++) starts.push(starts[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const out: (Found & { along: number })[] = [];
  for (const m of all) {
    const p = m.xy;
    if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) continue;
    let best = Infinity, along = 0;
    for (let i = 1; i < line.length; i++) {
      const d = distToSegment(p, line[i - 1], line[i]);
      if (d < best) {
        best = d;
        const a = line[i - 1], b = line[i];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l * l))) : 0;
        along = starts[i - 1] + t * l;
      }
    }
    if (best <= r) out.push({ m, km: best / 1000, along: along / 1000 });
  }
  return out.sort((a, b) => a.along - b.along);
}

/** The natures found among some monuments, the most frequent first. */
export function kindCounts(found: Found[]): [string, number][] {
  const c = new Map<string, number>();
  for (const f of found) for (const k of new Set(f.m.kinds)) c.set(k, (c.get(k) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
}

export const popUrl = (ref: string) => `https://pop.culture.gouv.fr/notice/merimee/${encodeURIComponent(ref)}`;
export const googleUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** What to ask a search engine about a monument: its title and its town. */
export function searchQuery(m: Monument): string {
  return m.title.toLowerCase().includes(m.town.toLowerCase()) ? m.title : `${m.title} ${m.town}`;
}
