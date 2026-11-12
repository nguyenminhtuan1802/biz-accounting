// Small shared helpers. All money is stored as integer cents.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let currency = 'USD';
export function setCurrency(c) { currency = c || 'USD'; }

export function fmt(cents) {
  const n = (cents || 0) / 100;
  try {
    return n.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return n.toFixed(2);
  }
}

/** Parse "1,234.50" / "$12" / "-3.2" into integer cents. Empty/invalid -> 0. */
export function toCents(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const centsToInput = (c) => (c ? (c / 100).toFixed(2) : '');

export function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export const monthOf = (date) => String(date || '').slice(0, 7);

/** "2026-02" -> "2026-02-28" */
export function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function flash(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
  clearTimeout(el._t);
  if (!isError) el._t = setTimeout(() => { el.textContent = ''; }, 4000); // errors stay until the next action
}
