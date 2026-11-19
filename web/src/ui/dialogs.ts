/** Modal dialogs built on <dialog>, returning promises. */

import { h } from './dom';
import { DARK_COLORS, isDark } from '../colors';

interface Button<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

/** Open a modal dialog; resolves with the value of the clicked button, or null. */
export function openDialog<T>(title: string, body: Node | string, buttons: Button<T>[], opts: { wide?: boolean; onOpen?: () => void } = {}): Promise<T | null> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' + (opts.wide ? ' wide' : '') });
    const form = h('form', { method: 'dialog' });
    const footer = h('footer');
    let result: T | null = null;
    for (const b of buttons) {
      const btn = h('button', {
        type: b.primary ? 'submit' : 'button',
        class: b.primary ? 'primary' : b.danger ? 'danger' : '',
      }, b.label);
      btn.addEventListener('click', (e) => {
        if (!b.primary) e.preventDefault();
        result = b.value;
        if (!b.primary) dlg.close();
      });
      footer.append(btn);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const primary = buttons.find((b) => b.primary);
      if (primary) result = primary.value;
      if (!form.reportValidity()) return;
      dlg.close();
    });
    form.append(h('h2', {}, title), typeof body === 'string' ? h('p', {}, body) : body, footer);
    dlg.append(form);
    dlg.addEventListener('cancel', () => {
      result = null;
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    opts.onOpen?.();
  });
}

export async function alertDialog(title: string, message: Node | string): Promise<void> {
  await openDialog(title, message, [{ label: 'OK', value: true, primary: true }]);
}

export async function confirmDialog(title: string, message: Node | string, okLabel = 'OK', danger = false): Promise<boolean> {
  const r = await openDialog(title, message, [
    { label: 'Annuler', value: false },
    danger ? { label: okLabel, value: true, danger: true } : { label: okLabel, value: true, primary: true },
  ]);
  return r === true;
}

export async function promptText(title: string, label: string, value = '', hint?: string): Promise<string | null> {
  const input = h('input', { type: 'text', value, required: true });
  const body = h('div', {}, h('label', {}, label, input), hint ? h('p', { class: 'hint' }, hint) : null);
  const ok = await openDialog(title, body, [
    { label: 'Annuler', value: false },
    { label: 'OK', value: true, primary: true },
  ], { onOpen: () => input.select() });
  return ok ? input.value.trim() : null;
}

