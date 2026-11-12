import { store } from '../store.js';
import { makeSample } from '../sample.js';
import { esc, flash, fmt, monthEnd, monthLabel, monthOf, today } from '../util.js';
import { ACCOUNTS, ENTRY_KINDS, PAY_METHODS, SUPPLY_CATEGORIES, accountName, buildJournal, profitAndLoss } from '../ledger.js';

export function render(root) {
  const fb = store.mode === 'firebase';
  const env = store.env;

  root.innerHTML = `
    <section class="card">
      <h2>Database environment</h2>
      ${fb ? `
        <p>You are working on <span class="env-pill ${env}">${env === 'test' ? 'TEST data' : 'PROD data (real)'}</span></p>
        <p class="hint">PROD is the real business data that staff use. TEST is a scratch copy only the admin can see. Use it to try new features or risky changes without touching real records.</p>
        <div class="actions wrap">
          <button class="${env === 'prod' ? 'primary' : 'ghost'}" data-env="prod">Use PROD data</button>
          <button class="${env === 'test' ? 'primary' : 'ghost'}" data-env="test">Use TEST data</button>
        </div>
        <h3>Test data tools</h3>
        <div class="actions wrap">
          <button class="ghost danger" id="resync">Clear TEST and re-copy from PROD</button>
          <button class="ghost" id="sample-test">Replace TEST with sample data</button>
        </div>
        <h3>Restore a backup file</h3>
        <div class="actions wrap">
          <label class="ghost button">Restore backup into ${env.toUpperCase()}…<input type="file" id="restore" accept="application/json" hidden></label>
        </div>
        <p class="msg" id="progress"></p>`
      : `<p class="hint">Firebase is not set up yet, so the app is in <b>local mode</b> (data saved in this browser only).
           Add the config to <code>js/firebase-config.js</code> to turn on logins and the PROD/TEST databases.</p>`}
    </section>

    <section class="card formulas">
      <h2>How the accounting works</h2>
      ${principles()}
      <h3>Formulas</h3>
      ${formulas()}
      <h3>This month with real numbers</h3>
      ${liveExample()}
      <h3>What each record posts to the journal</h3>
      <p class="hint">Every saved record is turned into a balanced journal entry (debits = credits). This table is generated from the code that does the posting, so it always matches what the app does.</p>
      ${postingRules()}
      <h3>Chart of accounts</h3>
      ${chartOfAccounts()}
      <h3>Known simplifications (to revisit later)</h3>
      <ul>
        <li>Shipping charged to customers is not taxed.</li>
        <li>Equipment is recorded as an asset at cost and is not depreciated yet.</li>
        <li>Payments received before an order is booked (deposits on quotes) reduce receivables directly, so the customer shows a credit instead of a separate "customer deposits" liability.</li>
        <li>Materials use a month-end count (periodic inventory) instead of tracking grams per job.</li>
        <li>No opening balances yet for money, equipment or debts that existed before the first entry. For now, record them as "Owner put money in" or as a supply purchase.</li>
        <li>Income tax is recorded when it is paid, not estimated each month.</li>
      </ul>
    </section>`;

  if (!fb) return null;
  const progress = root.querySelector('#progress');
  const busy = (on) => root.querySelectorAll('button, input[type=file]').forEach((b) => { b.disabled = on; });
  const report = (done, total) => { progress.textContent = `Working… ${done} / ${total} writes`; };

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.env) { store.setEnv(b.dataset.env); return; }

    if (b.id === 'resync') {
      if (!confirm('Delete EVERYTHING in TEST and replace it with a fresh copy of PROD?\n\nPROD is only read, never changed.')) return;
      busy(true);
      try {
        const r = await store.resyncTestFromProd(report);
        flash(progress, `Done. TEST now matches PROD (${r.written} records copied, ${r.deleted} old test records removed).`);
      } catch (e) { flash(progress, 'Failed: ' + e.message, true); }
      busy(false);
    }

    if (b.id === 'sample-test') {
      if (!confirm('Delete EVERYTHING in TEST and load sample data?')) return;
      busy(true);
      try {
        await store.replaceEnv('test', makeSample(), report);
        flash(progress, 'Done. TEST now has sample data. Switch to TEST to see it.');
      } catch (e) { flash(progress, 'Failed: ' + e.message, true); }
      busy(false);
    }
  });

  root.querySelector('#restore').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.orders) || !Array.isArray(data.purchases)) throw new Error('This does not look like a backup file.');
      const target = store.env;
      if (target === 'prod') {
        const typed = prompt('This REPLACES ALL REAL (PROD) DATA with the backup file.\nType PROD to confirm.');
        if (typed !== 'PROD') return;
      } else if (!confirm('Replace everything in TEST with this backup?')) return;
      busy(true);
      const r = await store.replaceEnv(target, data, report);
      flash(progress, `Restored ${r.written} records into ${target.toUpperCase()}.`);
    } catch (e) { flash(progress, 'Failed: ' + e.message, true); }
    busy(false);
  });

  return null;
}

function principles() {
  return `<ul>
    <li><b>Double-entry.</b> Every transaction touches at least two accounts, and total debits always equal total credits. If they don't, the Accounting page shows a warning.</li>
    <li><b>Accrual basis.</b> A sale counts as revenue on the order date (once the order is no longer a quote), not when the cash arrives. Unpaid amounts sit in <i>Accounts receivable</i> until paid.</li>
    <li><b>The journal is calculated, not typed.</b> Orders, purchases, monthly costs and month-end counts are the source records. The journal is rebuilt from them every time, so editing or deleting a record can never leave the books unbalanced.</li>
    <li><b>Exact money.</b> Amounts are stored as whole cents and rounded once per line, so totals never drift by fractions of a cent.</li>
    <li><b>Closing a month</b> locks every record dated in that month. A payment that arrives later for an old order can still be added, as long as the payment is dated in an open month.</li>
  </ul>`;
}

