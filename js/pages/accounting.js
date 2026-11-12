import { store } from '../store.js';
import { makeSample } from '../sample.js';
import { centsToInput, download, esc, flash, fmt, monthEnd, monthLabel, monthOf, today, toCents } from '../util.js';
import { accountName, balanceSheet, balances, buildJournal, profitAndLoss, receivablesAsOf, trialBalance } from '../ledger.js';

export function render(root) {
  let month = monthOf(today());

  root.innerHTML = `
    <section class="card">
      <div class="list-head">
        <h2>Monthly accounting</h2>
        <label class="inline">Month <input type="month" id="month"></label>
      </div>
      <div id="body"></div>
    </section>

    <section class="card">
      <h2>Backup &amp; data</h2>
      <p class="hint">${store.mode === 'local'
        ? 'Data is saved only in this browser (local mode). Download a backup regularly.'
        : 'Data is saved in the cloud database. A monthly backup file is still a good habit.'}</p>
      <div class="actions wrap">
        <button class="ghost" id="export">Download backup (.json)</button>
        <button class="ghost" id="export-csv">Download journal (.csv)</button>
        ${store.mode === 'local' ? `
        <label class="ghost button">Restore from backup<input type="file" id="import" accept="application/json" hidden></label>
        <button class="ghost" id="sample">Load sample data</button>
        <button class="ghost danger" id="wipe">Erase all data</button>` : ''}
        <span class="msg" id="dmsg"></span>
      </div>
    </section>`;

  const monthInput = root.querySelector('#month');
  monthInput.value = month;
  const body = root.querySelector('#body');

  function draw() {
    const db = store.db;
    let J;
    try { J = buildJournal(db); }
    catch (e) { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }

    const start = `${month}-01`;
    const end = monthEnd(month);
    const ytdStart = `${month.slice(0, 4)}-01-01`;
    const closing = db.closings[month] || {};
    const closed = !!closing.closed;

    const pl = profitAndLoss(J, start, end);
    const ytd = profitAndLoss(J, ytdStart, end);
    const bs = balanceSheet(J, end);
    const tb = trialBalance(J);

    // Materials inventory roll-forward for this month (excluding this month's own adjustment).
    const noAdj = J.filter((e) => !(e.source === 'adjust' && e.id === `inv-${month}`));
    const invStart = balances(noAdj, null, shiftDay(start, -1)).get('1200') || 0;
    const invBought = noAdj.filter((e) => e.date >= start && e.date <= end && e.source === 'purchase')
      .reduce((s, e) => s + e.lines.filter((l) => l.acct === '1200').reduce((t, l) => t + l.dr - l.cr, 0), 0);
    const hasCount = Number.isInteger(closing.endingInventory);
    const used = hasCount ? invStart + invBought - closing.endingInventory : null;

    const ar = receivablesAsOf(db, end).filter((r) => r.owed > 0);
    const bm = balances(J, null, end);
    const taxOwed = -(bm.get('2100') || 0);
    const apOwed = -(bm.get('2000') || 0);
    const cardOwed = -(bm.get('2050') || 0);
    const taxCollected = -J.filter((e) => e.date >= start && e.date <= end && e.source === 'order')
      .reduce((s, e) => s + e.lines.filter((l) => l.acct === '2100').reduce((t, l) => t + l.dr - l.cr, 0), 0);

    const check = (ok, text) => `<li class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} ${text}</li>`;
    const monthJ = J.filter((e) => e.date >= start && e.date <= end);

    body.innerHTML = `
      <p class="sub">${monthLabel(month)} · ${closed ? '<span class="badge">closed</span>' : '<span class="badge open">open</span>'}</p>

      <div class="cols">
        <div class="panel">
          <h3>Month-end checklist</h3>
          <ul class="checks">
            ${check(tb.balanced && bs.balanced, tb.balanced && bs.balanced ? 'Books balance (debits = credits, assets = liabilities + equity)' : 'Books do NOT balance, please report this')}
            ${check(hasCount || (invStart + invBought) === 0, hasCount ? 'Materials inventory counted' : 'Enter the materials inventory count below')}
            ${check((bm.get('1000') || 0) >= 0 && (bm.get('1010') || 0) >= 0, (bm.get('1000') || 0) < 0 || (bm.get('1010') || 0) < 0 ? 'Cash or bank is negative: a payment is probably missing or recorded with the wrong method' : 'Cash and bank balances are not negative')}
            ${check(ar.length === 0, ar.length ? `${ar.length} customer order(s) still owe money (${fmt(ar.reduce((s, r) => s + r.owed, 0))})` : 'No unpaid customer orders')}
            ${check(apOwed === 0, apOwed ? `Unpaid vendor bills: ${fmt(apOwed)}` : 'No unpaid vendor bills')}
            ${check(taxOwed <= 0, taxOwed > 0 ? `Sales tax collected, not yet paid to government: ${fmt(taxOwed)}` : 'No sales tax owed')}
            ${check(closed, closed ? 'Month is closed (locked)' : 'Close the month when everything above is done')}
          </ul>
        </div>

        <div class="panel">
          <h3>Materials inventory (filament, resin)</h3>
          <table class="report">
            <tr><td>On hand at start of month</td><td class="num">${fmt(invStart)}</td></tr>
            <tr><td>+ Bought this month</td><td class="num">${fmt(invBought)}</td></tr>
            <tr><td>− Left on shelf at month end (count)</td><td class="num">
              <input id="inv" class="num" inputmode="decimal" value="${hasCount ? centsToInput(closing.endingInventory) || '0.00' : ''}" placeholder="value $" ${closed ? 'disabled' : ''}>
            </td></tr>
            <tr class="total"><td>= Materials used (cost of goods)</td><td class="num">${used == null ? '—' : fmt(used)}</td></tr>
          </table>
          <p class="hint">At month end, estimate the value of filament/resin left (e.g. 4.5 rolls × $18). Partial rolls count too.</p>
          <div class="actions">
            <button class="primary" id="save-inv" ${closed ? 'disabled' : ''}>Save count</button>
            ${closed ? '<button class="ghost" id="reopen">Reopen month</button>' : '<button class="ghost" id="close">Close month</button>'}
            <span class="msg" id="imsg"></span>
          </div>
        </div>
      </div>

      <h3>Profit &amp; loss</h3>
      ${plTable(pl, ytd, month)}

      <div class="cols">
        <div class="panel">
          <h3>Balance sheet at ${esc(end)}</h3>
          <table class="report">
            <tr class="head"><td colspan="2">Assets (what the business has)</td></tr>
            ${bs.assets.map((r) => row(r.name, r.amount)).join('') || row('—', 0)}
            <tr class="total"><td>Total assets</td><td class="num">${fmt(bs.totalAssets)}</td></tr>
            <tr class="head"><td colspan="2">Liabilities (what it owes)</td></tr>
            ${bs.liabilities.map((r) => row(r.name, r.amount)).join('') || row('None', 0)}
            <tr class="total"><td>Total liabilities</td><td class="num">${fmt(bs.totalLiabilities)}</td></tr>
            <tr class="head"><td colspan="2">Owner's equity</td></tr>
            ${bs.equity.map((r) => row(r.name, r.amount)).join('')}
            ${row('Profit kept in business (all time)', bs.retained)}
            <tr class="total"><td>Total equity</td><td class="num">${fmt(bs.totalEquity)}</td></tr>
            <tr class="grand"><td>Liabilities + equity</td><td class="num">${fmt(bs.totalLiabilities + bs.totalEquity)}</td></tr>
          </table>
        </div>

        <div class="panel">
          <h3>Who owes money</h3>
          ${ar.length ? `<table class="report">${ar.map((r) => row(`${esc(r.order.customer)} <small>${esc(r.order.ref || '')} · ${esc(r.order.date)}</small>`, r.owed, true)).join('')}
            <tr class="total"><td>Customers owe</td><td class="num">${fmt(ar.reduce((s, r) => s + r.owed, 0))}</td></tr></table>` : '<p class="empty">Nobody owes you money.</p>'}
          <table class="report">
            <tr class="head"><td colspan="2">What the business owes</td></tr>
            ${row('Sales tax collected this month', taxCollected)}
            ${row('Sales tax owed (total)', taxOwed)}
            ${row('Unpaid vendor bills', apOwed)}
            ${row('Credit card balance', cardOwed)}
          </table>
          <table class="report">
            <tr class="head"><td colspan="2">Money at ${esc(end)}</td></tr>
            ${row('Cash on hand', bm.get('1000') || 0)}
            ${row('Bank account', bm.get('1010') || 0)}
          </table>
        </div>
      </div>

      <details>
        <summary>Journal for ${monthLabel(month)} (${monthJ.length} entries): every debit and credit</summary>
        <div class="table-wrap"><table class="list journal">
          <thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>${monthJ.map((e) => e.lines.map((l, i) => `<tr class="${i === 0 ? 'first' : ''}">
            <td>${i === 0 ? esc(e.date) : ''}</td><td>${i === 0 ? esc(e.source) : ''}</td><td>${i === 0 ? esc(`${e.ref} – ${e.memo}`) : ''}</td>
            <td>${esc(l.acct)} ${esc(accountName(l.acct))}</td>
            <td class="num">${l.dr ? fmt(l.dr) : ''}</td><td class="num">${l.cr ? fmt(l.cr) : ''}</td></tr>`).join('')).join('')}</tbody>
        </table></div>
      </details>`;

    const imsg = body.querySelector('#imsg');
    body.querySelector('#save-inv')?.addEventListener('click', () => {
      const raw = body.querySelector('#inv').value.trim();
      try {
        store.setClosing(month, { endingInventory: raw === '' ? null : toCents(raw) });
        draw();
        flash(body.querySelector('#imsg'), 'Saved ✓');
      } catch (e) { flash(imsg, e.message, true); }
    });
    body.querySelector('#close')?.addEventListener('click', () => {
      if (!hasCount && invStart + invBought !== 0 && !confirm('No inventory count entered: materials used will show as $0. Close anyway?')) return;
      if (!confirm(`Close ${monthLabel(month)}? Orders, purchases and costs dated in this month will be locked.`)) return;
      store.setClosing(month, { closed: true, closedAt: new Date().toISOString() });
      draw();
    });
    body.querySelector('#reopen')?.addEventListener('click', () => {
      if (!confirm(`Reopen ${monthLabel(month)} for changes? Any reports you already used for taxes may change.`)) return;
      store.setClosing(month, { closed: false });
      draw();
    });
  }

  monthInput.addEventListener('change', () => { month = monthInput.value || monthOf(today()); draw(); });

  const dmsg = root.querySelector('#dmsg');
  root.querySelector('#export').addEventListener('click', () => {
    download(`biz-accounting-backup-${today()}.json`, JSON.stringify(store.db, null, 2));
  });
  root.querySelector('#import')?.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.orders) || !Array.isArray(data.purchases)) throw new Error('This does not look like a backup file.');
      if (!confirm('Replace ALL current data with this backup?')) return;
      store.replaceAll(data);
      location.reload();
    } catch (e) { flash(dmsg, e.message, true); }
    ev.target.value = '';
  });
  root.querySelector('#export-csv').addEventListener('click', () => {
    const J = buildJournal(store.db);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['date', 'source', 'reference', 'memo', 'account', 'account_name', 'debit', 'credit'].join(',')];
    for (const e of J) for (const l of e.lines) {
      lines.push([e.date, e.source, q(e.ref), q(e.memo), l.acct, q(accountName(l.acct)), (l.dr / 100).toFixed(2), (l.cr / 100).toFixed(2)].join(','));
    }
    download(`journal-${today()}.csv`, lines.join('\n'), 'text/csv');
  });
  root.querySelector('#sample')?.addEventListener('click', () => {
    const hasData = store.db.orders.length || store.db.purchases.length || store.db.entries.length;
    if (hasData && !confirm('This replaces your current data with sample data. Download a backup first if you need it. Continue?')) return;
    store.replaceAll(makeSample());
    location.reload();
  });
  root.querySelector('#wipe')?.addEventListener('click', () => {
    if (!confirm('Erase ALL data in this browser? This cannot be undone (unless you have a backup).')) return;
    store.replaceAll({});
    location.reload();
  });

  draw();
  return draw; // re-run when data changes from another device
}

