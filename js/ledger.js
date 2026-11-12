// Accounting core: chart of accounts, double-entry journal, and reports.
//
// Source records (orders, purchases, cost entries, month closings) are the
// single source of truth. The journal is *derived* from them every time, so
// editing a record can never leave the books out of balance.
//
// Sign convention inside this file: positive amount = debit, negative = credit.

import { monthEnd } from './util.js';

export const ACCOUNTS = [
  ['1000', 'Cash on hand', 'asset'],
  ['1010', 'Bank account', 'asset'],
  ['1100', 'Accounts receivable (customers owe)', 'asset'],
  ['1200', 'Inventory – materials', 'asset'],
  ['1500', 'Equipment', 'asset'],
  ['2000', 'Accounts payable (we owe vendors)', 'liability'],
  ['2050', 'Credit card payable', 'liability'],
  ['2100', 'Sales tax payable', 'liability'],
  ['3000', 'Owner contributions', 'equity'],
  ['3100', 'Owner draws', 'equity'],
  ['4000', 'Sales – 3D printing', 'revenue'],
  ['4100', 'Shipping charged', 'revenue'],
  ['4900', 'Discounts given', 'revenue'],
  ['5000', 'Cost of goods – materials used', 'expense'],
  ['6100', 'Rent', 'expense'],
  ['6200', 'Electricity & utilities', 'expense'],
  ['6300', 'Internet, phone & software', 'expense'],
  ['6400', 'Packaging & shipping', 'expense'],
  ['6500', 'Repairs, parts & maintenance', 'expense'],
  ['6600', 'Bank & payment fees', 'expense'],
  ['6700', 'Marketing', 'expense'],
  ['6800', 'Wages & contractors', 'expense'],
  ['6850', 'Insurance', 'expense'],
  ['6900', 'Other expenses', 'expense'],
  ['7000', 'Income tax', 'expense'],
].map(([code, name, type]) => ({ code, name, type }));

export const ACCOUNT = Object.fromEntries(ACCOUNTS.map((a) => [a.code, a]));
export const accountName = (code) => ACCOUNT[code]?.name ?? code;

export const PAY_METHODS = {
  cash: { label: 'Cash', acct: '1000' },
  bank: { label: 'Bank', acct: '1010' },
  card: { label: 'Credit card', acct: '2050' },
  unpaid: { label: 'Not paid yet (bill)', acct: '2000' },
};

export const ORDER_STATUSES = [
  ['quote', 'Quote (not booked)'],
  ['confirmed', 'Confirmed'],
  ['printing', 'Printing'],
  ['ready', 'Ready'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled (not booked)'],
];
export const isBooked = (o) => o.status !== 'quote' && o.status !== 'cancelled';

export const SUPPLY_CATEGORIES = [
  { id: 'materials', label: 'Materials (filament, resin)', acct: '1200' },
  { id: 'packaging', label: 'Packaging & shipping supplies', acct: '6400' },
  { id: 'parts', label: 'Printer parts & maintenance', acct: '6500' },
  { id: 'equipment', label: 'Equipment (printers, tools)', acct: '1500' },
  { id: 'other', label: 'Other', acct: '6900' },
];
export const supplyCategory = (id) => SUPPLY_CATEGORIES.find((c) => c.id === id) || SUPPLY_CATEGORIES.at(-1);

export const COST_ACCOUNTS = ACCOUNTS.filter((a) => a.code >= '6000' && a.code < '7000');

// Money movements on the Monthly Costs page. `pays` = allowed payment methods.
export const ENTRY_KINDS = {
  expense: {
    label: 'Business expense',
    pays: ['bank', 'cash', 'card', 'unpaid'],
    lines: (e, pay) => [[e.account || '6900', e.amount], [pay, -e.amount]],
  },
  salesTaxPayment: {
    label: 'Sales tax paid to government',
    pays: ['bank', 'cash', 'card'],
    lines: (e, pay) => [['2100', e.amount], [pay, -e.amount]],
  },
  incomeTaxPayment: {
    label: 'Income tax paid',
    pays: ['bank', 'cash', 'card'],
    lines: (e, pay) => [['7000', e.amount], [pay, -e.amount]],
  },
  ownerContribution: {
    label: 'Owner put money in',
    pays: ['bank', 'cash'],
    lines: (e, pay) => [[pay, e.amount], ['3000', -e.amount]],
  },
  ownerDraw: {
    label: 'Owner took money out',
    pays: ['bank', 'cash'],
    lines: (e, pay) => [['3100', e.amount], [pay, -e.amount]],
  },
  payVendor: {
    label: 'Paid an unpaid vendor bill',
    pays: ['bank', 'cash', 'card'],
    lines: (e, pay) => [['2000', e.amount], [pay, -e.amount]],
  },
  payCard: {
    label: 'Paid credit card bill',
    pays: ['bank', 'cash'],
    lines: (e, pay) => [['2050', e.amount], [pay, -e.amount]],
  },
  depositCash: {
    label: 'Deposited cash into bank',
    pays: ['bank'],
    lines: (e) => [['1010', e.amount], ['1000', -e.amount]],
  },
};

export function orderTotals(o) {
  const subtotal = (o.items || []).reduce((s, it) => s + Math.round((Number(it.qty) || 0) * (it.unitPrice || 0)), 0);
  const discount = o.discount || 0;
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * (Number(o.taxRate) || 0)) / 100);
  const shipping = o.shipping || 0;
  const total = taxable + tax + shipping;
  const paid = (o.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  return { subtotal, discount, taxable, tax, shipping, total, paid, balance: total - paid };
}

