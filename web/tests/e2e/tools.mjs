/**
 * Browser test of the drawing tools, run on the single-file build
 * (dist-single/gribouillot.html, opened from file://).
 *
 * It draws a figure with every construction tool, then compares the
 * resulting geometry with tests/e2e/tools.snapshot.json. Run with
 * `npm run e2e`; `npm run e2e -- --update` rewrites the snapshot.
 *
 * The browser is the Chromium of playwright-core (`npx playwright-core
 * install chromium`), or the executable given by CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(resolve(here, '../../dist-single/gribouillot.html')).href;
const snapshotFile = join(here, 'tools.snapshot.json');
const update = process.argv.includes('--update');

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  for (const d of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = join(cache, d, 'chrome-linux64/chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage({ viewport: { width: 1800, height: 1300 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(page_url);

const A = (f, arg) => page.evaluate(f, arg);
const key = (k) => page.keyboard.press(k);
const status = () => page.locator('#status').innerText();
const fill = async (v) => {
  await page.locator('dialog[open] input').first().fill(String(v));
  await page.locator('dialog[open] button.primary').click();
  await page.waitForTimeout(50); // the item is added once the dialog is closed
};

// A blank 2000 x 1400 map, made by the browser itself.
const png = await A(() => {
  const c = document.createElement('canvas');
  c.width = 2000;
  c.height = 1400;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f1e8';
  x.fillRect(0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
});
const chooser = page.waitForEvent('filechooser');
await page.getByText('Nouveau projet à partir').click();
await (await chooser).setFiles({ name: 'carte.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await fill('Test outils');
await page.waitForFunction(() => window.gribouillot.pictures.size > 0);
// A fixed view, so that screen positions map to known scene positions.
await A(() => {
  const a = window.gribouillot;
  a.setZoom(1);
  a.cam.panX = 0;
  a.cam.panY = 0;
  a.requestRender();
  a.setScale({ px: 1000, value: 127, unit: 'km' });
});

const box = await page.locator('#canvas').boundingBox();
const move = (x, y) => page.mouse.move(box.x + x, box.y + y);
const click = async (x, y) => {
  await move(x, y);
  await page.mouse.click(box.x + x, box.y + y);
};
const tool = (id) => A((id) => window.gribouillot.setTool(id), id);
const items = () => A(() => window.gribouillot.currentLayer.items);
const count = async () => (await items()).length;
const steps = [];
const step = async (name, f) => {
  const n = await count();
  try {
    await f();
    await page.waitForTimeout(50);
  } catch (e) {
    console.error(`step « ${name} » failed (status: ${await status()})`);
    console.error(JSON.stringify((await items()).map((i) => [i.kind, i.p1 ?? i.c ?? i.p, i.p2 ?? i.r])), JSON.stringify(await A(() => [window.gribouillot.cam.zoom, window.gribouillot.cam.panX, window.gribouillot.cam.panY])));
    throw e;
  }
  steps.push({ name, added: (await count()) - n, status: await status() });
};

await page.locator('#canvas').focus();
await step('points', async () => {
  await key('p');
  await click(300, 300);
  await click(500, 320);
  await click(420, 520);
});
await step('segment (snapped)', async () => {
  await key('g');
  await click(300, 300);
  await click(500, 320);
});
await step('line', async () => {
  await key('d');
  await click(100, 700);
  await click(200, 760);
});
await step('horizontal + vertical', async () => {
  await tool('horizontal');
  await click(150, 150);
  await tool('vertical');
  await click(160, 170);
});
await step('circle center', async () => {
  await key('o');
  await click(700, 300);
  await click(760, 330);
});
await step('circle diameter', async () => {
  await tool('circleDiameter');
  await click(800, 600);
  await click(900, 640);
});
await step('circle 3 points', async () => {
  await tool('circle3');
  await click(300, 300);
  await click(500, 320);
  await click(420, 520);
});
await step('circle 3 aligned points (refused)', async () => {
  await tool('circle3');
  await click(1000, 100);
  await click(1050, 100);
  await click(1100, 100);
});
await step('circle radius value', async () => {
  await tool('circleRadius');
  await click(1000, 700);
  await fill('12.7');
});
await step('parallel x2 (reference kept)', async () => {
  await tool('parallel');
  await click(400, 310);
  await click(420, 520);
  await click(700, 650);
});
await step('perpendicular', async () => {
  await tool('perpendicular');
  await click(400, 310);
  await click(420, 520);
});
await step('bisection (same segment twice)', async () => {
  await tool('bisection');
  await click(400, 310);
  await click(400, 310);
});
await step('tangents', async () => {
  await tool('tangent');
  // The circle centered on (700, 300) has a radius of about 67 px.
  await click(767, 300);
  await click(1000, 300);
});
await step('tangents from inside (refused)', async () => {
  await click(705, 305);
  await page.locator('dialog[open] button').first().click();
});
await step('circle from radius', async () => {
  await tool('circleFromRadius');
  await click(400, 310);
  await click(310, 300);
});
await step('circle from diameter', async () => {
  await tool('circleFromDiameter');
  await click(400, 310);
});
await step('arc by mouse', async () => {
  await tool('arc');
  await click(800, 500);
  await click(900, 500);
  await move(850, 420);
  await move(800, 400);
  await click(760, 450);
});
await step('arc by typed angle', async () => {
  await click(1200, 500);
  await click(1260, 500);
  await move(1230, 450);
  await key('Enter');
  await fill('-75');
});
await step('arc full turn becomes a circle', async () => {
  await click(1200, 1000);
  await click(1260, 1000);
  await key('Enter');
  await fill('360');
});
await step('angle line by mouse', async () => {
  await tool('angleLine');
  await click(600, 150); // the horizontal line
  await click(650, 160);
  await move(680, 100);
  await click(700, 60);
});
await step('angle line by typed angle', async () => {
  await click(150, 730); // the line through (100, 700) and (200, 760)
  await click(260, 780);
  await move(300, 700);
  await key('Enter');
  await fill('30');
});
await step('arc from circle', async () => {
  await tool('arcFromCircle');
  await click(767, 300);
  await click(700, 233);
  await move(680, 240);
  await move(633, 300);
  await click(633, 300);
});
await step('ellipse', async () => {
  await tool('ellipse');
  await click(1000, 200);
  await click(1080, 230);
  await fill('25');
});
await step('ellipse too small (refused)', async () => {
  await click(1000, 250);
  await click(1080, 280);
  await fill('1');
  await page.locator('dialog[open] button').first().click();
});
await step('spiral 2 centers', async () => {
  await tool('spiral');
  await click(200, 1000);
  await click(250, 1000);
  await move(250, 950);
  await key('Enter');
});
await step('spiral 3 centers', async () => {
  await click(500, 1000);
  await click(560, 1000);
  await click(560, 950);
  await key('Enter');
});
await step('spiral 4 centers', async () => {
  await click(800, 1000);
  await click(860, 1000);
  await click(860, 940);
  await click(805, 945);
});
await step('preselection: circle through 3 selected points', async () => {
  await key('j');
  await click(300, 300);
  await page.keyboard.down('Shift');
  await click(500, 320);
  await click(420, 520);
  await page.keyboard.up('Shift');
  await tool('circle3');
});
await step('preselection: parallel to the selected segment', async () => {
  await key('j');
  await click(400, 310);
  await tool('parallel');
  await click(1300, 100);
});
await step('draw centers option', async () => {
  await A(() => window.gribouillot.toggleOption('drawCenter'));
  await key('o');
  await click(1300, 300);
  await click(1340, 300);
  await A(() => window.gribouillot.toggleOption('drawCenter'));
});
await step('escape resets the tool', async () => {
  await key('g');
  await click(1300, 600);
  await key('Escape');
  await click(1350, 650);
  await click(1380, 700);
});
await step('undo x2 + redo', async () => {
  await key('Control+z');
  await key('Control+z');
  await key('Control+y');
});

// Layer opacity and visibility are undoable, the slider is one undo step.
const opacity = () => A(() => window.gribouillot.currentLayer.opacity);
const slider = await page.locator('.layer-extra input[type=range]').boundingBox();
await page.mouse.move(slider.x + slider.width - 2, slider.y + slider.height / 2);
await page.mouse.down();
await page.mouse.move(slider.x + slider.width * 0.6, slider.y + slider.height / 2, { steps: 5 });
await page.mouse.move(slider.x + slider.width * 0.3, slider.y + slider.height / 2, { steps: 5 });
await page.mouse.up();
const dragged = await opacity();
await page.locator('#canvas').focus();
await key('Control+z');
const undone = await opacity();
await page.locator('.layers li.current button[title="Masquer le calque"]').click();
await page.locator('#canvas').focus();
await key('Control+z');
const visible = await A(() => window.gribouillot.currentLayer.visible);
if (!(dragged > 20 && dragged < 40) || undone !== 100 || !visible) {
  errors.push(`opacity/visibility: dragged to ${dragged} (expected about 30), after undo ${undone} (expected 100), visible after undo: ${visible}`);
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 + 0 : v);
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'id').sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, clean(x)]));
  }
  return round(v);
};
const result = { steps, items: clean(await items()) };

// Export as a zip of the desktop layout, then reload: the project comes back from IndexedDB.
const download = page.waitForEvent('download');
await key('Control+s');
const zipName = (await download).suggestedFilename();
await page.waitForTimeout(800); // autosave
await page.reload();
await page.waitForFunction(() => window.gribouillot.project && window.gribouillot.pictures.size > 0);
const restored = clean(await items());
if (zipName !== 'Test outils.zip') errors.push(`export: unexpected file name ${zipName}`);
if (JSON.stringify(restored) !== JSON.stringify(result.items)) errors.push('reload: the restored items differ');

// GPS: 4 anchors typed by hand (no network), then the position of a point.
await A(() => {
  const a = window.gribouillot;
  a.setZoom(1);
  a.cam.panX = 0;
  a.cam.panY = 0;
  a.requestRender();
  a.setTool('georef');
});
// About 127 m per pixel around 48.4° N (the minimap covers the bottom right corner).
const anchors = [[700, 900, 'A', '48.5, -1.0'], [1300, 900, 'B', '48.5, 0.03'], [700, 1100, 'C', '48.272, -1.0'], [1200, 1100, 'D', '48.272, -0.14']];
for (const [x, y, name, coords] of anchors) {
  await click(x, y);
  await page.locator('dialog[open] input[type=text]').first().fill(name);
  await page.locator('dialog[open] input[placeholder="45.12345, 1.23456"]').fill(coords);
  await page.locator('dialog[open] button.primary').click();
  await page.waitForTimeout(50);
}
await move(1000, 1000);
const coordsText = await page.locator('#coords').innerText();
const georefStatus = await status();
if (!/^48,3\d+° N, 0,4\d+° O$/.test(coordsText)) errors.push(`gps: coordinates bar shows « ${coordsText} »`);
if (!/4 repères, précision ≈ 0,\d km/.test(georefStatus)) errors.push(`gps: status « ${georefStatus} »`);
await A(() => {
  const a = window.gribouillot;
  a.setTool('select');
  a.setSelection([a.currentLayer.items.find((i) => i.kind === 'point').id]);
});
const panel = await page.locator('.gps-point').innerText().catch(() => '');
if (!panel.includes('Point :') || !panel.includes('°')) errors.push(`gps: no position in the panel (« ${panel} »)`);
await page.waitForTimeout(800); // autosave
await page.reload();
await page.waitForFunction(() => window.gribouillot.project);
const kept = await A(() => window.gribouillot.project.anchors?.map((a) => a.name).join(''));
if (kept !== 'ABCD') errors.push(`gps: anchors after reload: ${kept}`);
await browser.close();

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (update || !existsSync(snapshotFile)) {
  writeFileSync(snapshotFile, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`snapshot written: ${result.items.length} items`);
} else {
  const expected = clean(JSON.parse(readFileSync(snapshotFile, 'utf8')));
  const a = JSON.stringify(expected, null, 1).split('\n'), b = JSON.stringify(clean(result), null, 1).split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 40; i++) if (a[i] !== b[i]) diff.push(`line ${i + 1}:\n  expected ${a[i]}\n  got      ${b[i]}`);
  if (diff.length) {
    console.error(`tools differ from the snapshot:\n${diff.join('\n')}`);
    process.exit(1);
  }
  console.log(`ok: ${steps.length} steps, ${result.items.length} items as in the snapshot`);
}
