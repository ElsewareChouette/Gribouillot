/**
 * The tools of the toolbar: labels, icons and keyboard shortcuts.
 */

import { RECIPES, type Recipe } from '../constructions';
import type { Tool } from './base';
import { ConstructionTool } from './construction';
import { CalibrateTool, GeorefTool, MeasureTool, PanTool, ProtractorTool, SelectTool } from './navigation';
import { PointTool, SpiralTool } from './special';

export { Tool, type ToolEvent } from './base';

export type ToolId =
  | 'select' | 'pan' | 'measure' | 'calibrate' | 'georef' | 'protractor'
  | 'point' | 'spiral'
  | keyof typeof RECIPES;

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string; // file name in resources/icons
  group: 'nav' | 'point' | 'lines' | 'circles' | 'arcs';
  key?: string;
  /** Short name, in the options bar of its family. */
  short?: string;
  make: () => Tool;
}

const construction = (r: Recipe) => () => new ConstructionTool(r);

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Sélection', icon: 'cursor-arrow.png', group: 'nav', key: 'J', make: () => new SelectTool() },
  { id: 'pan', label: 'Déplacer la vue', icon: 'cursor-openhand.png', group: 'nav', key: 'H', make: () => new PanTool() },
  { id: 'measure', short: 'Distance', label: 'Mesurer une distance', icon: 'measure-tape-km.png', group: 'nav', key: 'M', make: () => new MeasureTool() },
  { id: 'protractor', short: 'Angle', label: 'Rapporteur (mesurer un angle)', icon: 'protractor.png', group: 'nav', make: () => new ProtractorTool() },
  { id: 'point', short: 'Clic', label: 'Point', icon: 'point.png', group: 'point', key: 'P', make: () => new PointTool() },
  { id: 'segment', short: 'Segment', label: 'Segment', icon: 'line-segment.png', group: 'lines', key: 'G', make: construction(RECIPES.segment) },
  { id: 'line', short: 'Par 2 points', label: 'Droite passant par 2 points', icon: 'line.png', group: 'lines', key: 'D', make: construction(RECIPES.line) },
  { id: 'horizontal', short: 'Horizontale', label: 'Horizontale', icon: 'line-horizontal.png', group: 'lines', make: construction(RECIPES.horizontal) },
  { id: 'vertical', short: 'Verticale', label: 'Verticale', icon: 'line-vertical.png', group: 'lines', make: construction(RECIPES.vertical) },
  { id: 'parallel', short: 'Parallèle', label: 'Parallèle passant par un point', icon: 'line-point-parallel.png', group: 'lines', make: construction(RECIPES.parallel) },
  { id: 'perpendicular', short: 'Perpendiculaire', label: 'Perpendiculaire passant par un point', icon: 'line-point-perpendicular.png', group: 'lines', make: construction(RECIPES.perpendicular) },
  { id: 'bisection', short: 'Médiatrice', label: 'Médiatrice d\'un segment', icon: 'line-bisection.png', group: 'lines', make: construction(RECIPES.bisection) },
  { id: 'angleLine', short: 'Angle avec une droite', label: 'Droite faisant un angle avec une autre', icon: 'line-angle.png', group: 'lines', make: construction(RECIPES.angleLine) },
  { id: 'tangent', short: 'Tangentes', label: 'Tangentes à un cercle', icon: 'line-tangent-circle.png', group: 'lines', make: construction(RECIPES.tangent) },
  { id: 'halfLine', short: 'Demi-droite', label: 'Demi-droite : origine et direction', icon: 'line-segment.png', group: 'lines', make: construction(RECIPES.halfLine) },
  { id: 'extension', short: 'Prolongement', label: 'Prolongement de A→B au-delà de B', icon: 'line.png', group: 'lines', make: construction(RECIPES.extension) },
  { id: 'azimuthRay', short: 'Direction (azimut)', label: 'Direction depuis un point : azimut ou point cardinal', icon: 'protractor.png', group: 'lines', make: construction(RECIPES.azimuthRay) },
  { id: 'azimuthLine', short: 'Droite d\'azimut', label: 'Droite passant par un point, d\'azimut donné', icon: 'line-angle.png', group: 'lines', make: construction(RECIPES.azimuthLine) },
  { id: 'carry', short: 'Report de distance', label: 'Report d\'une distance le long d\'une droite', icon: 'measure-tape-km.png', group: 'point', make: construction(RECIPES.carry) },
  { id: 'centroid', short: 'Centre de 3 points', label: 'Centre (centre de gravité) de 3 points', icon: 'circle-3points.png', group: 'point', make: construction(RECIPES.centroid) },
  { id: 'circleCenter', short: 'Centre et point', label: 'Cercle : centre et point', icon: 'circle-center-point.png', group: 'circles', key: 'O', make: construction(RECIPES.circleCenter) },
  { id: 'circleFromRadius', short: 'Rayon = segment', label: 'Cercle : segment comme rayon', icon: 'circle-segment.png', group: 'circles', make: construction(RECIPES.circleFromRadius) },
  { id: 'circleRadius', short: 'Centre et rayon', label: 'Cercle : centre et rayon donné', icon: 'circle-radius-value.png', group: 'circles', make: construction(RECIPES.circleRadius) },
  { id: 'circleDiameter', short: 'Diamètre (2 points)', label: 'Cercle : 2 points du diamètre', icon: 'circle-2points-diameter.png', group: 'circles', make: construction(RECIPES.circleDiameter) },
  { id: 'circleFromDiameter', short: 'Diamètre = segment', label: 'Cercle : segment comme diamètre', icon: 'circle-diameter.png', group: 'circles', make: construction(RECIPES.circleFromDiameter) },
  { id: 'circle3', short: '3 points', label: 'Cercle passant par 3 points', icon: 'circle-3points.png', group: 'circles', make: construction(RECIPES.circle3) },
  { id: 'ellipse', short: 'Ellipse', label: 'Ellipse : 2 foyers et somme des distances', icon: 'ellipse-foci.png', group: 'circles', make: construction(RECIPES.ellipse) },
  { id: 'arcFromCircle', short: 'Dans un cercle', label: 'Arc découpé dans un cercle', icon: 'arc-2boundaries.png', group: 'arcs', make: construction(RECIPES.arcFromCircle) },
  { id: 'arc', short: 'Centre, départ, angle', label: 'Arc : centre, départ et angle', icon: 'arc-center-point-angle.png', group: 'arcs', make: construction(RECIPES.arc) },
  { id: 'spiral', short: 'Spirale', label: 'Spirale à 4 centres', icon: 'spiral.png', group: 'arcs', make: () => new SpiralTool() },
];

