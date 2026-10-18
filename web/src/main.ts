import './style.css';
import { App } from './app';
import { buildShell } from './ui/shell';
import { $ } from './ui/dom';

const app = new App($('#canvas') as HTMLCanvasElement, $('#status'), $('#coords'));
buildShell(app);

window.addEventListener('pagehide', () => void app.saveNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void app.saveNow();
});

app.restore().then((restored) => {
  if (!restored) app.onProjectOpen(false);
}).catch(() => app.onProjectOpen(false));

// For debugging from the console.
(window as unknown as { gribouillot: App }).gribouillot = app;

import { icon } from './ui/icons';
const fav = document.createElement('link');
fav.rel = 'icon';
fav.href = icon('circle-3points.png');
document.head.append(fav);
