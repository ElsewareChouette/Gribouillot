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
export function searchTowns(name: string, limit = 8): Promise<Town[]> {
  return get({ nom: name, boost: 'population', limit: String(limit) });
}

/** The commune at a position, if it is in France. */
export async function townAt(ll: LatLon): Promise<Town | null> {
  return (await get({ lat: String(ll.lat), lon: String(ll.lon) }))[0] ?? null;
}