export const CALIBRATE_DEF: ToolDef = { id: 'calibrate', label: 'Mesurer l\'échelle sur la carte', icon: 'measure-tape-px.png', group: 'nav', make: () => new CalibrateTool() };

export const GEOREF_DEF: ToolDef = { id: 'georef', label: 'Caler la carte (GPS)', icon: 'gps-on.png', group: 'nav', make: () => new GeorefTool() };

/** The tools by family: one button each in the tool rail, the variants in the options bar. */
export interface Family {
  id: string;
  label: string;
  icon: string;
  key?: string;
  tools: ToolId[];
}

export const FAMILIES: Family[] = [
  { id: 'select', label: 'Sélection', icon: 'cursor-arrow.png', key: 'J', tools: ['select'] },
  { id: 'pan', label: 'Vue', icon: 'cursor-openhand.png', key: 'H', tools: ['pan'] },
  { id: 'point', label: 'Point', icon: 'point.png', key: 'P', tools: ['point', 'carry', 'centroid'] },
  { id: 'line', label: 'Droite', icon: 'line.png', key: 'D', tools: ['line', 'segment', 'halfLine', 'extension', 'azimuthRay', 'azimuthLine', 'parallel', 'perpendicular', 'horizontal', 'vertical', 'bisection', 'angleLine', 'tangent'] },
  { id: 'circle', label: 'Cercle', icon: 'circle-center-point.png', key: 'O', tools: ['circleCenter', 'circleRadius', 'circleDiameter', 'circle3', 'circleFromRadius', 'circleFromDiameter', 'ellipse'] },
  { id: 'arc', label: 'Arc', icon: 'arc-center-point-angle.png', tools: ['arc', 'arcFromCircle', 'spiral'] },
  { id: 'measure', label: 'Mesure', icon: 'measure-tape-km.png', key: 'M', tools: ['measure', 'protractor'] },
];

/** The family of a tool (calibrations belong to the map: no family). */
export function familyOf(id: ToolId): Family | undefined {
  return FAMILIES.find((f) => f.tools.includes(id));
}

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? (id === 'georef' ? GEOREF_DEF : CALIBRATE_DEF);
}
