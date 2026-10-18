import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iniEscape, iniUnescape, parseGrib, parseLayerXml, parseQColorVariant, qColorVariant, writeGrib, writeLayerXml } from '../src/legacy';

const SAMPLE = join(__dirname, '../../formations-gribouillot/mes-solutions');

describe('QSettings values', () => {
  it('decodes the QColor variants written by the desktop version', () => {
    expect(parseQColorVariant(iniUnescape('@Variant(\\0\\0\\0\\x43\\x1\\xff\\xff\\0\\0\\0\\0\\xff\\xff\\0\\0)'))).toBe('#0000ff');
    expect(parseQColorVariant(iniUnescape('@Variant(\\0\\0\\0\\x43\\x1\\xff\\xff\\xff\\xff\\xff\\xff\\xff\\xff\\0\\0)'))).toBe('#ffffff');
  });

  it('writes QColor variants exactly like Qt', () => {
    expect(iniEscape(qColorVariant('#0000ff'))).toBe('@Variant(\\0\\0\\0\\x43\\x1\\xff\\xff\\0\\0\\0\\0\\xff\\xff\\0\\0)');
    for (const c of ['#2c2c2c', '#123abc', '#aa00ff', '#000000']) {
      expect(parseQColorVariant(iniUnescape(iniEscape(qColorVariant(c))))).toBe(c);
    }
  });

  it('round-trips strings with special characters', () => {
    for (const s of ['Lumière', 'a, b; c=d', ' spaces ', 'C:\\Users\\x\\carte.jpg', 'café1', '"quoted"']) {
      expect(iniUnescape(iniEscape(s))).toBe(s);
    }
  });
});

describe('project files', () => {
  it('reads and rewrites a .grib file', () => {
    const text = `[GPS]
gpsEnabled=false

[drawing]
color=@Variant(\\0\\0\\0\\x43\\x1\\xff\\xff\\0\\0\\0\\0\\xff\\xff\\0\\0)
width=7

[layersOrder]
1=Lumiere
10=layer_10
2=layer_5

[map]
mapName=989-zarquos-127m-pixel
mapPath=/home/x/989-zarquos-127m-pixel.jpg

[scale]
kmSpinBx=127
mkmUnit=0
pxSpinBx=1000
`;
    const g = parseGrib(text);
    expect(g.layerNames).toEqual(['Lumiere', 'layer_5', 'layer_10']);
    expect(g.color).toBe('#0000ff');
    expect(g.width).toBe(7);
    expect(g.scale).toEqual({ px: 1000, value: 127, unit: 'km' });
    const again = parseGrib(writeGrib({ ...g, mapPath: '989-zarquos-127m-pixel.jpg' }));
    expect(again).toEqual({ ...g, mapPath: '989-zarquos-127m-pixel.jpg' });
  });

  it('round-trips every item kind through the layer XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GribouillotLayer Visibility="false" Opacity="40">
    <GraphicsItemList>
        <Point x="4736.86" y="3495.22" color="#55007f" penWidth="7" weight="3"/>
        <Segment x0="6305.13" y0="1256.54" x1="4736.86" y1="3495.22" color="#aa00ff" penWidth="3"/>
        <Line x0="-50000" y0="-38187.1" x1="50000" y1="31866.3" color="#aa00ff" penWidth="3"/>
        <Circle x="6305.13" y="1256.54" radius="1456.69" color="#aa00ff" penWidth="3"/>
        <Arc x="10" y="20" radius="30" startAngle="45" spanAngle="-120.5" color="#000000" penWidth="5"/>
        <Ellipse x1="0" y1="0" x2="100" y2="0" dSum="150" color="#ff0000" penWidth="1"/>
        <Spiral x0="0" y0="0" x1="10" y1="0" x2="10" y2="10" x3="0" y3="10" color="#00ff00" penWidth="2"/>
        <Pixmap x="12" y="34" scale="0.5" rotation="-10" imagePath="./photo &amp; plan.png"/>
    </GraphicsItemList>
</GribouillotLayer>`;
    const { layer, pixmapPaths } = parseLayerXml('test', xml);
    expect(layer.visible).toBe(false);
    expect(layer.opacity).toBe(40);
    expect(layer.items.map((i) => i.kind)).toEqual(['point', 'segment', 'line', 'circle', 'arc', 'ellipse', 'spiral', 'pixmap']);
    expect(pixmapPaths).toEqual(['./photo & plan.png']);
    const again = parseLayerXml('test', writeLayerXml(layer)).layer;
    const strip = (l: typeof layer) => l.items.map(({ id: _id, ...rest }) => rest);
    expect(strip(again)).toEqual(strip(layer));
  });

  it.skipIf(!existsSync(SAMPLE))('reads the sample project of the training material', () => {
    const files = readdirSync(SAMPLE);
    const grib = parseGrib(readFileSync(join(SAMPLE, files.find((f) => f.endsWith('.grib'))!), 'utf8'));
    expect(grib.layerNames.length).toBeGreaterThan(0);
    let items = 0;
    for (const name of grib.layerNames) {
      const { layer } = parseLayerXml(name, readFileSync(join(SAMPLE, `${name}.xml`), 'utf8'));
      items += layer.items.length;
    }
    expect(items).toBeGreaterThan(50);
  });
});