function formulas() {
  const f = [
    ['Line total', 'round(Qty × Unit price) to the cent'],
    ['Subtotal', 'Σ Line totals'],
    ['Taxable amount', 'Subtotal − Discount'],
    ['Sales tax', 'round(Taxable amount × Tax % ÷ 100)'],
    ['Order total', 'Taxable amount + Sales tax + Shipping'],
    ['Balance due', 'Order total − Σ Payments received'],
    ['Materials used (COGS)', 'Inventory at start of month + Materials bought this month − Month-end count'],
    ['Revenue', 'Sales + Shipping charged − Discounts given'],
    ['Gross profit', 'Revenue − Materials used'],
    ['Operating profit', 'Gross profit − Operating expenses (accounts 6xxx)'],
    ['Net profit', 'Operating profit − Income tax (7000)'],
    ['Profit kept in business', 'Net profit of all months up to the date (retained earnings)'],
    ['Balance sheet check', 'Assets = Liabilities + Owner contributions − Owner draws + Profit kept'],
    ['Sales tax owed', 'Sales tax collected on orders − Sales tax paid to government'],
  ];
  return `<div class="table-wrap"><table class="report">${f.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td><code>${esc(v)}</code></td></tr>`).join('')}</table></div>`;
}

function liveExample() {
  const m = monthOf(today());
  let J;
  try { J = buildJournal(store.db); } catch (e) { return `<p class="error">${esc(e.message)}</p>`; }
  const p = profitAndLoss(J, `${m}-01`, monthEnd(m));
  const line = (a, op, b, eq, r) => `<tr><td><code>${a} ${op} ${b}</code></td><td class="num">= <b>${r}</b></td><td>${eq}</td></tr>`;
  return `<p class="sub">${monthLabel(m)}, ${store.mode === 'firebase' ? store.env.toUpperCase() + ' data' : 'local data'}:</p>
    <div class="table-wrap"><table class="report">
      ${line(fmt(p.totalRevenue), '−', fmt(p.totalCogs), 'Gross profit', fmt(p.grossProfit))}
      ${line(fmt(p.grossProfit), '−', fmt(p.totalOpex), 'Operating profit', fmt(p.operatingProfit))}
      ${line(fmt(p.operatingProfit), '−', fmt(p.totalTax), 'Net profit', fmt(p.netIncome))}
    </table></div>`;
}

function acctLabel(code) {
  if (code === 'PAY') return 'Payment account*';
  if (code === '6xxx') return 'Chosen expense category <small>(6100–6900)</small>';
  return `${esc(code)} ${esc(accountName(code))}`;
}

function postingRules() {
  const rules = [
    { when: 'Order booked (any status except Quote/Cancelled), dated on the order date', lines: [['Dr', '1100', 'Order total'], ['Cr', '4000', 'Subtotal'], ['Dr', '4900', 'Discount'], ['Cr', '4100', 'Shipping'], ['Cr', '2100', 'Sales tax']] },
    { when: 'Each payment on an order, dated on the payment date', lines: [['Dr', 'PAY', 'Amount'], ['Cr', '1100', 'Amount']] },
    ...SUPPLY_CATEGORIES.map((c) => ({ when: `Supply purchase: ${c.label}`, lines: [['Dr', c.acct, 'Total cost'], ['Cr', 'PAY', 'Total cost']] })),
    ...Object.values(ENTRY_KINDS).map((k) => ({
      when: `Monthly costs: ${k.label}`,
      lines: k.lines({ amount: 1, account: '6xxx' }, 'PAY').map(([a, amt]) => [amt > 0 ? 'Dr' : 'Cr', a, 'Amount']),
    })),
    { when: 'Month end: materials inventory count saved, dated on the last day of the month', lines: [['Dr', '5000', 'Materials used'], ['Cr', '1200', 'Materials used']] },
  ];
  return `<p class="hint">* Payment account = the one chosen on the form: ${Object.values(PAY_METHODS).map((p) => `${esc(p.label)} → ${p.acct}`).join(' · ')}</p>
  <div class="table-wrap"><table class="list rules">
    <thead><tr><th>When</th><th></th><th>Account</th><th>Amount</th></tr></thead>
    <tbody>${rules.map((r) => r.lines.map((l, i) => `<tr class="${i === 0 ? 'first' : ''}">
      <td>${i === 0 ? esc(r.when) : ''}</td><td><b>${l[0]}</b></td><td class="${l[0] === 'Cr' ? 'indent' : ''}">${acctLabel(l[1])}</td><td>${esc(l[2])}</td></tr>`).join('')).join('')}</tbody>
  </table></div>`;
}

function chartOfAccounts() {
  const normal = (t) => (t === 'asset' || t === 'expense' ? 'Debit' : 'Credit');
  return `<div class="table-wrap"><table class="list">
    <thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Increases with</th></tr></thead>
    <tbody>${ACCOUNTS.map((a) => `<tr><td>${a.code}</td><td>${esc(a.name)}</td><td>${a.type}</td><td>${a.code === '4900' || a.code === '3100' ? 'Debit (reduces ' + (a.code === '4900' ? 'revenue' : 'equity') + ')' : normal(a.type)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}
