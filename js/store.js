// Data store. Today: browser localStorage. Next: Firebase Firestore.
// Pages only talk to this module, so swapping the backend won't touch them.

import { monthLabel, monthOf, uid } from './util.js';

const KEY = 'bizacct.3dprint.v1';
export const COLLECTIONS = ['orders', 'purchases', 'entries'];

export const emptyDb = () => ({
  version: 1,
  settings: { businessName: '3D Printing', currency: 'USD', defaultTaxRate: 0 },
  orders: [],
  purchases: [],
  entries: [],
  closings: {}, // { "2026-10": { endingInventory: cents, closed: bool, closedAt: iso } }
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { ...emptyDb(), ...d, settings: { ...emptyDb().settings, ...d.settings } };
    }
  } catch { /* fall through */ }
  return emptyDb();
}

let db = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    alert('Could not save data in this browser: ' + e.message);
  }
}

function assertOpen(date) {
  const m = monthOf(date);
  if (db.closings[m]?.closed) {
    throw new Error(`${monthLabel(m)} is closed. Reopen it on the Accounting page to change it.`);
  }
}

export const store = {
  get db() { return db; },

  isClosed(month) { return !!db.closings[month]?.closed; },

  upsert(col, rec) {
    const list = db[col];
    const i = rec.id ? list.findIndex((r) => r.id === rec.id) : -1;
    const old = i >= 0 ? list[i] : null;
    if (old && rec.payments && this.isClosed(monthOf(old.date))) {
      // Order booked in a closed month: only allow adding/changing payments dated in open months.
      const strip = ({ payments, updatedAt, ...r }) => JSON.stringify(r);
      if (strip(old) !== strip(rec)) assertOpen(old.date);
      const key = (p) => JSON.stringify([p.date, p.amount, p.method]);
      const before = (old.payments || []).filter((p) => this.isClosed(monthOf(p.date))).map(key).sort();
      const after = rec.payments.filter((p) => this.isClosed(monthOf(p.date))).map(key).sort();
      if (before.join() !== after.join()) throw new Error('Payments dated in a closed month cannot be changed.');
    } else {
      if (old) assertOpen(old.date);
      assertOpen(rec.date);
      for (const p of rec.payments || []) assertOpen(p.date);
    }
    const now = new Date().toISOString();
    const saved = { ...rec, id: rec.id || uid(), updatedAt: now, createdAt: rec.createdAt || now };
    if (i >= 0) list[i] = saved; else list.push(saved);
    persist();
    return saved;
  },

  remove(col, id) {
    const list = db[col];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    assertOpen(list[i].date);
    list.splice(i, 1);
    persist();
  },

  setClosing(month, patch) {
    const cur = db.closings[month] || {};
    if (cur.closed && !('closed' in patch)) throw new Error(`${monthLabel(month)} is closed.`);
    db.closings[month] = { ...cur, ...patch };
    persist();
  },

  setSettings(patch) {
    db.settings = { ...db.settings, ...patch };
    persist();
  },

  replaceAll(next) {
    db = { ...emptyDb(), ...next, settings: { ...emptyDb().settings, ...next.settings } };
    persist();
  },
};
