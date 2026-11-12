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
Storage is in `js/store.js`: Firebase Firestore when `js/firebase-config.js` has a config,
otherwise browser localStorage ("local mode").

## Accounts and environments

| Login (typed on sign-in) | Firebase email | Can use |
|---|---|---|
| `user@1802` | `user@1802.local` | PROD data |
| `admin@1802` | `admin@1802.local` | PROD + TEST data, Admin page |

Firestore layout: `envs/{prod|test}/{orders|purchases|entries|closings|meta}/{id}`.
Access is enforced by `firestore.rules` on Google's servers, not by the website code.
The Admin page can wipe TEST and re-copy it from PROD (PROD is only read).

## Firebase setup (one time)

1. https://console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Email/Password → Enable** (leave "passwordless" off).
3. **Authentication → Users → Add user**: `admin@1802.local` and `user@1802.local` with strong passwords.
4. **Authentication → Settings → User actions**: untick "Enable create (sign-up)" so nobody else can register.
5. **Build → Firestore Database → Create database** → production mode → pick a nearby region.
6. **Firestore → Rules**: paste the contents of `firestore.rules` → **Publish**.
7. **Project settings → General → Your apps → Web (`</>`)** → register app (no Hosting) → copy the
   `firebaseConfig` object into `js/firebase-config.js`, commit, push.
8. **Authentication → Settings → Authorized domains**: add `nguyenminhtuan1802.github.io`.

## Run locally

```sh
python3 -m http.server 8000   # open http://localhost:8000
```
