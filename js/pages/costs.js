import { store } from '../store.js';
import { centsToInput, esc, flash, fmt, monthEnd, monthLabel, monthOf, setCurrency, shiftMonth, toCents, today } from '../util.js';
import { COST_ACCOUNTS, ENTRY_KINDS, PAY_METHODS, accountName } from '../ledger.js';

export function render(root) {
  let editing = null;
  let month = monthOf(today());
  const s = store.db.settings;

  root.innerHTML = `
    <section class="card">
      <h2 id="cf-title">New monthly cost or money movement</h2>
      <form id="cf" autocomplete="off">
        <div class="grid">
          <label>Date<input type="date" name="date" required></label>
          <label>Type<select name="kind">${Object.entries(ENTRY_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
          <label id="acct-wrap">Expense category<select name="account">${COST_ACCOUNTS.map((a) => `<option value="${a.code}">${a.name}</option>`).join('')}</select></label>
          <label>Amount<input name="amount" inputmode="decimal" required placeholder="0.00"></label>
          <label><span id="pay-label">Paid with</span><select name="paidVia"></select></label>
        </div>
        <label>Description<input name="description" placeholder="e.g. October electricity bill"></label>
        <div class="actions">
          <button type="submit" class="primary">Save</button>
          <button type="button" class="ghost" id="cancel" hidden>Cancel edit</button>
          <span class="msg" id="msg"></span>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="list-head">
        <h2>Monthly costs &amp; money movements</h2>
        <label class="inline">Month <input type="month" id="month"></label>
      </div>
      <div id="list"></div>
      <button type="button" class="ghost" id="copy-prev">Copy last month's expenses into this month</button>
    </section>

    <section class="card">
      <h2>Business settings</h2>
      <form id="settings" class="grid" autocomplete="off">
        <label>Business name<input name="businessName" value="${esc(s.businessName)}"></label>
        <label>Currency<select name="currency">${['USD', 'VND', 'EUR', 'CAD', 'AUD', 'GBP'].map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Default sales tax % for new orders<input name="defaultTaxRate" inputmode="decimal" value="${esc(s.defaultTaxRate || '')}"></label>
        <div class="actions"><button type="submit" class="primary">Save settings</button><span class="msg" id="smsg"></span></div>
      </form>
    </section>`;

  const form = root.querySelector('#cf');
  const f = form.elements;
  const msg = root.querySelector('#msg');
  const monthInput = root.querySelector('#month');
  monthInput.value = month;

  function syncKind(selectedPay) {
    const kind = ENTRY_KINDS[f.kind.value];
    root.querySelector('#acct-wrap').hidden = f.kind.value !== 'expense';
    const incoming = f.kind.value === 'ownerContribution' || f.kind.value === 'depositCash';
    root.querySelector('#pay-label').textContent = incoming ? 'Into' : 'Paid with';
    const cur = selectedPay || f.paidVia.value;
    f.paidVia.innerHTML = kind.pays.map((p) => `<option value="${p}">${PAY_METHODS[p].label}</option>`).join('');
    f.paidVia.value = kind.pays.includes(cur) ? cur : kind.pays[0];
  }

  function resetForm(e = null) {
    editing = e;
    form.reset();
    f.date.value = e?.date || today();
    f.kind.value = e?.kind || 'expense';
    f.account.value = e?.account || '6100';
    f.amount.value = centsToInput(e?.amount);
    f.description.value = e?.description || '';
    syncKind(e?.paidVia || 'bank');
    root.querySelector('#cf-title').textContent = e ? 'Edit entry' : 'New monthly cost or money movement';
    root.querySelector('#cancel').hidden = !e;
  }

  const entryLabel = (e) => (e.kind === 'expense' ? accountName(e.account) : ENTRY_KINDS[e.kind]?.label || e.kind);

  function renderList() {
    const rows = store.db.entries.filter((e) => monthOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date));
    const expenses = rows.filter((e) => e.kind === 'expense').reduce((t, e) => t + e.amount, 0);
    root.querySelector('#list').innerHTML = `
      <p class="sub">${monthLabel(month)}${store.isClosed(month) ? ' · <span class="badge">closed</span>' : ''} · operating expenses <b>${fmt(expenses)}</b></p>
      ${rows.length ? `<div class="table-wrap"><table class="list">
        <thead><tr><th>Date</th><th>Type / category</th><th>Description</th><th class="num">Amount</th><th>Paid with / into</th><th></th></tr></thead>
        <tbody>${rows.map((e) => `<tr>
          <td>${esc(e.date)}</td><td>${esc(entryLabel(e))}</td><td class="clip">${esc(e.description)}</td>
          <td class="num">${fmt(e.amount)}</td><td>${esc(PAY_METHODS[e.paidVia]?.label || '')}</td>
          <td class="row-actions"><button class="ghost sm" data-edit="${e.id}">Edit</button><button class="ghost sm danger" data-delete="${e.id}">Delete</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing recorded this month.</p>'}`;
  }

  form.addEventListener('change', (ev) => { if (ev.target.name === 'kind') syncKind(); });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const rec = {
      ...(editing || {}),
      date: f.date.value,
      kind: f.kind.value,
      account: f.kind.value === 'expense' ? f.account.value : undefined,
      amount: toCents(f.amount.value),
      paidVia: f.paidVia.value,
      description: f.description.value.trim(),
    };
    if (rec.amount <= 0) return flash(msg, 'Enter an amount greater than zero.', true);
    try {
      store.upsert('entries', rec);
      month = monthOf(rec.date);
      monthInput.value = month;
      resetForm();
      renderList();
      flash(msg, 'Saved ✓');
    } catch (e) { flash(msg, e.message, true); }
  });

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'cancel') resetForm();
    else if (b.id === 'copy-prev') copyPrevious();
    else if (b.dataset.edit) { resetForm(store.db.entries.find((x) => x.id === b.dataset.edit)); form.scrollIntoView({ behavior: 'smooth' }); }
    else if (b.dataset.delete) {
      const e = store.db.entries.find((x) => x.id === b.dataset.delete);
      if (!confirm(`Delete "${entryLabel(e)}" ${fmt(e.amount)}?`)) return;
      try { store.remove('entries', e.id); if (editing?.id === e.id) resetForm(); renderList(); }
      catch (err) { alert(err.message); }
    }
  });

  function copyPrevious() {
    const prev = shiftMonth(month, -1);
    const src = store.db.entries.filter((e) => e.kind === 'expense' && monthOf(e.date) === prev);
    if (!src.length) return alert(`No expenses found in ${monthLabel(prev)}.`);
    if (!confirm(`Copy ${src.length} expense(s) from ${monthLabel(prev)} into ${monthLabel(month)}? You can edit the amounts afterwards.`)) return;
    const last = monthEnd(month);
    try {
      for (const e of src) {
        const date = `${month}-${e.date.slice(8)}`;
        const { id, createdAt, updatedAt, ...rest } = e;
        store.upsert('entries', { ...rest, date: date > last ? last : date });
      }
      renderList();
    } catch (err) { alert(err.message); }
  }

  monthInput.addEventListener('change', () => { month = monthInput.value || monthOf(today()); renderList(); });

  root.querySelector('#settings').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const sf = ev.target.elements;
    store.setSettings({
      businessName: sf.businessName.value.trim() || '3D Printing',
      currency: sf.currency.value,
      defaultTaxRate: parseFloat(sf.defaultTaxRate.value) || 0,
    });
    setCurrency(sf.currency.value);
    document.getElementById('biz-name').textContent = store.db.settings.businessName;
    renderList();
    flash(root.querySelector('#smsg'), 'Saved ✓');
  });

  resetForm();
  renderList();
}
