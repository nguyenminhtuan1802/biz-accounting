# biz-accounting

Accounting web app for a 3D printing business (and later, a computer retail business).

## Stack

- Static frontend served from GitHub Pages
- Firebase Firestore for shared data (customers, orders, supplies, ledger)
- No server to run — the page is the whole app

## Live

https://nguyenminhtuan1802.github.io/biz-accounting/

## Local

Any static server works. For example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Status

Scaffolding only. Firebase config and data model are next.
