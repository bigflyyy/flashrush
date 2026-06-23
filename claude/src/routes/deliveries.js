import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { publish } from '../lib/realtime.js';
import { quote, distanceMiles, SIZES } from '../lib/pricing.js';

const r = Router();

// Lifecycle for a parcel delivery.
const NEXT = {
  pending: ['accepted', 'cancelled'],
  accepted: ['picked_up', 'cancelled'],     // courier reached pickup, has the parcel
  picked_up: ['delivering', 'cancelled'],   // en route to dropoff
  delivering: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

function currentSurge() {
  const z = db.zones.find((z) => z.active).sort((a, b) => b.surge - a.surge)[0];
  return z ? z.surge : 1.0;
}

// POST /api/deliveries/quote  (public — no auth, so customers can price before signing in)
// body: { pickup:{lat,lng,address}, dropoff:{lat,lng,address}, size, tip }
r.post('/quote', (req, res) => {
  const { pickup, dropoff, size = 'small', tip = 0 } = req.body || {};
  if (!pickup?.lat || !dropoff?.lat) {
    return res.status(400).json({ error: 'pickup and dropoff coordinates required' });
  }
  if (!SIZES.includes(size)) return res.status(400).json({ error: `size must be one of ${SIZES.join(', ')}` });

  const miles = distanceMiles(pickup, dropoff);
  res.json({ quote: quote({ miles, size, surge: currentSurge(), tip }) });
});

// POST /api/deliveries  (customer books a courier)
r.post('/', requireAuth, requireRole('customer'), (req, res) => {
  const {
    pickup, dropoff, size = 'small', tip = 0,
    recipient_name, recipient_phone, parcel_note, parcel_photo,
  } = req.body || {};

  if (!pickup?.lat || !dropoff?.lat) {
    return res.status(400).json({ error: 'pickup and dropoff coordinates required' });
  }
  if (!SIZES.includes(size)) return res.status(400).json({ error: `size must be one of ${SIZES.join(', ')}` });

  const miles = distanceMiles(pickup, dropoff);
  const surge = currentSurge();
  const q = quote({ miles, size, surge, tip });

  // Guard photo size: base64 data URLs are stored inline, so cap them (~550KB raw)
  // to keep the database lean. (Future: move photos to external object storage.)
  if (parcel_photo && parcel_photo.length > 550000) {
    return res.status(413).json({ error: 'Photo too large. Please use a smaller image.' });
  }

  const delivery = db.deliveries.insert({
    customer_id: req.user.id,
    driver_id: null,
    status: 'pending',
    pickup_address: pickup.address || null,
    pickup_lat: pickup.lat, pickup_lng: pickup.lng,
    dropoff_address: dropoff.address || null,
    dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng,
    recipient_name: recipient_name || null,
    recipient_phone: recipient_phone || null,
    parcel_size: size,
    parcel_note: parcel_note || null,
    parcel_photo: parcel_photo || null,      // data URL or hosted URL
    miles: q.miles,
    subtotal: q.subtotal,
    service_fee: q.serviceFee,
    tip: q.tip,
    surge: q.surge,
    total: q.total,
    payment_intent: null,
    payment_status: 'unpaid',
    rating: null,
    created_at: new Date().toISOString(),
    delivered_at: null,
  });

  publish('drivers:queue', 'delivery_created', {
    id: delivery.id, pickup: delivery.pickup_address, dropoff: delivery.dropoff_address,
    size, total: q.total, miles: q.miles,
  });
  res.status(201).json({ delivery });
});

// GET /api/deliveries  (role-scoped)
r.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'customer') {
    rows = db.deliveries.find((d) => d.customer_id === req.user.id);
  } else if (req.user.role === 'driver') {
    rows = db.deliveries.find((d) => d.driver_id === req.user.id || d.status === 'pending');
  } else {
    rows = db.deliveries.all();
  }
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json({ deliveries: rows });
});

// GET /api/deliveries/:id
r.get('/:id', requireAuth, (req, res) => {
  const d = db.deliveries.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  const owns = req.user.role === 'admin'
    || d.customer_id === req.user.id
    || d.driver_id === req.user.id
    || (req.user.role === 'driver' && d.status === 'pending');
  if (!owns) return res.status(403).json({ error: 'Forbidden' });
  res.json({ delivery: d });
});

// POST /api/deliveries/:id/accept  (courier claims the job)
r.post('/:id/accept', requireAuth, requireRole('driver'), (req, res) => {
  const d = db.deliveries.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (d.status !== 'pending') return res.status(409).json({ error: 'No longer available' });

  db.deliveries.update(d.id, { driver_id: req.user.id, status: 'accepted' });
  const prof = db.driverProfiles.one((p) => p.user_id === req.user.id);
  if (prof) db.driverProfiles.update(prof.id, { status: 'delivering' });

  publish(`delivery:${d.id}`, 'status', { status: 'accepted', driver: req.user.name });
  publish('drivers:queue', 'delivery_taken', { id: d.id });
  res.json({ delivery: db.deliveries.get(d.id) });
});

