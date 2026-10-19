/**
 * Names of the objects, and what they are made of, in words:
 * « Perpendiculaire à d1 passant par C ».
 *
 * New objects get a short name, as in GeoGebra: points A, B, C…, lines
 * d1, d2…, segments s1…, circles c1…, arcs a1…, ellipses e1…
 */

import { fmt } from './ui/dom';
import { ITEM_LABELS, type Item, type Layer, type Link, type Source, type StrokeItem } from './model';

const PREFIX: Partial<Record<Item['kind'], string>> = { line: 'd', segment: 's', circle: 'c', arc: 'a', ellipse: 'e', spiral: 'sp' };

/** The first free name for a new item of this kind. */
export function freshName(kind: Item['kind'], taken: Set<string>): string {
  if (kind === 'point') {
    for (let n = 0; ; n++) {
      for (let c = 0; c < 26; c++) {
        const name = String.fromCharCode(65 + c) + (n ? String(n) : '');
        if (!taken.has(name)) return name;
      }
    }
  }
  const p = PREFIX[kind] ?? 'o';
  for (let n = 1; ; n++) if (!taken.has(`${p}${n}`)) return `${p}${n}`;
}

export function takenNames(layers: Layer[]): Set<string> {
  const out = new Set<string>();
  for (const l of layers) for (const it of l.items) if (it.kind !== 'pixmap' && it.label) out.add(it.label);
  return out;
}

/** What to call an item in a sentence. */
export function nameOf(it: Item): string {
  if (it.kind === 'pixmap') return `image ${it.file}`;
  if (it.label && it.place) return `${it.label} (${it.place})`;
  return it.label || it.place || `${ITEM_LABELS[it.kind]} sans nom`;
}

type Find = (id: string) => Item | undefined;

/** A source of a construction, in words. */
export function sourceText(s: Source, find: Find): string {
  switch (s.k) {
    case 'pt':
      return 'un point de la carte';
    case 'num':
      return fmt(s.v, 2);
    case 'item':
      return nameOf(find(s.id) ?? s.frozen);
    case 'snap': {
      const [a, b] = s.ids.map((id, i) => nameOf(find(id) ?? s.frozen[i]));
      if (s.kind === 'intersection') return `l'intersection de ${a} et ${b}`;
      if (s.kind === 'midpoint') return `le milieu de ${a}`;
      if (s.kind === 'center') return `le centre de ${a}`;
      return `une extrémité de ${a}`;
    }
  }
}

/**
 * How an item was built, in words, or null if it was not (drawn before the
 * links, imported from the desktop version, detached).
 * `len` writes a length in pixels in the unit of the map.
 */
export function recipeText(link: Link, find: Find, len: (px: number) => string): string | null {
  const t = (i: number) => (link.sources[i] ? sourceText(link.sources[i], find) : '?');
  const num = (i: number) => {
    const s = link.sources[i];
    return s?.k === 'num' ? s.v : NaN;
  };
  /** A typed value as typed. */
  const typed = (i: number) => {
    const s = link.sources[i];
    return s?.k === 'num' ? s.expr ?? `${fmt(s.v, 2)}°` : '?';
  };
  /** A typed length, with its formula when there was one. */
  const length = (i: number) => {
    const s = link.sources[i];
    return s?.k === 'num' && s.expr ? `${s.expr} (= ${len(s.v)})` : len(num(i));
  };
  const center = link.out === -1;
  const what = (() => {
    switch (link.recipe) {
      case '@point':
        return `Point sur ${t(0)}`;
      case 'segment':
        return `Segment de ${t(0)} à ${t(1)}`;
      case 'line':
        return `Droite passant par ${t(0)} et ${t(1)}`;
      case 'horizontal':
        return `Horizontale passant par ${t(0)}`;
      case 'vertical':
        return `Verticale passant par ${t(0)}`;
      case 'parallel':
        return `Parallèle à ${t(0)} passant par ${t(1)}`;
      case 'perpendicular':
        return `Perpendiculaire à ${t(0)} passant par ${t(1)}`;
      case 'bisection':
        return `Médiatrice de ${t(0)}`;
      case 'angleLine':
        return `Droite à ${fmt(num(2), 2)}° de ${t(0)}, passant par ${t(1)}`;
      case 'tangent':
        return `Tangente à ${t(0)} passant par ${t(1)}`;
      case 'circleCenter':
        return `Cercle de centre ${t(0)} passant par ${t(1)}`;
      case 'circleRadius':
        return `Cercle de centre ${t(0)} et de rayon ${length(1)}`;
      case 'circleDiameter':
        return `Cercle de diamètre ${t(0)}–${t(1)}`;
      case 'circle3':
        return `Cercle passant par ${t(0)}, ${t(1)} et ${t(2)}`;
      case 'circleFromRadius':
        return `Cercle de rayon ${t(0)}`;
      case 'circleFromDiameter':
        return `Cercle de diamètre ${t(0)}`;
      case 'ellipse':
        return `Ellipse de foyers ${t(0)} et ${t(1)}, somme des distances ${length(2)}`;
      case 'arc':
        return `Arc de centre ${t(0)} partant de ${t(1)}, de ${fmt(Math.abs(num(2)), 2)}°`;
      case 'halfLine':
        return `Demi-droite d'origine ${t(0)}, passant par ${t(1)}`;
      case 'extension':
        return `Prolongement de ${t(0)} → ${t(1)}, au-delà de ${t(1)}`;
      case 'azimuthRay':
        return `Direction ${typed(1)} depuis ${t(0)}`;
      case 'azimuthLine':
        return `Droite d'azimut ${typed(1)} passant par ${t(0)}`;
      case 'carry':
        return `${link.out === 1 ? 'Point au bout du report' : 'Report'} de ${length(3)} le long de ${t(0)}, depuis ${t(1)}`;
      case 'centroid':
        return `Centre de ${t(0)}, ${t(1)} et ${t(2)}`;
      case 'arcFromCircle':
        return `Arc découpé dans ${t(0)}, de ${fmt(Math.abs(num(2)), 2)}°`;
      default:
        return null;
    }
  })();
  return what && center ? `Centre de : ${what.charAt(0).toLowerCase()}${what.slice(1)}` : what;
}

/** The items built on this one, directly. */
export function usedBy(layers: Layer[], id: string): StrokeItem[] {
  const out: StrokeItem[] = [];
  for (const l of layers) {
    for (const it of l.items) {
      if (it.kind === 'pixmap' || !it.link) continue;
      if (it.link.sources.some((s) => (s.k === 'item' && s.id === id) || (s.k === 'snap' && s.ids.includes(id)))) out.push(it);
    }
  }
  return out;
}

/** The items this one is built on, directly (those still in the project). */
export function builtOn(it: Item, find: Find): Item[] {
  if (it.kind === 'pixmap' || !it.link) return [];
  const ids = it.link.sources.flatMap((s) => (s.k === 'item' ? [s.id] : s.k === 'snap' ? s.ids : []));
  return [...new Set(ids)].map(find).filter((x): x is Item => !!x);
}
