# FlashRush — Courier / Parcel Delivery Platform

A complete, runnable backend for FlashRush, a peer-to-peer courier app: a customer books
a courier to pick up a parcel at one address and deliver it to another. Includes JWT auth,
role-based access (customer / courier / admin), distance-based pricing with live quotes,
the full delivery lifecycle, real-time tracking over WebSockets, and Stripe payments
(with a key-free mock mode). Serves the three-app frontend from the same process.

**Runs anywhere with zero build tools** — the data layer is a pure-JavaScript JSON store,
so there are no native modules to compile. This is the fix for the earlier `npm install`
failure.

## Stack
- **Node.js 18+** with Express
- **Pure-JS JSON datastore** (`src/db/db.js`) — no database server, no native deps
- **ws** — WebSocket real-time hub
- **Stripe** — payments (optional; mock mode without a key)
- **jsonwebtoken** + **bcryptjs** — auth

## Quick start (local)
```bash
npm install
cp .env.example .env        # set a JWT_SECRET
npm run seed                # writes flashrush-data.json with demo data
npm start                   # http://localhost:3000
```

### Demo logins
| Role     | Email                  | Password     |
|----------|------------------------|--------------|
| Customer | alex@flashrush.app     | password123  |
| Courier  | marcus@flashrush.app   | password123  |
| Admin    | sarah@flashrush.app    | admin123     |

## Deploy online (the easy path)

### Render / Railway (recommended)
1. Put this folder in a GitHub repo.
2. New Web Service → connect the repo. Build: `npm install`. Start: `npm start`.
3. Add env var `JWT_SECRET` (any long random string).
4. Deploy → you get a public URL.
5. Open the host's Shell and run `npm run seed` once.

Because there are no native modules now, the build just works on these hosts.

### Note on data persistence
The JSON store is a file. On hosts with ephemeral disks, attach a persistent volume where
`DB_PATH` points, or move to a managed database later (the collection-based access pattern
in `src/db/db.js` ports cleanly to MongoDB or Postgres).

## Pricing
Configured in `src/lib/pricing.js`: `total = (baseFee + miles × perMile) × sizeMultiplier × surge + tip`,
plus a service fee. Defaults: base $4.99, $1.25/mi, size ×1.0/1.3/1.7/2.2 (envelope→XL),
10% service fee. Distance uses the haversine formula between pickup and dropoff coordinates.

## API reference

### Auth
- `POST /api/auth/register` — `{ role, name, email, password, phone }`
- `POST /api/auth/login` — `{ email, password }`
- `GET  /api/auth/me`

### Deliveries (parcel jobs)
- `POST  /api/deliveries/quote` — **public**; `{ pickup:{lat,lng,address}, dropoff:{...}, size, tip }` → price breakdown
- `POST  /api/deliveries` (customer) — books a courier; same body + `recipient_name, recipient_phone, parcel_note, parcel_photo`
- `GET   /api/deliveries` (role-scoped)
- `GET   /api/deliveries/:id`
- `POST  /api/deliveries/:id/accept` (courier)
- `PATCH /api/deliveries/:id/status` — `{ status }` lifecycle: pending→accepted→picked_up→delivering→delivered
- `POST  /api/deliveries/:id/location` (courier) — `{ lat, lng }`
- `POST  /api/deliveries/:id/rate` (customer) — `{ rating: 1-5 }`

### Payments
- `POST /api/payments/intent` (customer) — `{ delivery_id }`
- `POST /api/payments/confirm-mock` (customer, mock mode)
- `POST /api/payments/webhook` (Stripe)

### Admin
- `GET /api/admin/overview` · `/drivers` · `/customers` · `/zones` · `/revenue`
- `PATCH /api/admin/zones/:id` — `{ surge, active }`

### Real-time (WebSocket)
Connect `ws://host/ws?token=JWT`, send `{ "type":"subscribe", "topic":"delivery:42" }`.
Events pushed: `status`, `location`, `payment`. Couriers subscribe to `drivers:queue`
for new jobs.

## Frontend
`public/index.html` — three apps in one file. The customer app is now a **send-a-parcel**
flow (pickup/dropoff, recipient, size, photo, live quote). `public/api-client.js` exposes
`window.FlashRush` for wiring the UI to the API.

## Going live with Stripe
1. Put your `sk_test_…` / `sk_live_…` in `STRIPE_SECRET_KEY`.
2. Add a webhook to `/api/payments/webhook` for `payment_intent.succeeded` and
   `payment_intent.payment_failed`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Collect card details with Stripe.js using the `clientSecret` from `/api/payments/intent`.

## Project layout
```
src/
  server.js          Express app + static hosting + realtime
  db/db.js           Pure-JS JSON datastore (no native deps)
  db/seed.js         Demo data
  lib/
    auth.js          JWT + password hashing
    pricing.js       Quote engine (distance + size + surge)
    realtime.js      WebSocket pub/sub
  middleware/auth.js requireAuth / requireRole
  routes/            auth, deliveries, payments, admin
public/
  index.html         Three-app frontend (customer = send a parcel)
  api-client.js      Browser client (window.FlashRush)
```

## Security notes for production
- Set a strong `JWT_SECRET`; rotate if leaked.
- Serve behind HTTPS (hosts usually terminate TLS for you).
- Add rate limiting on `/api/auth/*` before launch.
- Tighten CORS in `server.js` to your real frontend origin.
