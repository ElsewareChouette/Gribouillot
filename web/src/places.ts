/**
 * Towns of France, from the public API of the French administration
 * (geo.api.gouv.fr, Etalab open licence). Needs an internet connection; only
 * the searched names and positions are sent.
 */

import { fromLambert, kmBetween, toLambert, type LatLon } from './geo';

export interface Town extends LatLon {
  name: string;
  code: string; // INSEE code
  dept: string; // department code and name
  population?: number;
}

const API = 'https://geo.api.gouv.fr/communes';

interface ApiTown {
  nom: string;
  code: string;
  mairie?: { coordinates: [number, number] };
  centre?: { coordinates: [number, number] };
  departement?: { code: string; nom: string };
  population?: number;
}

function town(t: ApiTown): Town | null {
  // The town hall is where the name is printed on a map; the center of the
  // commune's area can be kilometers away from it.
  const c = t.mairie?.coordinates ?? t.centre?.coordinates;
  if (!c) return null;
  return {
    name: t.nom,
    code: t.code,
    dept: t.departement ? `${t.departement.code} ${t.departement.nom}` : '',
    population: t.population,
    lon: c[0],
    lat: c[1],
  };
}

async function get(params: Record<string, string>): Promise<Town[]> {
  const q = new URLSearchParams({ ...params, fields: 'nom,code,mairie,centre,departement,population', format: 'json' });
  let res: Response;
  try {
    res = await fetch(`${API}?${q}`);
  } catch {
    throw new Error('Pas de connexion à geo.api.gouv.fr : la recherche de communes demande internet.');
  }
  if (!res.ok) throw new Error(`geo.api.gouv.fr a répondu ${res.status}.`);
  return ((await res.json()) as ApiTown[]).map(town).filter((t): t is Town => t !== null);
}

/** Communes whose name looks like the query, the most populated first. */
export function searchTowns(name: string, limit = 8, dept?: string): Promise<Town[]> {
  return get({ nom: name, boost: 'population', limit: String(limit), ...(dept ? { codeDepartement: dept } : {}) });
}

/* ===================================================== lists of towns */

/** A line of a list of towns: « Clisson », « Clisson ; 3 », « Saint-Pierre (44) 2 », « A = Angers ; 0 ». */
export interface TownRequest {
  name: string;
  dept?: string;
  /** The weight typed, if any. */
  weight?: number;
  /** The name written on the map (« A »), when given before « = » or « : ». */
  label?: string;
}

/** Read a list of towns, one per line, with an optional department and weight. */
export function parseTownList(text: string): TownRequest[] {
  const out: TownRequest[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    let label: string | undefined;
    const named = /^([^=:]{1,12}?)\s*[=:]\s*(.+)$/.exec(line);
    if (named) {
      label = named[1].trim();
      line = named[2].trim();
    }
    let weight: number | undefined;
    // The weight: the last number, after a separator or a space.
    const w = /(?:^|[\s;,\t])(-?\d+)\s*$/.exec(line);
    if (w && line.slice(0, w.index).trim()) {
      weight = parseInt(w[1], 10);
      line = line.slice(0, w.index);
    }
    line = line.replace(/[\s;,\t]+$/, '');
    let dept: string | undefined;
    const d = /\(\s*(\d[\dAB]?\d?)\s*\)/i.exec(line);
    if (d) {
      dept = d[1].toUpperCase().padStart(2, '0');
      line = (line.slice(0, d.index) + line.slice(d.index + d[0].length)).trim();
    }
    if (line) out.push({ name: line, dept, ...(weight !== undefined ? { weight } : {}), ...(label ? { label } : {}) });
  }
  return out;
}

/** A name in a comparable form: no case, accents, hyphens; « St » is « Saint ». */
export function townKey(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-'’\s]+/g, ' ')
    .replace(/\bste\b/g, 'sainte').replace(/\bst\b/g, 'saint')
    .trim();
}

export interface TownMatch {
  request: TownRequest;
  /** Communes of exactly this name (the most populated first), or the closest names when none. */
  candidates: Town[];
  exact: boolean;
}

