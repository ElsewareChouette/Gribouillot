/**
 * What the status bar says about the selected items: lengths, angles,
 * distances (port of the desktop sceneSelectionChanged).
 */

import { angleTo, dist, distToLine, seg, type Pt } from './geom';
import type { Item } from './model';
import { arcLength } from './shapes';
import { fmt } from './ui/dom';

/**
 * `len` writes a length in pixels in the unit of the map, `gps` a position
 * in GPS coordinates (null when the map is not calibrated).
 */
export function describeSelection(sel: Item[], len: (px: number) => string, gps: (p: Pt) => string | null = () => null): string {
  if (sel.length === 0) return '';
  const gpsOf = (p: Pt, what = 'GPS') => {
    const g = gps(p);
    return g ? ` — ${what} ${g}` : '';
  };
  if (sel.length === 1) {
    const it = sel[0];
    switch (it.kind) {
      case 'point':
        return `Point (${fmt(it.p.x, 1)} ; ${fmt(it.p.y, 1)})${gpsOf(it.p)}${it.weight ? `, poids ${it.weight}` : ''} — [W] : changer le poids`;
      case 'segment':
        return `Segment de longueur ${len(dist(it.p1, it.p2))}`;
      case 'line':
        return 'Droite infinie';
      case 'circle':
        return `Cercle de rayon ${len(it.r)} — circonférence ${len(2 * Math.PI * it.r)}${gpsOf(it.c, 'centre')}`;
      case 'arc':
        return `Arc de ${fmt(Math.abs(it.span), 1)}° — longueur ${len(arcLength(it))}, rayon ${len(it.r)} — [A] : changer l'angle`;
      case 'ellipse':
        return `Ellipse : somme des distances aux foyers ${len(it.dSum)}, distance entre les foyers ${len(dist(it.f1, it.f2))}`;
      case 'spiral':
        return 'Spirale à 4 centres';
      case 'pixmap':
        return `Image ${it.file} — échelle ${fmt(it.scale, 3)}, rotation ${fmt(((it.rotation % 360) + 360) % 360, 1)}° — [←][→] tourner, [+][−] ou [Maj]+molette : échelle, [0][1][2] : pas`;
    }
  }
  const lines = sel.filter((i) => i.kind === 'segment' || i.kind === 'line');
  const points = sel.filter((i) => i.kind === 'point');
  const circles = sel.filter((i) => i.kind === 'circle');
  if (sel.length === 2 && lines.length === 2) {
    let a = angleTo(seg(lines[0].p1, lines[0].p2), seg(lines[1].p1, lines[1].p2));
    if (a > 180) a = 360 - a;
    if (Math.abs(a) < 1e-9 || Math.abs(a - 180) < 1e-9) return 'Les 2 droites sont strictement parallèles.';
    if (Math.abs(a - 90) < 1e-9) return 'Les 2 droites sont strictement perpendiculaires.';
    return `Angle entre les 2 droites : ${fmt(a, 2)}° / ${fmt(180 - a, 2)}°`;
  }
  if (sel.length === 2 && lines.length === 1 && points.length === 1) {
    return `Distance orthogonale entre le point et la droite : ${len(distToLine(points[0].p, lines[0].p1, lines[0].p2))}`;
  }
  if (sel.length === 2 && points.length === 2) {
    return `Distance entre les 2 points : ${len(dist(points[0].p, points[1].p))}`;
  }
  if (sel.length === 2 && points.length === 1 && circles.length === 1) {
    const d = dist(points[0].p, circles[0].c);
    return `Distance du point au centre du cercle : ${len(d)} ; au cercle : ${len(d - circles[0].r)}`;
  }
  return `${sel.length} éléments sélectionnés`;
}
