import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import './db/db.js'; // loads/initializes the datastore
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

server.listen(PORT, () => {
  console.log(`\n⚡ FlashRush courier server on http://localhost:${PORT}`);
  console.log(`  ✓ REST API at /api`);
  console.log(`  Payments: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_') ? 'LIVE' : 'MOCK mode (no Stripe key)'}\n`);
});
