// Data store. Pages only talk to this module.
//
// - Local mode (no Firebase config): everything lives in this browser's localStorage.
// - Firebase mode: data lives in Firestore under envs/{prod|test}/{collection}/{id}.
//   An in-memory copy (`db`) is kept up to date by live listeners, so pages can
//   read synchronously. Writes update the copy immediately and are sent to
//   Firestore in the background (Firestore also queues them while offline).

import { monthLabel, monthOf, uid } from './util.js';
import { ADMIN_LOGINS, emailToLogin, firebaseConfig, loginToEmail } from './firebase-config.js';
import * as appM from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import * as authM from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import * as fsM from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';

const LOCAL_KEY = 'bizacct.3dprint.v1';
const ENV_KEY = 'bizacct.env';

export const COLLECTIONS = ['orders', 'purchases', 'entries'];
const SYNCED = [...COLLECTIONS, 'closings', 'meta'];

export const emptyDb = () => ({
  version: 1,
  settings: { businessName: '3D Printing', currency: 'USD', defaultTaxRate: 0 },
  orders: [],
  purchases: [],
  entries: [],
  closings: {}, // { "2026-10": { endingInventory: cents, closed: bool, closedAt: iso } }
});

const normalize = (d = {}) => ({
  ...emptyDb(),
  ...d,
  settings: { ...emptyDb().settings, ...(d.settings || {}) },
  closings: { ...(d.closings || {}) },
});

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { alert('Could not save in this browser: ' + e.message); } };

const mode = firebaseConfig ? 'firebase' : 'local';
let db = mode === 'local' ? normalize(JSON.parse(lsGet(LOCAL_KEY) || '{}')) : emptyDb();
let env = 'prod';
let user = null;
let ready = mode === 'local';
let F = null, auth = null, fs = null, unsubs = [];
const listeners = new Set();
const emit = (type, payload) => listeners.forEach((f) => f(type, payload));

const isAdminUser = (u) => !!u && ADMIN_LOGINS.includes(emailToLogin(u.email));

// ---------- Firebase wiring ----------

async function initFirebase() {
  const app = appM.initializeApp(firebaseConfig);
  auth = authM.getAuth(app);
  fs = fsM.initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
  });
  F = { ...fsM, signIn: authM.signInWithEmailAndPassword, signOut: authM.signOut };

  await new Promise((resolve) => {
    let first = true;
    authM.onAuthStateChanged(auth, (u) => {
      user = u;
      stopListening();
      db = emptyDb();
      ready = false;
      if (u) {
        env = isAdminUser(u) && lsGet(ENV_KEY) === 'test' ? 'test' : 'prod';
        listen();
      }
      emit('auth');
      if (first) { first = false; resolve(); }
    });
  });
}

function stopListening() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

function listen() {
  stopListening();
  db = emptyDb();
  ready = false;
  emit('loading');
  const myEnv = env;
  const pending = new Set(SYNCED);
  for (const col of SYNCED) {
    unsubs.push(F.onSnapshot(F.collection(fs, 'envs', myEnv, col), (snap) => {
      if (myEnv !== env) return;
      if (COLLECTIONS.includes(col)) db[col] = snap.docs.map((d) => d.data());
      else if (col === 'closings') db.closings = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      else db.settings = { ...emptyDb().settings, ...(snap.docs.find((d) => d.id === 'settings')?.data() || {}) };
      if (pending.size) {
        pending.delete(col);
        if (!pending.size) { ready = true; emit('ready'); }
      } else {
        emit('change');
      }
    }, (err) => { console.error(err); emit('error', err); }));
  }
}

/** Save one document (data = null deletes it). */
function write(col, id, data) {
  if (mode === 'local') return lsSet(LOCAL_KEY, JSON.stringify(db));
  const ref = F.doc(fs, 'envs', env, col, id);
  (data === null ? F.deleteDoc(ref) : F.setDoc(ref, data)).catch((e) => {
    console.error(e);
    alert('Could not save to the database: ' + e.message);
  });
}

// ---------- Rules shared by both modes ----------

function assertOpen(date) {
  const m = monthOf(date);
  if (db.closings[m]?.closed) {
    throw new Error(`${monthLabel(m)} is closed. Reopen it on the Accounting page to change it.`);
  }
}