function push(J, entry, pairs) {
  const lines = pairs
    .filter(([, amt]) => amt)
    .map(([acct, amt]) => ({ acct, dr: amt > 0 ? amt : 0, cr: amt < 0 ? -amt : 0 }));
  if (!lines.length) return;
  const diff = lines.reduce((s, l) => s + l.dr - l.cr, 0);
  if (diff !== 0) throw new Error(`Unbalanced journal entry ${entry.ref}: off by ${diff}`);
  J.push({ ...entry, lines });
}

/** Build the full journal from source records. */
export function buildJournal(db) {
  const J = [];

  for (const o of db.orders) {
    const t = orderTotals(o);
    const who = o.customer || 'Customer';
    if (isBooked(o)) {
      push(J, { date: o.date, source: 'order', id: o.id, ref: o.ref || 'Order', memo: `Sale to ${who}` }, [
        ['1100', t.total],
        ['4000', -t.subtotal],
        ['4900', t.discount],
        ['4100', -t.shipping],
        ['2100', -t.tax],
      ]);
    }
    // Payments are always real money, even on a quote (deposit) or cancelled order.
    for (const p of o.payments || []) {
      const acct = PAY_METHODS[p.method]?.acct || '1010';
      push(J, { date: p.date || o.date, source: 'payment', id: o.id, ref: o.ref || 'Payment', memo: `Payment from ${who}` }, [
        [acct, p.amount],
        ['1100', -p.amount],
      ]);
    }
  }

  for (const p of db.purchases) {
    const cat = supplyCategory(p.category);
    const pay = PAY_METHODS[p.paidVia]?.acct || '1010';
    push(J, { date: p.date, source: 'purchase', id: p.id, ref: p.vendor || 'Purchase', memo: p.description || cat.label }, [
      [cat.acct, p.total],
      [pay, -p.total],
    ]);
  }

  for (const e of db.entries) {
    const kind = ENTRY_KINDS[e.kind];
    if (!kind) continue;
    const pay = PAY_METHODS[e.paidVia]?.acct || '1010';
    push(J, { date: e.date, source: 'entry', id: e.id, ref: kind.label, memo: e.description || accountName(e.account) }, kind.lines(e, pay));
  }

  sortJournal(J);

  // Month-end materials adjustment (periodic inventory):
  // materials used = inventory balance at month end (before adjustment) - physical count.
  const counted = Object.keys(db.closings || {})
    .filter((m) => Number.isInteger(db.closings[m]?.endingInventory))
    .sort();
  for (const m of counted) {
    const end = monthEnd(m);
    const before = J.filter((e) => e.date <= end).reduce((s, e) => s + lineSum(e, '1200'), 0);
    const used = before - db.closings[m].endingInventory;
    push(J, { date: end, source: 'adjust', id: `inv-${m}`, ref: `Month end ${m}`, memo: 'Materials used (from inventory count)' }, [
      ['5000', used],
      ['1200', -used],
    ]);
  }

  sortJournal(J);
  return J;
}

