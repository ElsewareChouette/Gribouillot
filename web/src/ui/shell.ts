/**
 * The application shell: top bar (menus, undo, command search), tool rail
 * and options bar (toolbox.ts), side panel (panel.ts), minimap, scale bar,
 * start screen and drops.
 */

import type { App } from '../app';
import { fromFileList } from '../io';
import { unitPerPx } from '../model';
import * as store from '../store';
import { FAMILIES, TOOLS } from '../tools';
import { actions, openPalette, type Command } from './commands';
import { alertDialog, confirmDialog, openDialog, popupMenu } from './dialogs';
import { $, fmt, h } from './dom';
import { icon } from './icons';
import { buildPanel, refreshPanel } from './panel';
import { buildRail, refreshOptions, refreshRail } from './toolbox';

const VERSION = '3.0.0-alpha.2';

export function buildShell(app: App): void {
  buildTopbar(app);
  buildRail(app);
  buildPanel(app);
  buildMinimap(app);
  buildScaleBar(app);
  buildStartScreen(app);
  buildDropZone(app);
  const refresh = () => {
    refreshTopbar(app);
    refreshRail(app);
    refreshOptions(app);
    refreshPanel(app);
    document.title = app.project ? `${app.project.name} — Gribouillot` : 'Gribouillot';
  };
  app.onChange = refresh;
  app.onProjectOpen = (open) => {
    document.body.classList.toggle('no-project', !open);
    if (!open) void refreshStartScreen(app);
    refresh();
  };
  // The command palette, from anywhere (even a field of the panel).
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      palette(app);
    }
  }, true);
}

const commands = (app: App): Command[] => actions(app, shortcutsDialog, aboutDialog, () => void projectsDialog(app));

export function palette(app: App): void {
  openPalette(app, commands(app));
}

/* ============================================================= top bar */

let titleBtn: HTMLButtonElement;
let stepper: HTMLElement;
let savedEl: HTMLElement;
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;

async function menu(btn: HTMLElement, cmds: Command[]): Promise<void> {
  const r = btn.getBoundingClientRect();
  const entries: ({ label: string; value: number } | { group: string })[] = [];
  let last = '';
  cmds.forEach((c, i) => {
    if (c.group !== last && last) entries.push({ group: c.group });
    last = c.group;
    const mark = c.checked === undefined ? '' : c.checked ? '✓ ' : '   ';
    entries.push({ label: `${mark}${c.label}${c.key ? `   ${c.key}` : ''}`, value: c.disabled ? -1 : i });
  });
  const chosen = await popupMenu(r.left, r.bottom + 2, entries);
  if (chosen !== null && chosen >= 0) void cmds[chosen].run();
}

function menuButton(app: App, label: string, groups: string[]): HTMLElement {
  const btn = h('button', { type: 'button', class: 'menu-btn' }, label);
  btn.addEventListener('click', () => void menu(btn, commands(app).filter((c) => groups.includes(c.group))));
  return btn;
}

function buildTopbar(app: App): void {
  const bar = $('#topbar');
  titleBtn = h('button', { type: 'button', class: 'project-name', title: 'Renommer le projet', onclick: () => void app.renameProject() });
  savedEl = h('span', { class: 'saved' });
  undoBtn = h('button', { type: 'button', class: 'tool', onclick: () => app.undo() }, h('img', { src: icon('edit-undo.png'), alt: '' }));
  redoBtn = h('button', { type: 'button', class: 'tool', onclick: () => app.redo() }, h('img', { src: icon('edit-redo.png'), alt: '' }));
  bar.append(
    h('div', { class: 'brand' }, 'Gribouillot'),
    h('nav', { id: 'menus' },
      menuButton(app, 'Projet', ['Projet']),
      menuButton(app, 'Édition', ['Édition', 'Construire', 'Calques', 'Carte']),
      menuButton(app, 'Affichage', ['Affichage']),
      menuButton(app, 'Aide', ['Aide'])),
    h('div', { class: 'project-box' }, titleBtn, savedEl),
    (stepper = h('div', { class: 'stepper', role: 'tablist', 'aria-label': 'Énigmes' })),
    h('span', { class: 'spacer' }),
    h('div', { class: 'undo' }, undoBtn, redoBtn),
    h('button', { type: 'button', class: 'search-btn', title: 'Rechercher une commande, un outil, un objet (Ctrl+K)', onclick: () => palette(app) },
      h('span', {}, 'Rechercher…'), h('kbd', {}, 'Ctrl K')),
  );
}

