import { store } from './store.js';
import { esc, setCurrency } from './util.js';

const pages = {
  orders: () => import('./pages/orders.js'),
  supplies: () => import('./pages/supplies.js'),
  costs: () => import('./pages/costs.js'),
  accounting: () => import('./pages/accounting.js'),
  admin: () => import('./pages/admin.js'),
  login: () => import('./pages/login.js'),
};

const $ = (id) => document.getElementById(id);
let refreshCurrent = null;
let routeSeq = 0;

function renderHeader(signedIn) {
  const s = store.db.settings;
  $('biz-name').textContent = s.businessName;
  document.querySelector('nav').hidden = !signedIn;
  document.querySelector('nav a[data-page="admin"]').hidden = !store.isAdmin;
  const test = store.mode === 'firebase' && store.env === 'test';
  document.body.classList.toggle('env-test', test);
  $('env-badge').hidden = !(store.mode === 'local' || test);
  $('env-badge').textContent = store.mode === 'local' ? 'LOCAL ONLY' : 'TEST DATA';
  $('who').textContent = store.mode === 'firebase' && store.user ? store.user : '';
  $('signout').hidden = !(store.mode === 'firebase' && store.user);
}

async function route() {
  const seq = ++routeSeq;
  refreshCurrent = null;
  const main = $('main');
  const signedIn = store.mode === 'local' || !!store.user;
  setCurrency(store.db.settings.currency);
  renderHeader(signedIn);

  let key = location.hash.replace(/^#\/?/, '') || 'orders';
  if (!signedIn) key = 'login';
  else if (!store.ready) { main.innerHTML = '<p class="empty">Loading data…</p>'; return; }
  else if (!pages[key] || key === 'login' || (key === 'admin' && !store.isAdmin)) key = 'orders';

  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === key));
  try {
    const mod = await pages[key]();
    if (seq !== routeSeq) return; // a newer navigation started meanwhile
    main.innerHTML = '';
    refreshCurrent = mod.render(main) || null;
  } catch (e) {
    console.error(e);
    main.innerHTML = `<section class="card"><p class="error">Could not load page: ${esc(e.message)}</p></section>`;
  }
}

store.subscribe((type, payload) => {
  if (type === 'change') {
    setCurrency(store.db.settings.currency);
    renderHeader(true);
    refreshCurrent?.();
  } else if (type === 'error') {
    $('main').insertAdjacentHTML('afterbegin', `<section class="card"><p class="error">Database error: ${esc(payload?.message || payload)}</p></section>`);
  } else {
    route(); // auth / loading / ready
  }
});

$('signout').addEventListener('click', () => store.signOut());
window.addEventListener('hashchange', route);

store.init().then(route).catch((e) => {
  console.error(e);
  $('main').innerHTML = `<section class="card"><p class="error">Could not start: ${esc(e.message)}</p></section>`;
});
