/**
 * Towns of France, from the public API of the French administration
 * (geo.api.gouv.fr, Etalab open licence). Needs an internet connection; only
 * the searched names and positions are sent.
 */

import type { LatLon } from './geo';

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

/** A line of a list of towns: « Clisson », « Clisson ; 3 », « Saint-Pierre (44) 2 ». */
export interface TownRequest {
  name: string;
  dept?: string;
  weight: number;
}

/** Read a list of towns, one per line, with an optional department and weight. */
export function parseTownList(text: string): TownRequest[] {
  const out: TownRequest[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    let weight = 0;
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
    if (line) out.push({ name: line, dept, weight });
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
