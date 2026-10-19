/**
 * Compact the Mérimée database (historical monuments of France, Ministry of
 * Culture, Etalab open licence) into public/data/merimee.json, which the page
 * loads on demand to search the monuments near a point or a line.
 *
 *   node scripts/merimee.mjs [merimee.csv]
 *
 * Without a file, the CSV is downloaded from the Ministry (about 100 MB).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'https://ministere-culture.s3.sbg.io.cloud.ovh.net/POP/merimee.csv';
const OUT = 'public/data/merimee.json';

const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(SOURCE)).text();

/** Rows of a '|' separated file, with "quoted" fields that may hold separators and new lines. */
function* rows(s) {
  let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === '|') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      yield row;
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

const it = rows(text);
const header = it.next().value;
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`column ${name} not found`);
  return i;
};
const REF = col('Reference'), TITLE = col('Titre_editorial_de_la_notice'), TOWN = col('Commune_forme_index');
const DEPT = col('Departement_format_numerique'), COORDS = col('coordonnees_au_format_WGS84');
const KIND = col('Denomination_de_l_edifice'), PROT = col('Date_et_typologie_de_la_protection');

const kinds = new Map();
const kindIndex = (k) => {
  if (!kinds.has(k)) kinds.set(k, kinds.size);
  return kinds.get(k);
};
const monuments = [];
let skipped = 0;
for (const r of it) {
  if (r.length < header.length) continue;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(r[COORDS]);
  const lat = m ? +m[1] : NaN, lon = m ? +m[2] : NaN;
  // Whole degrees are placeholders, not positions.
  if (!m || (Number.isInteger(lat) && Number.isInteger(lon))) {
    skipped++;
    continue;
  }
  const prot = r[PROT];
  const years = (prot.match(/\b(1[789]\d\d|20\d\d)\b/g) ?? []).map(Number);
  const status = /class/i.test(prot) ? 'C' : /inscri/i.test(prot) ? 'I' : '';
  const ks = r[KIND].split(';').map((k) => k.trim().toLowerCase()).filter(Boolean).map(kindIndex);
  monuments.push([r[REF], r[TITLE].trim(), r[TOWN].trim(), r[DEPT].trim(), +lat.toFixed(5), +lon.toFixed(5), ks, years.length ? Math.min(...years) : 0, status]);
}
mkdirSync('public/data', { recursive: true });
const data = {
  source: 'Base Mérimée, ministère de la Culture (licence ouverte Etalab) — ' + SOURCE,
  built: new Date().toISOString().slice(0, 10),
  fields: ['reference', 'title', 'town', 'dept', 'lat', 'lon', 'kinds', 'firstProtection', 'status'],
  kinds: [...kinds.keys()],
  monuments,
};
writeFileSync(OUT, JSON.stringify(data));
console.log(`${OUT}: ${monuments.length} monuments, ${kinds.size} kinds, ${skipped} without a position`);
