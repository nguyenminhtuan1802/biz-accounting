import { store } from '../store.js';
import { centsToInput, esc, flash, fmt, monthLabel, monthOf, toCents, today } from '../util.js';
import { PAY_METHODS, SUPPLY_CATEGORIES, accountName, supplyCategory } from '../ledger.js';

export function render(root) {
  let editing = null;
  let month = monthOf(today());

  root.innerHTML = `
    <section class="card">
      <h2 id="sf-title">New supply purchase</h2>
      <form id="sf" autocomplete="off">
        <div class="grid">
          <label>Purchase date<input type="date" name="date" required></label>
          <label>Vendor<input name="vendor" list="vendor-list" required placeholder="Where you bought it"></label>
          <label>Category<select name="category">${SUPPLY_CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select></label>
          <label>Paid with<select name="paidVia">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        </div>
        <label>What was bought<input name="description" placeholder="e.g. PLA 1kg, black, 10 rolls"></label>
        <div class="grid">
          <label>Quantity<input name="qty" inputmode="decimal" placeholder="10"></label>
          <label>Unit<input name="unit" placeholder="roll / kg / box"></label>
          <label>Total cost (incl. tax &amp; shipping)<input name="total" inputmode="decimal" required placeholder="0.00"></label>
          <label>Unit cost<output name="unitCost" class="out">—</output></label>
        </div>
        <p class="hint" id="cat-hint"></p>
        <label>Notes<textarea name="notes" rows="2"></textarea></label>
        <div class="actions">
          <button type="submit" class="primary">Save purchase</button>
          <button type="button" class="ghost" id="cancel" hidden>Cancel edit</button>
          <span class="msg" id="msg"></span>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="list-head">
        <h2>Supply purchases</h2>
        <label class="inline">Month <input type="month" id="month"></label>
      </div>
      <div id="list"></div>
    </section>
    <datalist id="vendor-list"></datalist>`;

  const form = root.querySelector('#sf');
  const f = form.elements;
  const msg = root.querySelector('#msg');
  const monthInput = root.querySelector('#month');
  monthInput.value = month;

  const HINTS = {
    materials: 'Goes into Inventory. It becomes cost of goods when you enter the month-end inventory count on the Accounting page.',
    equipment: 'Recorded as an Equipment asset, not an expense this month. (Depreciation can be added later.)',
  };
  function updateHints() {
    const cat = supplyCategory(f.category.value);
    root.querySelector('#cat-hint').textContent =
      `Books to: ${accountName(cat.acct)}. ${HINTS[cat.id] || 'Counted as an expense in the month it was bought.'}` +
      (f.paidVia.value === 'unpaid' ? ' Not paid yet: it shows as a bill owed until you record the payment on Monthly Costs.' : '');
    const q = parseFloat(f.qty.value);
    const t = toCents(f.total.value);
    f.unitCost.value = q > 0 && t ? `${fmt(Math.round(t / q))} / ${f.unit.value || 'unit'}` : '—';
  }

  function resetForm(p = null) {
    editing = p;
    form.reset();
    f.date.value = p?.date || today();
    f.vendor.value = p?.vendor || '';
    f.category.value = p?.category || 'materials';
    f.paidVia.value = p?.paidVia || 'bank';
    f.description.value = p?.description || '';
    f.qty.value = p?.qty ?? '';
    f.unit.value = p?.unit || '';
    f.total.value = centsToInput(p?.total);
    f.notes.value = p?.notes || '';
    root.querySelector('#sf-title').textContent = p ? 'Edit supply purchase' : 'New supply purchase';
    root.querySelector('#cancel').hidden = !p;
    updateHints();
  }

  function renderList() {
    const all = store.db.purchases;
    root.querySelector('#vendor-list').innerHTML = [...new Set(all.map((p) => p.vendor))].map((v) => `<option value="${esc(v)}">`).join('');
    const rows = all.filter((p) => monthOf(p.date) === month).sort((a, b) => b.date.localeCompare(a.date));
    const byCat = SUPPLY_CATEGORIES.map((c) => ({ c, total: rows.filter((p) => supplyCategory(p.category).id === c.id).reduce((s, p) => s + p.total, 0) })).filter((x) => x.total);
    const total = rows.reduce((s, p) => s + p.total, 0);
    root.querySelector('#list').innerHTML = `
      <p class="sub">${monthLabel(month)}${store.isClosed(month) ? ' · <span class="badge">closed</span>' : ''} · total <b>${fmt(total)}</b>
        ${byCat.map((x) => ` · ${esc(x.c.label.split(' (')[0])} ${fmt(x.total)}`).join('')}</p>
      ${rows.length ? `<div class="table-wrap"><table class="list">
        <thead><tr><th>Date</th><th>Vendor</th><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Total</th><th>Paid with</th><th></th></tr></thead>
        <tbody>${rows.map((p) => `<tr>
          <td>${esc(p.date)}</td><td>${esc(p.vendor)}</td><td class="clip" title="${esc(p.description)}">${esc(p.description)}</td>
          <td>${esc(supplyCategory(p.category).label.split(' (')[0])}</td>
          <td class="num">${esc(p.qty ?? '')} ${esc(p.unit || '')}</td><td class="num">${fmt(p.total)}</td>
          <td>${esc(PAY_METHODS[p.paidVia]?.label || p.paidVia)}</td>
          <td class="row-actions"><button class="ghost sm" data-edit="${p.id}">Edit</button><button class="ghost sm danger" data-delete="${p.id}">Delete</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No purchases this month.</p>'}`;
  }

  form.addEventListener('input', updateHints);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const rec = {
      ...(editing || {}),
      date: f.date.value,
      vendor: f.vendor.value.trim(),
      category: f.category.value,
      paidVia: f.paidVia.value,
      description: f.description.value.trim(),
      qty: parseFloat(f.qty.value) || null,
      unit: f.unit.value.trim(),
      total: toCents(f.total.value),
      notes: f.notes.value.trim(),
    };
    if (rec.total <= 0) return flash(msg, 'Enter the total cost.', true);
    try {
      store.upsert('purchases', rec);
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
    else if (b.dataset.edit) { resetForm(store.db.purchases.find((p) => p.id === b.dataset.edit)); form.scrollIntoView({ behavior: 'smooth' }); }
    else if (b.dataset.delete) {
      const p = store.db.purchases.find((x) => x.id === b.dataset.delete);
      if (!confirm(`Delete purchase from ${p.vendor} (${fmt(p.total)})?`)) return;
      try { store.remove('purchases', p.id); if (editing?.id === p.id) resetForm(); renderList(); }
      catch (e) { alert(e.message); }
    }
  });

  monthInput.addEventListener('change', () => { month = monthInput.value || monthOf(today()); renderList(); });

  resetForm();
  renderList();
  return renderList; // re-run when data changes from another device
}
