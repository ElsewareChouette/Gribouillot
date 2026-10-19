/**
 * The dialog asking for a length: a number or a formula with its units,
 * read again live on the ground and on the sheet.
 */

import { groundText, paperText, parseAzimuth, parseLength, type Length, type LengthContext } from '../units';
import { openDialog } from './dialogs';
import { h } from './dom';

export async function promptLength(title: string, label: string, initial: string, c: LengthContext, hint?: string): Promise<Length | null> {
  const input = h('input', { type: 'text', value: initial, required: true, autocomplete: 'off', spellcheck: false });
  input.style.width = '100%';
  const read = h('p', { class: 'length-read' });
  const units = c.mPerPx
    ? `Unités : m, km, mesures (${String(c.units.measure).replace('.', ',')} m) sur le terrain ; mm, cm sur la carte ; px. Sans unité : ${c.plain}. Formules : + − × / ( ).`
    : 'L\'échelle de la carte n\'est pas définie : saisissez des pixels. Formules : + − × / ( ).';
  const show = () => {
    const r = parseLength(input.value, c);
    if ('error' in r) {
      input.setCustomValidity(r.error);
      read.textContent = r.error;
      read.classList.add('bad');
      return;
    }
    input.setCustomValidity(r.px > 0 ? '' : 'La longueur doit être positive.');
    read.classList.toggle('bad', r.px <= 0);
    const m = r.px * c.mPerPx;
    read.textContent = c.mPerPx ? `= ${groundText(m)} sur le terrain = ${paperText(m, c.units)} sur la carte = ${Math.round(r.px * 10) / 10} px` : `= ${r.px} px`;
  };
  input.addEventListener('input', show);
  show();
  const body = h('div', { class: 'length-dlg' }, h('label', {}, label, input), read, h('p', { class: 'hint' }, units), hint ? h('p', { class: 'hint' }, hint) : null);
  const ok = await openDialog(title, body, [
    { label: 'Annuler', value: false },
    { label: 'OK', value: true, primary: true },
  ], { onOpen: () => input.select() });
  if (!ok) return null;
  const r = parseLength(input.value, c);
  return 'error' in r || r.px <= 0 ? null : r;
}

/** The dialog asking for a direction: an azimuth, a cardinal point or a bearing. */
export async function promptAzimuth(title: string, label: string, initial: string, north: string): Promise<{ az: number; typed: string } | null> {
  const input = h('input', { type: 'text', value: initial, required: true, autocomplete: 'off', spellcheck: false });
  input.style.width = '100%';
  const read = h('p', { class: 'length-read' });
  const show = () => {
    const r = parseAzimuth(input.value);
    const bad = typeof r !== 'number';
    input.setCustomValidity(bad ? r.error : '');
    read.classList.toggle('bad', bad);
    read.textContent = bad ? r.error : `= ${String(Math.round(r * 100) / 100).replace('.', ',')}° depuis ${north}, dans le sens des aiguilles d'une montre`;
  };
  input.addEventListener('input', show);
  show();
  const body = h('div', { class: 'length-dlg' }, h('label', {}, label, input), read,
    h('p', { class: 'hint' }, `Degrés depuis le nord (0 = nord, 90 = est, 180 = sud), point cardinal (S, NE, sud-ouest, NNO) ou cap (N 30° E). Le nord est ${north} : il se change dans l'onglet Carte.`));
  const ok = await openDialog(title, body, [
    { label: 'Annuler', value: false },
    { label: 'OK', value: true, primary: true },
  ], { onOpen: () => input.select() });
  if (!ok) return null;
  const r = parseAzimuth(input.value);
  return typeof r === 'number' ? { az: r, typed: input.value.trim() } : null;
}
