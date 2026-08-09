# Kenya POS — eTIMS (VSCU) + M-Pesa

A commercial-grade point-of-sale system: an offline-tolerant POS terminal, a
backend that handles sales/inventory/payments, and integrations with KRA
eTIMS (VSCU) and M-Pesa Daraja.

## What's real vs. what's a template

- **Fully working**: data model, auth, cart/checkout flow, offline queueing
  and sync, invoice retry queue with backoff, M-Pesa STK push flow and
  callback handling (this API is stable and well-documented — the code here
  follows Safaricom's actual Daraja contract).
- **Structurally correct but needs verification against KRA's live spec**:
  `backend/src/services/etimsClient.ts`. The endpoint paths and field names
  follow the general shape of KRA's OSCU/VSCU spec and sandbox conventions,
  but KRA hands out the authoritative Postman collection and PDF spec only
  to developers registered on the eTIMS portal. Compare this file against
  that collection before pointing it at KRA's sandbox, and definitely
  before production.
- **Not included, because only you can do it**: KRA developer registration,
  device initialization with real credentials, the 6-phase certification
  process (sandbox testing → automated app testing → KYC documents →
  KRA review), and a payment gateway account (Safaricom Daraja app, a card
  processor like Pesapal/Flutterwave).

## Project layout

```
backend/      Node + Express + Prisma (SQLite by default, swap to Postgres for prod)
pos-client/   Electron + React POS terminal, offline-first via IndexedDB
```

## Running it locally

### Backend
```bash
cd backend
npm install
cp .env.example .env        # fill in real values as you get them
npx prisma migrate dev --name init
npm run seed                 # creates a demo business + admin@demo.co.ke / password123
npm run dev                  # http://localhost:4000
```

### POS client
```bash
cd pos-client
npm install
npm run electron:dev         # opens the Electron window
```
Log in with `admin@demo.co.ke` / `password123` (from the seed script).

## How the offline flow works

1. Cashier rings up a sale → written to a local IndexedDB queue immediately,
   before any network call.
2. If online, the app tries to sync right away so the common case feels instant.
3. A background loop (`startSyncLoop` in `pos-client/src/api/client.ts`)
   retries every 8s and on the browser's `online` event.
4. Once a sale reaches the backend, it's queued as an `Invoice` row —
   submission to eTIMS happens in a **separate** background worker
   (`backend/src/services/invoiceQueue.ts`) with exponential backoff, so a
   slow or down KRA endpoint never blocks a sale from completing.

This double-queue design (client → backend → eTIMS) is deliberate: each hop
can fail independently without losing data or blocking the cashier.

## Go-live checklist

1. **Switch the database** to Postgres: change `provider` in
   `prisma/schema.prisma` to `"postgresql"`, set `DATABASE_URL`, re-run
   migrations.
2. **Register on the eTIMS portal** (etims.kra.go.ke), get sandbox
   credentials, and diff `etimsClient.ts` against KRA's actual Postman
   collection — fix any field/path mismatches.
3. **Run KRA's 6-phase certification**: device registration → sandbox
   discovery/simulation → automated app testing → KYC docs → technical
   review → production sign-off. Budget real calendar time for this —
   it's a manual review process on KRA's end.
4. **Get a Daraja production app** from Safaricom (separate from sandbox),
   update `MPESA_*` env vars, and set `MPESA_ENV=production`.
5. **Add a card gateway** (Pesapal, Flutterwave, or a bank's gateway) —
   `routes/sales.ts` has a clearly marked spot where card payments create a
   `PENDING` payment; wire the actual charge + webhook the same way M-Pesa
   is wired.
6. **Confirm current KRA tax rates** — `backend/src/lib/tax.ts` and
   `etimsClient.ts` both have illustrative rates marked with comments;
   don't ship these without checking current rates per category.
7. **Receipt printing**: hook up a thermal printer library (e.g.
   `node-thermal-printer` or a printer's ESC/POS SDK) in the Electron main
   process, triggered after checkout — the receipt must include the
   eTIMS-returned QR code and invoice number to be a valid tax invoice.
8. Add HTTPS, rate limiting, and IP-restrict the M-Pesa callback endpoint
   in production — it's currently open by necessity (Safaricom calls it
   with no auth header) but should be locked down to Safaricom's published
   IP ranges.

## Notes on the data model

- `TaxCategory` (A–E) and the corresponding rates are placeholders —
  confirm the current KRA VAT categories/rates before relying on them.
- `Invoice.invoiceNumber` must be a strictly sequential integer per KRA's
  spec — the queue worker enforces this by always taking `max(invoiceNumber) + 1`,
  never reusing a number even if a submission later fails.