function refreshTopbar(app: App): void {
  const p = app.project;
  const groups = p ? app.groups() : [];
  const rank = app.currentRank();
  stepper.replaceChildren();
  if (groups.length) {
    stepper.append(...groups.map((g, i) => h('button', {
      type: 'button', role: 'tab', class: `step${i === rank ? ' on' : ''}${app.untilRank !== null && i > app.untilRank ? ' later' : ''}`,
      style: `--g:${g.color}`, title: `${i + 1}. ${g.code} — ${g.title}`, 'aria-selected': String(i === rank),
      onclick: () => app.openGroup(g.id),
    }, g.code)),
    h('label', { class: 'opt-toggle state', title: 'N\'afficher que les énigmes jusqu\'à celle en cours : ce que le chercheur avait sous les yeux à cette étape' },
      h('input', { type: 'checkbox', checked: app.untilRank !== null, onchange: () => app.toggleStateView() }), 'état à cette énigme'));
  }
  titleBtn.textContent = p?.name ?? '';
  savedEl.textContent = p ? (app.session.saving ? 'enregistrement…' : 'enregistré') : '';
  savedEl.title = 'Le projet est enregistré dans ce navigateur. Ctrl+S : l\'exporter en .zip.';
  undoBtn.disabled = !app.history.undoLabel;
  redoBtn.disabled = !app.history.redoLabel;
  undoBtn.title = app.history.undoLabel ? `Annuler : ${app.history.undoLabel} (Ctrl+Z)` : 'Annuler (Ctrl+Z)';
  redoBtn.title = app.history.redoLabel ? `Rétablir : ${app.history.redoLabel} (Ctrl+Y)` : 'Rétablir (Ctrl+Y)';
}

/* ============================================================== minimap */