export async function promptNumber(
  title: string,
  label: string,
  value: number,
  opts: { min?: number; max?: number; step?: number | 'any'; unit?: string; hint?: string; integer?: boolean } = {},
): Promise<number | null> {
  const input = h('input', {
    type: 'number',
    value: String(value),
    min: opts.min,
    max: opts.max,
    step: opts.step ?? (opts.integer ? 1 : 'any'),
    required: true,
  });
  input.style.width = '10em';
  const body = h(
    'div',
    {},
    h('label', {}, label, h('span', { class: 'row' }, input, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null)),
    opts.hint ? h('p', { class: 'hint' }, opts.hint) : null,
  );
  const ok = await openDialog(title, body, [
    { label: 'Annuler', value: false },
    { label: 'OK', value: true, primary: true },
  ], { onOpen: () => input.select() });
  if (!ok) return null;
  const v = parseFloat(input.value.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Color and thickness. Either can be left unchanged (null). */
export async function styleDialog(
  title: string,
  color: string,
  width: number,
  customColors: string[],
  opts: { showColor?: boolean; showWidth?: boolean } = {},
): Promise<{ color: string; width: number } | null> {
  const showColor = opts.showColor ?? true, showWidth = opts.showWidth ?? true;
  const colorInput = h('input', { type: 'color', value: color, title: 'Une autre couleur (les couleurs claires se voient mal sur la carte)' });
  const widthInput = h('input', { type: 'range', min: 1, max: 30, step: 1, value: String(width) });
  const widthValue = h('output', {}, `${width} px`);
  const preview = h('div', { class: 'stroke-preview' });
  const update = () => {
    widthValue.textContent = `${widthInput.value} px`;
    preview.style.borderTop = `${widthInput.value}px solid ${colorInput.value}`;
  };
  widthInput.addEventListener('input', update);
  colorInput.addEventListener('input', update);
  const swatches = h('div', { class: 'swatches' });
  // Dark colors only (those of the project that are, then the usual ones): the field beside takes any other.
  for (const c of [...new Set([...customColors.filter(isDark), ...DARK_COLORS])].slice(0, 24)) {
    swatches.append(h('button', {
      type: 'button',
      class: 'swatch',
      title: c,
      style: `background:${c}`,
      onclick: () => {
        colorInput.value = c;
        update();
      },
    }));
  }
  update();
  const body = h(
    'div',
    { class: 'style-dlg' },
    showColor ? h('label', {}, 'Couleur', h('span', { class: 'row' }, colorInput, swatches)) : null,
    showWidth ? h('label', {}, 'Épaisseur', h('span', { class: 'row' }, widthInput, widthValue)) : null,
    preview,
  );
  const ok = await openDialog(title, body, [
    { label: 'Annuler', value: false },
    { label: 'OK', value: true, primary: true },
  ]);
  if (!ok) return null;
  return { color: colorInput.value.toLowerCase(), width: parseInt(widthInput.value, 10) };
}

/** Little dropdown menu at a screen position. Resolves with the chosen value. */
export function popupMenu<T>(x: number, y: number, entries: ({ label: string; value: T; icon?: string } | { group: string })[]): Promise<T | null> {
  return new Promise((resolve) => {
    const menu = h('div', { class: 'popup-menu', role: 'menu' });
    let done = false;
    const close = (v: T | null) => {
      if (done) return;
      done = true;
      menu.remove();
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', esc, true);
      resolve(v);
    };
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) close(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    for (const e of entries) {
      if ('group' in e) menu.append(h('div', { class: 'group' }, e.group));
      else {
        menu.append(h('button', { type: 'button', role: 'menuitem', onclick: () => close(e.value) },
          e.icon ? h('img', { src: e.icon, alt: '' }) : null, e.label));
      }
    }
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    setTimeout(() => {
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('keydown', esc, true);
    });
  });
}

/** The dark colors, under a button. Resolves with the one chosen, or null. */
export function colorPopup(anchor: HTMLElement, current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = h('div', { class: 'popup-menu color-pop', role: 'menu' });
    let done = false;
    const close = (v: string | null) => {
      if (done) return;
      done = true;
      menu.remove();
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', esc, true);
      resolve(v);
    };
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) close(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(null);
    };
    const other = h('input', { type: 'color', value: current, 'aria-label': 'Autre couleur' });
    other.addEventListener('change', () => close(other.value.toLowerCase()));
    menu.append(
      h('div', { class: 'swatches' }, ...DARK_COLORS.map((c) => h('button', {
        type: 'button', class: `swatch${c === current.toLowerCase() ? ' on' : ''}`, title: c, style: `background:${c}`, onclick: () => close(c),
      }))),
      h('label', { class: 'other-color', title: 'Les couleurs claires se voient mal sur la carte' }, other, 'Autre couleur…'));
    document.body.append(menu);
    const a = anchor.getBoundingClientRect();
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(a.left, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(a.bottom + 2, window.innerHeight - r.height - 4))}px`;
    setTimeout(() => {
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('keydown', esc, true);
    });
  });
}

export interface ScaleAnswer {
  /** Save what was typed, measure the scale on the map, or leave it for later. */
  action: 'save' | 'measure' | 'later';
  paper: number;
  px: number;
  value: number;
  unit: 'km' | 'm';
}

/** Asked when a map is opened without a scale: type it, or go and measure it on the map. */
export async function scaleDialog(mapName: string, paper: number, unit: 'km' | 'm'): Promise<ScaleAnswer> {
  const num = (attrs: Record<string, unknown>) => h('input', { type: 'number', min: 0, step: 'any', ...attrs });
  const paperIn = num({ value: String(paper), title: 'L\'échelle imprimée sur la carte : 1 000 000 pour une carte au 1 : 1 000 000' });
  const pxIn = num({ placeholder: 'pixels' });
  const valueIn = num({ placeholder: 'distance' });
  const unitIn = h('select', {}, h('option', { value: 'km', selected: unit === 'km' }, 'km'), h('option', { value: 'm', selected: unit === 'm' }, 'm'));
  const body = h('div', { class: 'scale-dlg options' },
    h('p', {}, `La carte « ${mapName} » n'a pas d'échelle : sans elle, les distances sont en pixels.`),
    h('label', {}, 'Échelle imprimée sur la carte', h('span', { class: 'row' }, '1 : ', paperIn)),
    h('label', {}, 'Une distance connue, en pixels de l\'image', h('span', { class: 'row' }, pxIn, 'px =', valueIn, unitIn)),
    h('p', { class: 'hint' }, 'Vous ne connaissez pas la distance en pixels ? « Mesurer sur la carte » : vous cliquez les 2 extrémités d\'une distance connue (l\'échelle graphique de la carte, deux villes), puis vous donnez sa longueur.'),
    h('p', { class: 'hint' }, 'Tout se retrouve et se corrige dans l\'onglet « Carte », avec le calage GPS (placer quelques villes) qui donne la position des points.'));
  const read = (el: HTMLInputElement) => parseFloat(el.value.replace(',', '.')) || 0;
  let action = await openDialog<ScaleAnswer['action']>('Échelle de la carte', body, [
    { label: 'Plus tard', value: 'later' },
    { label: 'Mesurer sur la carte', value: 'measure' },
    { label: 'Enregistrer', value: 'save', primary: true },
  ]) ?? 'later';
  // « Enregistrer » without a distance: the map is to be measured.
  if (action === 'save' && !(read(pxIn) > 0 && read(valueIn) > 0)) action = 'measure';
  return { action, paper: read(paperIn) || paper, px: read(pxIn), value: read(valueIn), unit: unitIn.value as 'km' | 'm' };
}