const SOURCE_ORDER = { order: 0, purchase: 1, entry: 2, payment: 3, adjust: 9 };
function sortJournal(J) {
  J.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (SOURCE_ORDER[a.source] ?? 5) - (SOURCE_ORDER[b.source] ?? 5)));
}

const lineSum = (e, acct) => e.lines.reduce((s, l) => (l.acct === acct ? s + l.dr - l.cr : s), 0);

/** Net debit balance per account for entries with from <= date <= to (either bound optional). */
export function balances(J, from, to) {
  const m = new Map();
  for (const e of J) {
    if ((from && e.date < from) || (to && e.date > to)) continue;
    for (const l of e.lines) m.set(l.acct, (m.get(l.acct) || 0) + l.dr - l.cr);
  }
  return m;
}

export function profitAndLoss(J, from, to) {
  const b = balances(J, from, to);
  const rows = (pred, sign) =>
    ACCOUNTS.filter(pred)
      .map((a) => ({ ...a, amount: sign * (b.get(a.code) || 0) }))
      .filter((r) => r.amount !== 0);
  const revenue = rows((a) => a.type === 'revenue', -1);
  const cogs = rows((a) => a.code.startsWith('5'), 1);
  const opex = rows((a) => a.code.startsWith('6'), 1);
  const tax = rows((a) => a.code.startsWith('7'), 1);
  const sum = (r) => r.reduce((s, x) => s + x.amount, 0);
  const totalRevenue = sum(revenue);
  const grossProfit = totalRevenue - sum(cogs);
  const operatingProfit = grossProfit - sum(opex);
  const netIncome = operatingProfit - sum(tax);
  return { revenue, cogs, opex, tax, totalRevenue, totalCogs: sum(cogs), grossProfit, totalOpex: sum(opex), operatingProfit, totalTax: sum(tax), netIncome };
}

export function balanceSheet(J, asOf) {
  const b = balances(J, null, asOf);
  const rows = (type, sign) =>
    ACCOUNTS.filter((a) => a.type === type)
      .map((a) => ({ ...a, amount: sign * (b.get(a.code) || 0) }))
      .filter((r) => r.amount !== 0);
  const assets = rows('asset', 1);
  const liabilities = rows('liability', -1);
  const equity = rows('equity', -1);
  const retained = -ACCOUNTS.filter((a) => a.type === 'revenue' || a.type === 'expense').reduce((s, a) => s + (b.get(a.code) || 0), 0);
  const sum = (r) => r.reduce((s, x) => s + x.amount, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity) + retained;
  return { assets, liabilities, equity, retained, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

export function trialBalance(J, from, to) {
  let dr = 0, cr = 0;
  for (const e of J) {
    if ((from && e.date < from) || (to && e.date > to)) continue;
    for (const l of e.lines) { dr += l.dr; cr += l.cr; }
  }
  return { dr, cr, balanced: dr === cr };
}

/** Per-order amount still owed by the customer as of a date (booked total minus payments up to that date). */
export function receivablesAsOf(db, asOf) {
  return db.orders
    .filter((o) => o.date <= asOf)
    .map((o) => {
      const t = orderTotals(o);
      const billed = isBooked(o) ? t.total : 0;
      const paid = (o.payments || []).filter((p) => (p.date || o.date) <= asOf).reduce((s, p) => s + p.amount, 0);
      return { order: o, billed, paid, owed: billed - paid };
    })
    .filter((r) => r.owed !== 0);
}