export const store = {
  get db() { return db; },
  get mode() { return mode; },
  get env() { return env; },
  get ready() { return ready; },
  get user() { return mode === 'local' ? 'local' : user ? emailToLogin(user.email) : null; },
  get isAdmin() { return mode === 'local' || isAdminUser(user); },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async init() {
    if (mode === 'firebase') await initFirebase();
    else emit('ready');
  },

  async signIn(login, password) {
    await F.signIn(auth, loginToEmail(login), password);
  },

  async signOut() {
    await F.signOut(auth);
    // Don't leave business data cached on a shared computer.
    try { await F.terminate(fs); await F.clearIndexedDbPersistence(fs); } catch (e) { console.warn(e); }
    location.reload();
  },

  setEnv(next) {
    if (mode !== 'firebase' || !this.isAdmin || next === env) return;
    env = next === 'test' ? 'test' : 'prod';
    lsSet(ENV_KEY, env);
    listen();
  },

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
    const saved = JSON.parse(JSON.stringify({ ...rec, id: rec.id || uid(), updatedAt: now, createdAt: rec.createdAt || now }));
    if (i >= 0) list[i] = saved; else list.push(saved);
    write(col, saved.id, saved);
    return saved;
  },

  remove(col, id) {
    const list = db[col];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    assertOpen(list[i].date);
    list.splice(i, 1);
    write(col, id, null);
  },

  setClosing(month, patch) {
    const cur = db.closings[month] || {};
    if (cur.closed && !('closed' in patch)) throw new Error(`${monthLabel(month)} is closed.`);
    db.closings[month] = { ...cur, ...patch };
    write('closings', month, db.closings[month]);
  },

  setSettings(patch) {
    db.settings = { ...db.settings, ...patch };
    write('meta', 'settings', db.settings);
  },

  /** Local mode only: replace everything in this browser. */
  replaceAll(next) {
    if (mode !== 'local') throw new Error('Use the Admin page to replace database data.');
    db = normalize(next);
    lsSet(LOCAL_KEY, JSON.stringify(db));
  },

  // ---------- Admin tools (Firebase mode) ----------

  /** Read a whole environment from the server. */
  async readEnv(source) {
    const out = emptyDb();
    for (const col of SYNCED) {
      const snap = await F.getDocs(F.collection(fs, 'envs', source, col));
      if (COLLECTIONS.includes(col)) out[col] = snap.docs.map((d) => d.data());
      else if (col === 'closings') out.closings = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      else out.settings = { ...out.settings, ...(snap.docs.find((d) => d.id === 'settings')?.data() || {}) };
    }
    return out;
  },

  /** Make environment `target` an exact copy of `data` (deletes everything else in it). */
  async replaceEnv(target, data, onProgress = () => {}) {
    const d = normalize(data);
    const sets = [];
    for (const col of COLLECTIONS) for (const r of d[col]) {
      const id = r.id || uid();
      sets.push([col, id, { ...r, id }]);
    }
    for (const [ym, c] of Object.entries(d.closings)) sets.push(['closings', ym, c]);
    sets.push(['meta', 'settings', d.settings]);
    const keep = new Set(sets.map(([c, id]) => `${c}/${id}`));

    const ops = [];
    for (const col of SYNCED) {
      const snap = await F.getDocs(F.collection(fs, 'envs', target, col));
      for (const docSnap of snap.docs) if (!keep.has(`${col}/${docSnap.id}`)) ops.push(['del', docSnap.ref]);
    }
    for (const [col, id, val] of sets) ops.push(['set', F.doc(fs, 'envs', target, col, id), val]);

    for (let i = 0; i < ops.length; i += 400) {
      const batch = F.writeBatch(fs);
      for (const [t, ref, val] of ops.slice(i, i + 400)) t === 'del' ? batch.delete(ref) : batch.set(ref, val);
      await batch.commit();
      onProgress(Math.min(i + 400, ops.length), ops.length);
    }
    return { written: sets.length, deleted: ops.length - sets.length };
  },

  async resyncTestFromProd(onProgress) {
    const prod = await this.readEnv('prod');
    return this.replaceEnv('test', prod, onProgress);
  },
};
