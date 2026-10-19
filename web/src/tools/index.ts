/**
 * The tools of the toolbar: labels, icons and keyboard shortcuts.
 */

import { RECIPES, type Recipe } from '../constructions';
import type { Tool } from './base';
import { ConstructionTool } from './construction';
import { CalibrateTool, MeasureTool, PanTool, ProtractorTool, SelectTool } from './navigation';
import { PointTool, SpiralTool } from './special';

export { Tool, type ToolEvent } from './base';

export type ToolId =
  | 'select' | 'pan' | 'measure' | 'calibrate' | 'protractor'
  | 'point' | 'spiral'
  | keyof typeof RECIPES;

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string; // file name in resources/icons
  group: 'nav' | 'point' | 'lines' | 'circles' | 'arcs';
  key?: string;
  make: () => Tool;
}

const construction = (r: Recipe) => () => new ConstructionTool(r);

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Sélection', icon: 'cursor-arrow.png', group: 'nav', key: 'J', make: () => new SelectTool() },
  { id: 'pan', label: 'Déplacer la vue', icon: 'cursor-openhand.png', group: 'nav', key: 'H', make: () => new PanTool() },
  { id: 'measure', label: 'Mesurer une distance', icon: 'measure-tape-km.png', group: 'nav', key: 'M', make: () => new MeasureTool() },
  { id: 'protractor', label: 'Rapporteur (mesurer un angle)', icon: 'protractor.png', group: 'nav', make: () => new ProtractorTool() },
  { id: 'point', label: 'Point', icon: 'point.png', group: 'point', key: 'P', make: () => new PointTool() },
  { id: 'segment', label: 'Segment', icon: 'line-segment.png', group: 'lines', key: 'G', make: construction(RECIPES.segment) },
  { id: 'line', label: 'Droite passant par 2 points', icon: 'line.png', group: 'lines', key: 'D', make: construction(RECIPES.line) },
  { id: 'horizontal', label: 'Horizontale', icon: 'line-horizontal.png', group: 'lines', make: construction(RECIPES.horizontal) },
  { id: 'vertical', label: 'Verticale', icon: 'line-vertical.png', group: 'lines', make: construction(RECIPES.vertical) },
  { id: 'parallel', label: 'Parallèle passant par un point', icon: 'line-point-parallel.png', group: 'lines', make: construction(RECIPES.parallel) },
  { id: 'perpendicular', label: 'Perpendiculaire passant par un point', icon: 'line-point-perpendicular.png', group: 'lines', make: construction(RECIPES.perpendicular) },
  { id: 'bisection', label: 'Médiatrice d\'un segment', icon: 'line-bisection.png', group: 'lines', make: construction(RECIPES.bisection) },
  { id: 'angleLine', label: 'Droite faisant un angle avec une autre', icon: 'line-angle.png', group: 'lines', make: construction(RECIPES.angleLine) },
  { id: 'tangent', label: 'Tangentes à un cercle', icon: 'line-tangent-circle.png', group: 'lines', make: construction(RECIPES.tangent) },
  { id: 'circleCenter', label: 'Cercle : centre et point', icon: 'circle-center-point.png', group: 'circles', key: 'O', make: construction(RECIPES.circleCenter) },
  { id: 'circleFromRadius', label: 'Cercle : segment comme rayon', icon: 'circle-segment.png', group: 'circles', make: construction(RECIPES.circleFromRadius) },
  { id: 'circleRadius', label: 'Cercle : centre et rayon donné', icon: 'circle-radius-value.png', group: 'circles', make: construction(RECIPES.circleRadius) },
  { id: 'circleDiameter', label: 'Cercle : 2 points du diamètre', icon: 'circle-2points-diameter.png', group: 'circles', make: construction(RECIPES.circleDiameter) },
  { id: 'circleFromDiameter', label: 'Cercle : segment comme diamètre', icon: 'circle-diameter.png', group: 'circles', make: construction(RECIPES.circleFromDiameter) },
  { id: 'circle3', label: 'Cercle passant par 3 points', icon: 'circle-3points.png', group: 'circles', make: construction(RECIPES.circle3) },
  { id: 'ellipse', label: 'Ellipse : 2 foyers et somme des distances', icon: 'ellipse-foci.png', group: 'circles', make: construction(RECIPES.ellipse) },
  { id: 'arcFromCircle', label: 'Arc découpé dans un cercle', icon: 'arc-2boundaries.png', group: 'arcs', make: construction(RECIPES.arcFromCircle) },
  { id: 'arc', label: 'Arc : centre, départ et angle', icon: 'arc-center-point-angle.png', group: 'arcs', make: construction(RECIPES.arc) },
  { id: 'spiral', label: 'Spirale à 4 centres', icon: 'spiral.png', group: 'arcs', make: () => new SpiralTool() },
];

export const CALIBRATE_DEF: ToolDef = { id: 'calibrate', label: 'Mesurer l\'échelle sur la carte', icon: 'measure-tape-px.png', group: 'nav', make: () => new CalibrateTool() };

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? CALIBRATE_DEF;
}