function buildMinimap(app: App): void {
  const mm = $('#minimap') as HTMLCanvasElement;
  const ctx = mm.getContext('2d')!;
  const W = 200;
  const prevHook = app.afterRender;
  const pictureOf = () => (app.project?.mapFile ? app.pictures.get(app.project.mapFile) : undefined);
  const scaleOf = (picW: number) => W / picW;
  app.afterRender = () => {
    prevHook?.();
    const pic = pictureOf();
    const show = !!(app.project && pic && app.options.minimap);
    mm.style.display = show ? 'block' : 'none';
    if (!show || !pic) return;
    const k = scaleOf(pic.w);
    const H = Math.round(pic.h * k);
    const dpr = window.devicePixelRatio || 1;
    if (mm.width !== Math.round(W * dpr) || mm.height !== Math.round(H * dpr)) {
      mm.width = Math.round(W * dpr);
      mm.height = Math.round(H * dpr);
      mm.style.width = `${W}px`;
      mm.style.height = `${H}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mip = pic.pick(k * dpr, app.options.gray && pic.hasGray());
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mip.bitmap, 0, 0, W, H);
    const v = app.cam.visibleRect();
    ctx.strokeStyle = '#e8222a';
    ctx.lineWidth = 2;
    ctx.strokeRect(v.x * k, v.y * k, v.w * k, v.h * k);
  };
  let dragging = false;
  const go = (e: PointerEvent) => {
    const pic = pictureOf();
    if (!pic) return;
    const r = mm.getBoundingClientRect();
    const k = scaleOf(pic.w);
    app.cam.centerOn({ x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k });
    app.requestRender();
  };
  mm.addEventListener('pointerdown', (e) => {
    dragging = true;
    mm.setPointerCapture(e.pointerId);
    go(e);
  });
  mm.addEventListener('pointermove', (e) => dragging && go(e));
  mm.addEventListener('pointerup', () => {
    dragging = false;
    app.changed();
  });
}

/* ============================================================ scale bar */

function buildScaleBar(app: App): void {
  const el = $('#scalebar');
  const bar = h('div', { class: 'bar' });
  const label = h('div', { class: 'label' });
  const zoom = h('button', { type: 'button', class: 'zoom', title: 'Niveau de zoom — cliquer pour ajuster la carte à la fenêtre', onclick: () => app.zoomToFit() });
  el.append(bar, label, zoom);
  const prevHook = app.afterRender;
  app.afterRender = () => {
    prevHook?.();
    const p = app.project;
    el.style.display = p ? '' : 'none';
    if (!p) return;
    zoom.textContent = `${app.cam.zoom >= 1 ? fmt(app.cam.zoom, app.cam.zoom < 10 ? 1 : 0) : fmt(app.cam.zoom * 100, 0) + ' %'}${app.cam.zoom >= 1 ? ' ×' : ''}`;
    const k = unitPerPx(p.scale);
    if (!k) {
      bar.style.display = 'none';
      label.textContent = 'échelle non définie';
      return;
    }
    bar.style.display = '';
    // Nice round length close to 160 screen pixels.
    const perScreenPx = k / app.cam.zoom;
    const target = 160 * perScreenPx;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [5, 2, 1].map((m) => m * pow).find((v) => v <= target) ?? pow;
    let value = nice, unit = p.scale.unit;
    if (unit === 'km' && value < 1) {
      value *= 1000;
      unit = 'm';
    } else if (unit === 'm' && value >= 1000) {
      value /= 1000;
      unit = 'km';
    }
    bar.style.width = `${nice / perScreenPx}px`;
    label.textContent = `${fmt(value, value < 1 ? 2 : 0)} ${unit}`;
  };
}

/* ========================================================= start screen */

function buildStartScreen(app: App): void {
  const el = $('#start');
  el.append(
    h('div', { class: 'start-card' },
      h('h1', {}, h('img', { src: icon('circle-3points.png'), alt: '' }), 'Gribouillot'),
      h('p', { class: 'tagline' }, 'Constructions géométriques sur une carte, par calques. Créé pour la chasse à la Chouette d\'Or.'),
      h('div', { class: 'start-actions' },
        h('button', { type: 'button', class: 'primary big', onclick: () => void app.session.newProject() }, 'Nouveau projet à partir d\'une carte…'),
        h('button', { type: 'button', class: 'big', onclick: () => void app.session.pickProjectFolder() }, 'Ouvrir un projet Gribouillot (dossier)…'),
        h('button', { type: 'button', class: 'big', onclick: () => void app.session.pickProjectFiles() }, 'Ouvrir un .zip ou des fichiers…'),
      ),
      h('p', { class: 'hint' }, 'Vous pouvez aussi glisser-déposer ici une image de carte, un dossier de projet ou un .zip.'),
      h('div', { id: 'recent' }),
      h('p', { class: 'privacy' }, 'Vos cartes et vos tracés restent dans ce navigateur : rien n\'est envoyé sur Internet. Pensez à exporter vos projets (.zip) pour les sauvegarder ou les ouvrir dans Gribouillot pour ordinateur.'),
    ),
  );
}

async function refreshStartScreen(app: App): Promise<void> {
  const el = $('#recent');
  el.replaceChildren();
  let list: store.ProjectSummary[] = [];
  try {
    list = await store.listProjects();
  } catch {
    el.append(h('p', { class: 'hint' }, 'Le stockage du navigateur n\'est pas disponible (navigation privée ?) : les projets ne seront pas conservés.'));
    return;
  }
  if (!list.length) return;
  el.append(h('h2', {}, 'Mes projets'), projectList(app, list, () => void refreshStartScreen(app)));
}

function projectList(app: App, list: store.ProjectSummary[], onDelete: () => void, onOpen?: () => void): HTMLElement {
  return h('ul', { class: 'projects' }, ...list.map((p) =>
    h('li', {},
      h('button', { type: 'button', class: 'open', onclick: () => { onOpen?.(); void app.session.openStored(p.id); } },
        h('strong', {}, p.name),
        h('span', {}, `${p.mapName || 'sans carte'} · ${p.layerCount} calque(s) · ${new Date(p.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`)),
      h('button', {
        type: 'button', class: 'icon-btn', title: 'Supprimer ce projet du navigateur', onclick: async () => {
          if (await confirmDialog('Supprimer le projet', `Supprimer définitivement « ${p.name} » de ce navigateur ? Exportez-le d'abord en .zip si vous voulez le garder.`, 'Supprimer', true)) {
            if (app.project?.id === p.id) await app.session.closeProject();
            await store.deleteProject(p.id);
            onDelete();
          }
        },
      }, h('img', { src: icon('delete-layer.png'), alt: '' })),
    )));
}

async function projectsDialog(app: App): Promise<void> {
  const list = await store.listProjects();
  if (!list.length) {
    await alertDialog('Mes projets', 'Aucun projet enregistré dans ce navigateur.');
    return;
  }
  const holder = h('div', {});
  let close = () => {};
  const render = async () => holder.replaceChildren(projectList(app, await store.listProjects(), () => void render(), () => close()));
  await render();
  const p = openDialog('Mes projets', holder, [{ label: 'Fermer', value: true, primary: true }], { wide: true, onOpen: () => {
    close = () => document.querySelector<HTMLDialogElement>('dialog.dlg[open]')?.close();
  } });
  await p;
}

/* ================================================================ drops */

