// Sample data so the Accounting page has something to show. Two months:
// last month (with an inventory count) and the current month.

import { emptyDb } from './store.js';
import { monthOf, shiftMonth, today, uid } from './util.js';

export function makeSample() {
  const cm = monthOf(today());
  const pm = shiftMonth(cm, -1);
  const d = (m, day) => `${m}-${String(day).padStart(2, '0')}`;
  const db = emptyDb();
  db.settings = { businessName: '3D Printing (sample)', currency: 'USD', defaultTaxRate: 8 };

  const entry = (date, kind, amount, paidVia, extra = {}) => db.entries.push({ id: uid(), date, kind, amount, paidVia, ...extra });
  const buy = (date, vendor, category, description, qty, unit, total, paidVia) =>
    db.purchases.push({ id: uid(), date, vendor, category, description, qty, unit, total, paidVia });

  entry(d(pm, 1), 'ownerContribution', 200000, 'bank', { description: 'Starting money' });
  buy(d(pm, 2), 'Filament Depot', 'materials', 'PLA 1kg rolls, assorted colors', 10, 'roll', 18000, 'bank');
  buy(d(pm, 5), 'Maker Supply Co', 'equipment', 'Second printer', 1, 'unit', 69900, 'bank');
  buy(d(pm, 10), 'Filament Depot', 'materials', 'PETG 1kg rolls', 5, 'roll', 11000, 'card');
  buy(d(pm, 11), 'BoxCo', 'packaging', 'Mailer boxes + bubble wrap', 1, 'lot', 4500, 'bank');
  buy(d(pm, 18), 'Maker Supply Co', 'parts', 'Nozzle set + build plate', 1, 'set', 2500, 'card');

  db.orders.push({
    id: uid(), date: d(pm, 8), ref: 'SO-001', customer: 'Lakeside Robotics Club', status: 'delivered',
    items: [{ desc: 'Custom logo keychain, PLA', qty: 200, unitPrice: 250 }],
    discount: 0, shipping: 0, taxRate: 8,
    payments: [{ date: d(pm, 15), amount: 54000, method: 'bank' }], notes: '',
  });
  db.orders.push({
    id: uid(), date: d(pm, 20), ref: 'SO-002', customer: 'Maple Dental', status: 'delivered',
    items: [{ desc: 'Dental training model', qty: 50, unitPrice: 1200 }],
    discount: 5000, shipping: 1500, taxRate: 8,
    payments: [{ date: d(pm, 20), amount: 30000, method: 'bank' }], notes: 'Balance due on delivery',
  });
  db.orders.push({
    id: uid(), date: d(cm, 3), ref: 'SO-003', customer: 'Lakeside Robotics Club', status: 'printing',
    items: [{ desc: 'Motor mount bracket, PETG', qty: 40, unitPrice: 675 }],
    discount: 0, shipping: 0, taxRate: 8, payments: [], notes: '',
  });

  entry(d(pm, 1), 'expense', 40000, 'bank', { account: '6100', description: 'Workshop rent' });
  entry(d(pm, 25), 'expense', 8500, 'bank', { account: '6200', description: 'Electricity' });
  entry(d(pm, 12), 'expense', 4500, 'card', { account: '6300', description: 'Internet + slicer software' });

  db.closings[pm] = { endingInventory: 16000 };

  buy(d(cm, 2), 'Filament Depot', 'materials', 'PLA 1kg rolls', 6, 'roll', 10800, 'bank');
  entry(d(cm, 5), 'payCard', 18000, 'bank', { description: 'Card statement' });
  entry(d(cm, 1), 'expense', 40000, 'bank', { account: '6100', description: 'Workshop rent' });

  return db;
}
