import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import db from './db/db.js'; // data layer (Postgres or JSON)
import { seedData } from './db/seed.js';
import { attachRealtime } from './lib/realtime.js';
import authRoutes from './routes/auth.js';
import deliveryRoutes from './routes/deliveries.js';
import paymentRoutes from './routes/payments.js';
import adminRoutes from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Stripe webhook needs the RAW body for signature verification — mount before json().
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
// Larger limit so parcel photos (data URLs) fit.
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(join(__dirname, '../public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
attachRealtime(server);

async function start() {
  // Initialize the data layer (connect to Postgres or load JSON) BEFORE serving.
  await db.init();

  // Auto-seed ONLY on the very first boot, protected by a marker file on the
  // persistent disk. Once seeded, this never runs again — even if the in-memory
  // data somehow looks empty — so real data can never be overwritten by a reseed.
  const seededMarker = (process.env.DB_PATH ? dirname(process.env.DB_PATH) : '.') + '/.seeded';
  const fs = await import('fs');
  const alreadySeededOnce = fs.existsSync(seededMarker);
  const hasData = db.raw().users.length > 0;

  if (!alreadySeededOnce && !hasData) {
    const seedResult = seedData(false);
    if (seedResult.seeded) {
      try { fs.writeFileSync(seededMarker, new Date().toISOString()); } catch {}
      console.log('  ✓ Database seeded with demo data (first boot)');
    }
  } else if (alreadySeededOnce && !hasData) {
    console.warn('  ⚠ Seed marker exists but data is empty — NOT reseeding (protecting against data loss).');
  } else {
    console.log('  ✓ Database already populated — skipping seed');
    if (!alreadySeededOnce) { try { fs.writeFileSync(seededMarker, new Date().toISOString()); } catch {} }
  }

  server.listen(PORT, () => {
    console.log(`\n⚡ FlashRush courier server on http://localhost:${PORT}`);
    console.log(`  ✓ REST API at /api`);
    console.log(`  Payments: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_') ? 'LIVE' : 'MOCK mode (no Stripe key)'}\n`);
  });
}

start().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