async function entryFiles(entry: FileSystemEntry, path = ''): Promise<{ path: string; blob: Blob }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ path: path + file.name, blob: file }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const out: { path: string; blob: Blob }[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) out.push(...(await entryFiles(e, `${path}${entry.name}/`)));
  }
  return out;
}

function buildDropZone(app: App): void {
  let depth = 0;
  const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    depth++;
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dropping');
  });
  window.addEventListener('dragover', (e) => {
    if (isFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    const dt = e.dataTransfer!;
    const entries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    let files: { path: string; blob: Blob }[];
    if (entries.length && entries.some((x) => x.isDirectory)) {
      files = (await Promise.all(entries.map((x) => entryFiles(x)))).flat();
    } else files = fromFileList(dt.files);
    if (files.length) await app.session.handleFiles(files);
  });
}

/* =============================================================== dialogs */

function shortcutsDialog(): void {
  const rows: [string, string][] = [
    ['Clic gauche', 'utiliser l\'outil ; glisser : déplacer la vue (ou rectangle de sélection avec l\'outil Sélection)'],
    ['Clic droit', 'menu des outils (et un point marque l\'endroit) ; sur un objet sélectionné : couleur et épaisseur'],
    ['Glisser un point', 'avec l\'outil Sélection : le déplacer, ce qui est construit dessus suit'],
    ['Molette', 'zoomer sur le curseur ; bouton du milieu : déplacer la vue'],
    ['Deux doigts', 'zoomer et déplacer (écran tactile)'],
    ['Échap', 'recommencer la construction en cours / tout désélectionner'],
    ['Ctrl+Z, Ctrl+Y', 'annuler, rétablir'],
    ['Suppr', 'supprimer la sélection (du calque courant)'],
    ['Espace', 'sélectionner l\'élément suivant du calque'],
    ['Ctrl / Maj + clic', 'ajouter ou retirer un élément de la sélection'],
    ['C, T', 'couleur, épaisseur (de la sélection, sinon du dessin)'],
    ['W', 'poids du point sélectionné'],
    ['A', 'angle de l\'arc sélectionné'],
    ['I', 'points d\'intersection des éléments sélectionnés'],
    ['S', 'options de la spirale'],
    ['Entrée', 'spirale : terminer avec 2 ou 3 centres ; arc et droite à angle : saisir l\'angle'],
    ['Maj', 'spirale : côté perpendiculaire au précédent'],
    ['Image sélectionnée', '←/→ tourner de 1° (Maj : 10°), +/− ou Maj+molette : échelle, 0/1/2 : pas grossier/fin/très fin'],
    ['F, +, −', 'ajuster à la fenêtre, zoom avant, zoom arrière'],
    ['Ctrl+S', 'exporter le projet en .zip'],
    ['Ctrl+K', 'rechercher une commande, un outil, un calque ou un objet par son nom'],
    ...FAMILIES.filter((f) => f.key).map((f): [string, string] => [f.key!, `outil ${f.label}`]),
    ...TOOLS.filter((t) => t.key && !FAMILIES.some((f) => f.key === t.key)).map((t): [string, string] => [t.key!, t.label]),
  ];
  void openDialog('Raccourcis clavier', h('table', { class: 'keys' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))), [
    { label: 'Fermer', value: true, primary: true },
  ], { wide: true });
}

function aboutDialog(): void {
  void openDialog('À propos de Gribouillot', h('div', { class: 'about' },
    h('p', {}, h('strong', {}, `Gribouillot ${VERSION} — version web`)),
    h('p', {}, 'Logiciel libre sous licence GPL 3, créé à l\'origine pour aider les chercheurs de la Chouette d\'Or.'),
    h('p', {}, 'Auteur original : ', h('strong', {}, 'Ludovic A.'), ' (versions jusqu\'à 2.0, ', h('a', { href: 'https://github.com/Fr3nchK1ss/Gribouillot', target: '_blank', rel: 'noopener' }, 'Fr3nchK1ss/Gribouillot'), ').'),
    h('p', {}, 'Version maintenue par ', h('strong', {}, 'Elseware'), ', chouetteur, sur ', h('a', { href: 'https://github.com/ElsewareChouette/Gribouillot', target: '_blank', rel: 'noopener' }, 'ElsewareChouette/Gribouillot'), '. Remarques et suggestions bienvenues !'),
    h('p', { class: 'hint' }, 'Les projets s\'échangent avec Gribouillot pour ordinateur : exportez en .zip puis décompressez, ou ouvrez ici le dossier d\'un projet.'),
  ), [{ label: 'Fermer', value: true, primary: true }]);
}
