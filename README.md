# biz-accounting

Accounting web app for a 3D printing business (computer retail later).

Live: https://nguyenminhtuan1802.github.io/biz-accounting/

## Pages

- **Orders**: bulk customer orders, items, discount, shipping, sales tax, payments received
- **Supplies**: purchases (filament/resin go to inventory; equipment goes to an asset; the rest is expensed)
- **Monthly costs**: rent, utilities, software, tax payments, owner money in/out, paying bills
- **Accounting**: month-end checklist, materials inventory count, P&L (month + YTD), balance sheet, who owes money, journal, month close/lock, backup

## How the accounting works

- Double-entry, accrual basis. Source records are the truth; the journal is derived from them, so the books always balance.
- Chart of accounts lives in `js/ledger.js`.
- Periodic inventory: cost of materials used = start inventory + purchases − month-end count.
- Money is stored as integer cents.
- Closed months are locked against edits (payments for old orders can still be added in open months).

## Stack

Plain HTML/CSS/JavaScript modules, no build step, served by GitHub Pages.
Storage is in `js/store.js` (browser localStorage today; Firebase Firestore next).

## Run locally

```sh
python3 -m http.server 8000   # open http://localhost:8000
```
