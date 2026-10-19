/**
 * GPS calibrations of the maps the chouetteurs use, applied when such a map
 * is opened in a project that has none yet. A map is recognized by its exact
 * size in pixels: the anchors are positions on that very picture.
 */

import type { Anchor } from './geo';
import { newId } from './model';

export interface KnownMap {
  name: string;
  w: number;
  h: number;
  /** Name, position on the map (pixels), latitude and longitude of each anchor. */
  anchors: [string, number, number, number, number][];
}

export const KNOWN_MAPS: KnownMap[] = [
  {
    // Calibrated by the user on 2026-10-19 (31 towns): 0.5 km typical error, 0.8 km at worst;
    // 0.6 km on the 42 towns of tests/fixtures/zarquos-989.json.
    name: 'Michelin 989 (scan Zarquos)',
    w: 8460,
    h: 7570,
    anchors: [
      ["Forbach", 7295.37, 1601.84, 49.1865, 6.8954],
      ["Rocamadour", 4263.58, 5463.44, 44.7994, 1.618],
      ["Argelès-sur-Mer", 5138.06, 7410.23, 42.5491, 3.021],
      ["Wimereux", 4309.82, 292.93, 50.7698, 1.6114],
      ["Capbreton", 2337.51, 6403.95, 43.6399, -1.4316],
      ["Jougne", 7112.63, 3709.12, 46.7605, 6.3895],
      ["Saint-Raphaël", 7495.04, 6581.89, 43.4252, 6.7684],
      ["Craon", 2793.90, 2786.02, 47.8488, -0.9498],
      ["Audierne", 722.92, 2504.90, 48.0214, -4.5379],
      ["La Tranche-sur-Mer", 2446.61, 4074.38, 46.3431, -1.4376],
      ["Nemours", 4910.73, 2470.71, 48.2667, 2.6935],
      ["La Mure", 6821.10, 5331.49, 44.9065, 5.7846],
      ["Dieppe", 4004.97, 1027.34, 49.9229, 1.0777],
      ["La Machine", 5370.64, 3655.48, 46.8889, 3.4671],
      ["Barfleur", 2683.39, 1202.24, 49.6691, -1.2663],
      ["Ferrette", 7619.69, 3048.52, 47.492, 7.3193],
      ["Cornus", 5230.40, 6238.28, 43.9032, 3.1789],
      ["Darney", 6855.02, 2576.61, 48.0891, 6.0452],
      ["Buzancy", 6190.72, 1439.09, 49.4267, 4.9551],
      ["Noyon", 5082.13, 1328.10, 49.5802, 3.0005],
      ["Aspet", 3730.87, 6993.54, 43.0151, 0.8033],
      ["Gargilesse-Dampierre", 4260.55, 3983.02, 46.5129, 1.5953],
      ["Hourtin", 2632.82, 5085.29, 45.186, -1.0573],
      ["Forcalquier", 6849.82, 6149.94, 43.96, 5.7806],
      ["Galan", 3485.61, 6809.47, 43.2226, 0.4067],
      ["Brécey", 2705.47, 2021.54, 48.724, -1.1673],
      ["Lamure-sur-Azergues", 5997.25, 4359.97, 46.0635, 4.4922],
      ["Blois", 4117.67, 3050.82, 47.5886, 1.3371],
      ["Volvic", 5127.16, 4537.90, 45.873, 3.0391],
      ["Juzennecourt", 6236.36, 2517.37, 48.1846, 4.9786],
      ["Casteljaloux", 3308.24, 5860.96, 44.3136, 0.0883],
    ],
  },
];

/** The known map of this size, if any. */
export function knownMap(size: { w: number; h: number }): KnownMap | undefined {
  return KNOWN_MAPS.find((m) => m.w === size.w && m.h === size.h);
}

export function knownAnchors(m: KnownMap): Anchor[] {
  return m.anchors.map(([name, x, y, lat, lon]) => ({ id: newId('g'), name, p: { x, y }, lat, lon }));
}