/** Find the communes of each requested name (a few requests at a time). */
export async function matchTowns(reqs: TownRequest[], onProgress?: (done: number) => void): Promise<TownMatch[]> {
  const out: TownMatch[] = new Array(reqs.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < reqs.length) {
      const i = next++;
      const r = reqs[i];
      const found = await searchTowns(r.name, 20, r.dept);
      const key = townKey(r.name);
      const exact = found.filter((t) => townKey(t.name) === key);
      out[i] = { request: r, candidates: exact.length ? exact : found.slice(0, 5), exact: exact.length > 0 };
      onProgress?.(++done);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

/** The commune at a position, if it is in France. */
export async function townAt(ll: LatLon): Promise<Town | null> {
  return (await get({ lat: String(ll.lat), lon: String(ll.lon) }))[0] ?? null;
}

/* ============================================ places of the IGN map */

export interface Place extends LatLon {
  id: string;
  name: string;
  category: string; // « lieu-dit habité », « pont », « culte chrétien »…
  town: string;
  km: number;
}

const IGN = 'https://data.geopf.fr/geocodage/reverse';
/** The IGN service searches 500 m around a position at most: a larger disc is covered by several searches. */
const IGN_RADIUS = 500;
export const PLACES_MAX_KM = 2;

interface IgnFeature {
  geometry: { coordinates: [number, number] };
  properties: { toponym?: string; name?: string[]; category?: string[]; city?: string[]; extrafields?: { cleabs?: string } };
}

/** Named places of the IGN (lieux-dits, bridges, churches, cemeteries…) within `km` (2 at most). */
export async function placesNear(ll: LatLon, km: number, onProgress?: (done: number, total: number) => void): Promise<Place[]> {
  const r = Math.min(km, PLACES_MAX_KM) * 1000;
  const c = toLambert(ll);
  const step = IGN_RADIUS * Math.SQRT2; // the circles of a square grid cover it
  const centers: LatLon[] = [];
  const n = Math.ceil(r / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (Math.hypot(i * step, j * step) <= r + step) centers.push(fromLambert({ x: c.x + i * step, y: c.y + j * step }));
    }
  }
  const found = new Map<string, Place>();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < centers.length) {
      const at = centers[next++];
      const q = new URLSearchParams({ index: 'poi', limit: '50', searchgeom: JSON.stringify({ type: 'Circle', coordinates: [at.lon, at.lat], radius: IGN_RADIUS }) });
      let res: Response;
      try {
        res = await fetch(`${IGN}?${q}`);
      } catch {
        throw new Error('Pas de connexion au service de l\'IGN (data.geopf.fr).');
      }
      if (!res.ok) throw new Error(`Le service de l'IGN a répondu ${res.status}.`);
      for (const f of ((await res.json()) as { features: IgnFeature[] }).features) {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const name = p.toponym ?? p.name?.[0] ?? '';
        const category = p.category?.[0] ?? '';
        if (!name || category === 'administratif') continue;
        const id = p.extrafields?.cleabs ?? `${name}@${lat},${lon}`;
        const d = kmBetween(ll, { lat, lon });
        if (d * 1000 <= r) found.set(id, { id, name, category, town: p.city?.[0] ?? '', lat, lon, km: d });
      }
      onProgress?.(++done, centers.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return [...found.values()].sort((a, b) => a.km - b.km);
}

/* ================================================================ links */

export const geoportailUrl = (ll: LatLon) =>
  `https://www.geoportail.gouv.fr/carte?c=${ll.lon.toFixed(5)},${ll.lat.toFixed(5)}&z=15&l0=GEOGRAPHICALGRIDSYSTEMS.MAPS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;

export const osmUrl = (ll: LatLon) =>
  `https://www.openstreetmap.org/?mlat=${ll.lat.toFixed(5)}&mlon=${ll.lon.toFixed(5)}#map=15/${ll.lat.toFixed(5)}/${ll.lon.toFixed(5)}`;
