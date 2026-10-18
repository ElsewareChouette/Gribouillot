/** Modal dialogs built on <dialog>, returning promises. */

import { h } from './dom';

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

const PALETTE = [
  '#000000', '#ffffff', '#ff0000', '#ff8800', '#ffee00', '#00c000', '#00b0ff', '#0000ff',
  '#aa00ff', '#ff00ff', '#8b4513', '#808080', '#55007f', '#006400', '#00ffff', '#ff69b4',
];

/** Color and thickness. Either can be left unchanged (null). */
export async function styleDialog(
  title: string,
  color: string,
  width: number,
  customColors: string[],
  opts: { showColor?: boolean; showWidth?: boolean } = {},
): Promise<{ color: string; width: number } | null> {
  const showColor = opts.showColor ?? true, showWidth = opts.showWidth ?? true;
  const colorInput = h('input', { type: 'color', value: color });
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
  for (const c of [...new Set([...customColors, ...PALETTE])].slice(0, 24)) {
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