// POST /api/deliveries/:id/confirm-size  (courier confirms or adjusts size at pickup)
// body: { size }  — if size changes, the price is recomputed and the customer is notified.
r.post('/:id/confirm-size', requireAuth, requireRole('driver'), (req, res) => {
  const d = db.deliveries.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (d.driver_id !== req.user.id) return res.status(403).json({ error: 'Not your delivery' });
  const { size, reason } = req.body || {};
  if (!SIZES.includes(size)) return res.status(400).json({ error: `size must be one of ${SIZES.join(', ')}` });

  const patch = { courier_confirmed_size: size, size_confirmed_at: new Date().toISOString() };

  // If the courier's size differs from the booked size, recompute the price and
  // record the difference. This is informational — the customer is shown the change
  // and reason, but no approval is required.
  if (size !== d.parcel_size) {
    const q = quote({ miles: d.miles, size, surge: d.surge || 1.0, tip: d.tip || 0 });
    const oldTotal = d.total;
    patch.parcel_size = size;
    patch.subtotal = q.subtotal;
    patch.service_fee = q.serviceFee;
    patch.total = q.total;
    patch.size_adjusted = true;
    patch.price_difference = +(q.total - oldTotal).toFixed(2); // positive = customer owes more
    patch.original_total = oldTotal;
    patch.adjustment_reason = reason || 'Courier confirmed a different size at pickup';
  }

  db.deliveries.update(d.id, patch);
  publish(`delivery:${d.id}`, 'size_confirmed', {
    size, adjusted: size !== d.parcel_size, total: patch.total || d.total,
    priceDifference: patch.price_difference || 0, reason: patch.adjustment_reason || '',
  });
  res.json({ delivery: db.deliveries.get(d.id) });
});

// PATCH /api/deliveries/:id/status
function metersBetweenSrv(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const GEOFENCE_M = 50;

r.patch('/:id/status', requireAuth, (req, res) => {
  const { status, lat, lng } = req.body || {};
  const d = db.deliveries.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });

  const isDriver = req.user.role === 'driver' && d.driver_id === req.user.id;
  const isCustomerCancel = req.user.role === 'customer' && d.customer_id === req.user.id && status === 'cancelled';
  if (!isDriver && !isCustomerCancel && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!NEXT[d.status]?.includes(status)) {
    return res.status(400).json({ error: `Cannot move from ${d.status} to ${status}` });
  }

  // Geofence enforcement (drivers only; admins bypass). Pickup near pickup, delivered near dropoff.
  // A server-side TEST_MODE env flag can disable the geofence for end-to-end testing.
  const geofenceOn = process.env.GEOFENCE_DISABLED !== 'true';
  if (isDriver && req.user.role !== 'admin' && geofenceOn) {
    const fence = status === 'picked_up' ? { lat: d.pickup_lat, lng: d.pickup_lng, what: 'pickup' }
                : status === 'delivered' ? { lat: d.dropoff_lat, lng: d.dropoff_lng, what: 'dropoff' } : null;
    if (fence) {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: `Location required to mark ${status}` });
      }
      const dist = metersBetweenSrv(lat, lng, fence.lat, fence.lng);
      if (dist > GEOFENCE_M) {
        return res.status(403).json({ error: `Too far from ${fence.what} (${Math.round(dist)}m). Must be within ${GEOFENCE_M}m.` });
      }
    }
  }

  const patch = { status };
  if (status === 'delivered') patch.delivered_at = new Date().toISOString();
  db.deliveries.update(d.id, patch);

  if (status === 'delivered' && d.driver_id) {
    const dp = db.driverProfiles.one((p) => p.user_id === d.driver_id);
    if (dp) db.driverProfiles.update(dp.id, { status: 'available', total_trips: dp.total_trips + 1 });
    const cp = db.customerProfiles.one((p) => p.user_id === d.customer_id);
    if (cp) db.customerProfiles.update(cp.id, {
      total_deliveries: cp.total_deliveries + 1, total_spent: +(cp.total_spent + d.total).toFixed(2),
    });
  }

  publish(`delivery:${d.id}`, 'status', { status });
  res.json({ delivery: db.deliveries.get(d.id) });
});

// POST /api/deliveries/:id/location  (courier GPS ping → live tracking)
r.post('/:id/location', requireAuth, requireRole('driver'), (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng (numbers) required' });
  }
  const d = db.deliveries.get(req.params.id);
  if (!d || d.driver_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const dp = db.driverProfiles.one((p) => p.user_id === req.user.id);
  if (dp) db.driverProfiles.update(dp.id, { lat, lng });
  publish(`delivery:${d.id}`, 'location', { lat, lng, at: Date.now() });
  res.json({ ok: true });
});

// POST /api/deliveries/:id/rate
r.post('/:id/rate', requireAuth, requireRole('customer'), (req, res) => {
  const n = parseInt(req.body?.rating, 10);
  if (!(n >= 1 && n <= 5)) return res.status(400).json({ error: 'rating must be 1-5' });
  const d = db.deliveries.get(req.params.id);
  if (!d || d.customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (d.status !== 'delivered') return res.status(400).json({ error: 'Not delivered yet' });

  db.deliveries.update(d.id, { rating: n });
  if (d.driver_id) {
    const rated = db.deliveries.find((x) => x.driver_id === d.driver_id && x.rating);
    const avg = rated.reduce((s, x) => s + x.rating, 0) / rated.length;
    const dp = db.driverProfiles.one((p) => p.user_id === d.driver_id);
    if (dp) db.driverProfiles.update(dp.id, { rating: +avg.toFixed(2) });
  }
  res.json({ ok: true, rating: n });
});

export default r;
