/**
 * Build a single self-contained HTML file (dist-single/gribouillot.html):
 * scripts, styles and icons are inlined, so the page works when opened
 * directly from the disk (file://), without any server.
 */
import { build } from 'vite';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-single-tmp';
await build({
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: () => true, // icons as data: URIs
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { codeSplitting: false } },
  },
});

const assets = join(out, 'assets');
const files = readdirSync(assets);
let html = readFileSync(join(out, 'index.html'), 'utf8');
for (const f of files) {
  const code = readFileSync(join(assets, f), 'utf8');
  if (f.endsWith('.js')) {
    const tag = new RegExp(`<script[^>]*src="[^"]*${f}"[^>]*></script>`);
    // A function replacement avoids "$&" patterns of the minified code being interpreted.
    html = html.replace(tag, () => `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`);
  } else if (f.endsWith('.css')) {
    const tag = new RegExp(`<link[^>]*href="[^"]*${f}"[^>]*>`);
    html = html.replace(tag, () => `<style>${code}</style>`);
  }
}
if (/assets\//.test(html)) throw new Error('some assets were not inlined');
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/gribouillot.html', html);
rmSync(out, { recursive: true });
console.log(`dist-single/gribouillot.html (${(html.length / 1024).toFixed(0)} kB)`);
