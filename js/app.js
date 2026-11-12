import { store } from './store.js';
import { setCurrency } from './util.js';

const pages = {
  orders: () => import('./pages/orders.js'),
  supplies: () => import('./pages/supplies.js'),
  costs: () => import('./pages/costs.js'),
  accounting: () => import('./pages/accounting.js'),
};

async function route() {
  const name = location.hash.replace(/^#\/?/, '') || 'orders';
  const key = pages[name] ? name : 'orders';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === key));
  setCurrency(store.db.settings.currency);
  document.getElementById('biz-name').textContent = store.db.settings.businessName;
  const main = document.getElementById('main');
  try {
    const mod = await pages[key]();
    main.innerHTML = '';
    mod.render(main);
  } catch (e) {
    main.innerHTML = `<section class="card"><p class="error">Could not load page: ${e.message}</p></section>`;
    console.error(e);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
