import { store } from '../store.js';
import { centsToInput, esc, flash, fmt, monthLabel, monthOf, toCents, today } from '../util.js';
import { ORDER_STATUSES, PAY_METHODS, isBooked, orderTotals } from '../ledger.js';

const ORDER_PAY = ['bank', 'cash'];

export function render(root) {
  let editing = null;
  let month = monthOf(today());

  root.innerHTML = `
    <section class="card">
      <h2 id="of-title">New customer order</h2>
      <form id="of" autocomplete="off">
        <div class="grid">
          <label>Order date<input type="date" name="date" required></label>
          <label>Customer<input name="customer" list="cust-list" required placeholder="Company or person"></label>
          <label>Order # / reference<input name="ref" placeholder="e.g. SO-004"></label>
          <label>Status<select name="status">${ORDER_STATUSES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        </div>

        <h3>Items</h3>
        <div class="table-wrap"><table class="lines">
          <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Line total</th><th></th></tr></thead>
          <tbody id="items"></tbody>
        </table></div>
        <button type="button" class="ghost" id="add-item">+ Add item</button>

        <div class="grid">
          <label>Discount<input name="discount" inputmode="decimal" placeholder="0.00"></label>
          <label>Shipping charged<input name="shipping" inputmode="decimal" placeholder="0.00"></label>
          <label>Sales tax %<input name="taxRate" inputmode="decimal" placeholder="0"></label>
        </div>
        <div id="totals" class="totals"></div>

        <h3>Payments received</h3>
        <div class="table-wrap"><table class="lines">
          <thead><tr><th>Date</th><th class="num">Amount</th><th>Received in</th><th></th></tr></thead>
          <tbody id="payments"></tbody>
        </table></div>
        <button type="button" class="ghost" id="add-payment">+ Add payment</button>

        <label>Notes<textarea name="notes" rows="2"></textarea></label>
        <div class="actions">
          <button type="submit" class="primary">Save order</button>
          <button type="button" class="ghost" id="cancel" hidden>Cancel edit</button>
          <span class="msg" id="msg"></span>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="list-head">
        <h2>Orders</h2>
        <label class="inline">Month <input type="month" id="month"></label>
      </div>
      <div id="list"></div>
    </section>
    <datalist id="cust-list"></datalist>`;

  const form = root.querySelector('#of');
  const itemsEl = root.querySelector('#items');
  const paysEl = root.querySelector('#payments');
  const totalsEl = root.querySelector('#totals');
  const msg = root.querySelector('#msg');
  const monthInput = root.querySelector('#month');
  monthInput.value = month;

  function addItem(it = { desc: '', qty: 1, unitPrice: 0 }) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="i-desc" value="${esc(it.desc)}" placeholder="e.g. PLA keychain, black"></td>
      <td><input class="i-qty num" inputmode="decimal" value="${esc(it.qty)}"></td>
      <td><input class="i-price num" inputmode="decimal" value="${centsToInput(it.unitPrice)}" placeholder="0.00"></td>
      <td class="num i-total"></td>
      <td><button type="button" class="icon" data-del title="Remove">✕</button></td>`;
    itemsEl.append(tr);
  }

  function addPayment(p = { date: today(), amount: 0, method: 'bank' }) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="date" class="p-date" value="${esc(p.date)}"></td>
      <td><input class="p-amt num" inputmode="decimal" value="${centsToInput(p.amount)}" placeholder="0.00"></td>
      <td><select class="p-method">${ORDER_PAY.map((m) => `<option value="${m}" ${m === p.method ? 'selected' : ''}>${PAY_METHODS[m].label}</option>`).join('')}</select></td>
      <td><button type="button" class="icon" data-del title="Remove">✕</button></td>`;
    paysEl.append(tr);
  }

  function readForm() {
    const f = form.elements;
    return {
      ...(editing || {}),
      date: f.date.value,
      customer: f.customer.value.trim(),
      ref: f.ref.value.trim(),
      status: f.status.value,
      discount: toCents(f.discount.value),
      shipping: toCents(f.shipping.value),
      taxRate: parseFloat(f.taxRate.value) || 0,
      notes: f.notes.value.trim(),
      items: [...itemsEl.rows]
        .map((tr) => ({
          desc: tr.querySelector('.i-desc').value.trim(),
          qty: parseFloat(tr.querySelector('.i-qty').value) || 0,
          unitPrice: toCents(tr.querySelector('.i-price').value),
        }))
        .filter((it) => it.desc || it.unitPrice),
      payments: [...paysEl.rows]
        .map((tr) => ({
          date: tr.querySelector('.p-date').value,
          amount: toCents(tr.querySelector('.p-amt').value),
          method: tr.querySelector('.p-method').value,
        }))
        .filter((p) => p.amount),
    };
  }

  function updateTotals() {
    const o = readForm();
    [...itemsEl.rows].forEach((tr) => {
      const q = parseFloat(tr.querySelector('.i-qty').value) || 0;
      tr.querySelector('.i-total').textContent = fmt(Math.round(q * toCents(tr.querySelector('.i-price').value)));
    });
    const t = orderTotals(o);
    totalsEl.innerHTML = `
      <div><span>Subtotal</span><b>${fmt(t.subtotal)}</b></div>
      ${t.discount ? `<div><span>Discount</span><b>−${fmt(t.discount)}</b></div>` : ''}
      ${t.tax ? `<div><span>Sales tax</span><b>${fmt(t.tax)}</b></div>` : ''}
      ${t.shipping ? `<div><span>Shipping</span><b>${fmt(t.shipping)}</b></div>` : ''}
      <div class="grand"><span>Order total</span><b>${fmt(t.total)}</b></div>
      <div><span>Paid</span><b>${fmt(t.paid)}</b></div>
      <div class="${t.balance > 0 ? 'owed' : ''}"><span>Balance due</span><b>${fmt(t.balance)}</b></div>`;
  }

  function resetForm(o = null) {
    editing = o;
    form.reset();
    itemsEl.innerHTML = '';
    paysEl.innerHTML = '';
    const f = form.elements;
    f.date.value = o?.date || today();
    f.customer.value = o?.customer || '';
    f.ref.value = o?.ref || '';
    f.status.value = o?.status || 'confirmed';
    f.discount.value = centsToInput(o?.discount);
    f.shipping.value = centsToInput(o?.shipping);
    f.taxRate.value = o ? o.taxRate || '' : store.db.settings.defaultTaxRate || '';
    f.notes.value = o?.notes || '';
    (o?.items?.length ? o.items : [undefined]).forEach((it) => addItem(it));
    (o?.payments || []).forEach((p) => addPayment(p));
    root.querySelector('#of-title').textContent = o ? `Edit order ${o.ref || ''}` : 'New customer order';
    root.querySelector('#cancel').hidden = !o;
    updateTotals();
  }

  function renderList() {
    const all = store.db.orders;
    root.querySelector('#cust-list').innerHTML = [...new Set(all.map((o) => o.customer))].map((c) => `<option value="${esc(c)}">`).join('');
    const rows = all.filter((o) => monthOf(o.date) === month).sort((a, b) => b.date.localeCompare(a.date));
    const booked = rows.filter(isBooked).map(orderTotals);
    const sum = (k) => booked.reduce((s, t) => s + t[k], 0);
    const closed = store.isClosed(month);
    root.querySelector('#list').innerHTML = `
      <p class="sub">${monthLabel(month)}${closed ? ' · <span class="badge">closed</span>' : ''} ·
        ${booked.length} booked order(s) · billed <b>${fmt(sum('total'))}</b> · paid <b>${fmt(sum('paid'))}</b> · still owed <b>${fmt(sum('balance'))}</b></p>
      ${rows.length ? `<div class="table-wrap"><table class="list">
        <thead><tr><th>Date</th><th>Ref</th><th>Customer</th><th>Items</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Owed</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((o) => {
          const t = orderTotals(o);
          const items = o.items.map((i) => `${i.qty}× ${i.desc}`).join(', ');
          return `<tr class="${isBooked(o) ? '' : 'muted'}">
            <td>${esc(o.date)}</td><td>${esc(o.ref)}</td><td>${esc(o.customer)}</td>
            <td class="clip" title="${esc(items)}">${esc(items)}</td>
            <td class="num">${fmt(t.total)}</td><td class="num">${fmt(t.paid)}</td>
            <td class="num ${t.balance > 0 && isBooked(o) ? 'owed' : ''}">${fmt(t.balance)}</td>
            <td><span class="badge s-${o.status}">${esc(o.status)}</span></td>
            <td class="row-actions"><button class="ghost sm" data-edit="${o.id}">Edit</button><button class="ghost sm danger" data-delete="${o.id}">Delete</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<p class="empty">No orders this month.</p>'}`;
  }

  form.addEventListener('input', updateTotals);
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-del')) { b.closest('tr').remove(); updateTotals(); }
    else if (b.id === 'add-item') { addItem(); }
    else if (b.id === 'add-payment') { addPayment({ date: today(), amount: orderTotals(readForm()).balance, method: 'bank' }); updateTotals(); }
    else if (b.id === 'cancel') { resetForm(); }
    else if (b.dataset.edit) { resetForm(store.db.orders.find((o) => o.id === b.dataset.edit)); form.scrollIntoView({ behavior: 'smooth' }); }
    else if (b.dataset.delete) {
      const o = store.db.orders.find((x) => x.id === b.dataset.delete);
      if (!confirm(`Delete order ${o.ref || ''} for ${o.customer}?`)) return;
      try { store.remove('orders', o.id); if (editing?.id === o.id) resetForm(); renderList(); }
      catch (e) { alert(e.message); }
    }
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const o = readForm();
    if (!o.items.length) return flash(msg, 'Add at least one item.', true);
    if (o.payments.some((p) => !p.date)) return flash(msg, 'Every payment needs a date.', true);
    try {
      store.upsert('orders', o);
      month = monthOf(o.date);
      monthInput.value = month;
      resetForm();
      renderList();
      flash(msg, 'Saved ✓');
    } catch (e) { flash(msg, e.message, true); }
  });

  monthInput.addEventListener('change', () => { month = monthInput.value || monthOf(today()); renderList(); });

  resetForm();
  renderList();
  return renderList; // re-run when data changes from another device
}
