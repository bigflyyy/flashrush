import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { publish } from '../lib/realtime.js';

const r = Router();

// Lazy Stripe init — the server still runs without a key (payments just mock).
let stripe = null;
const KEY = process.env.STRIPE_SECRET_KEY;
const liveMode = KEY && KEY.startsWith('sk_');
if (liveMode) {
  const Stripe = (await import('stripe')).default;
  stripe = new Stripe(KEY);
}

// POST /api/payments/intent  { delivery_id } -> client secret (or mock)
r.post('/intent', requireAuth, requireRole('customer'), async (req, res) => {
  const { delivery_id } = req.body || {};
  const d = db.deliveries.get(delivery_id);
  if (!d || d.customer_id !== req.user.id) return res.status(404).json({ error: 'Delivery not found' });
  if (d.payment_status === 'paid') return res.status(409).json({ error: 'Already paid' });

  const amount = Math.round(d.total * 100);

  if (!liveMode) {
    const fakeId = `pi_mock_${d.id}_${Date.now()}`;
    db.deliveries.update(d.id, { payment_intent: fakeId, payment_status: 'processing' });
    return res.json({ mock: true, clientSecret: `${fakeId}_secret`, paymentIntent: fakeId, amount });
  }

  const intent = await stripe.paymentIntents.create({
    amount, currency: 'usd',
    metadata: { delivery_id: String(d.id), customer_id: String(req.user.id) },
    automatic_payment_methods: { enabled: true },
  });
  db.deliveries.update(d.id, { payment_intent: intent.id, payment_status: 'processing' });
  res.json({ clientSecret: intent.client_secret, paymentIntent: intent.id, amount });
});

// POST /api/payments/confirm-mock  { delivery_id }  (mock mode only)
r.post('/confirm-mock', requireAuth, requireRole('customer'), (req, res) => {
  if (liveMode) return res.status(400).json({ error: 'Live mode: confirm via Stripe client' });
  const d = db.deliveries.get(req.body?.delivery_id);
  if (!d || d.customer_id !== req.user.id) return res.status(404).json({ error: 'Delivery not found' });
  db.deliveries.update(d.id, { payment_status: 'paid' });
  publish(`delivery:${d.id}`, 'payment', { status: 'paid' });
  res.json({ ok: true, payment_status: 'paid' });
});

// POST /api/payments/webhook  (Stripe -> us; raw body parsed in server.js)
r.post('/webhook', (req, res) => {
  if (!liveMode) return res.json({ received: true, mock: true });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }
  if (event.type === 'payment_intent.succeeded') {
    const id = event.data.object.metadata?.delivery_id;
    if (id) { db.deliveries.update(id, { payment_status: 'paid' }); publish(`delivery:${id}`, 'payment', { status: 'paid' }); }
  } else if (event.type === 'payment_intent.payment_failed') {
    const id = event.data.object.metadata?.delivery_id;
    if (id) db.deliveries.update(id, { payment_status: 'failed' });
  }
  res.json({ received: true });
});

export default r;