function shiftDay(date, delta) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(y, m - 1, d + delta);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const row = (label, amount, rawLabel = false) =>
  `<tr><td>${rawLabel ? label : esc(label)}</td><td class="num ${amount < 0 ? 'neg' : ''}">${fmt(amount)}</td></tr>`;

function plTable(m, y, month) {
  const codes = (k) => [...new Set([...m[k], ...y[k]].map((r) => r.code))].sort();
  const val = (rows, code) => rows.find((r) => r.code === code)?.amount || 0;
  const lines = (k) => codes(k).map((c) => `<tr><td class="indent">${esc(accountName(c))}</td><td class="num">${fmt(val(m[k], c))}</td><td class="num">${fmt(val(y[k], c))}</td></tr>`).join('');
  const tot = (label, a, b, cls = 'total') => `<tr class="${cls}"><td>${label}</td><td class="num ${a < 0 ? 'neg' : ''}">${fmt(a)}</td><td class="num ${b < 0 ? 'neg' : ''}">${fmt(b)}</td></tr>`;
  return `<div class="table-wrap"><table class="report pl">
    <thead><tr><th></th><th class="num">${esc(monthLabel(month))}</th><th class="num">Year to date</th></tr></thead>
    <tr class="head"><td colspan="3">Revenue</td></tr>${lines('revenue')}
    ${tot('Total revenue', m.totalRevenue, y.totalRevenue)}
    <tr class="head"><td colspan="3">Cost of goods sold</td></tr>${lines('cogs')}
    ${tot('Gross profit', m.grossProfit, y.grossProfit)}
    <tr class="head"><td colspan="3">Operating expenses</td></tr>${lines('opex')}
    ${tot('Total operating expenses', m.totalOpex, y.totalOpex)}
    ${tot('Operating profit', m.operatingProfit, y.operatingProfit)}
    ${codes('tax').length ? lines('tax') : ''}
    ${tot('Net profit', m.netIncome, y.netIncome, 'grand')}
  </table></div>`;
}
