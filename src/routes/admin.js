import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth, requireRole('admin'));

const today = () => new Date().toISOString().slice(0, 10);

// GET /api/admin/overview
r.get('/overview', (req, res) => {
  const all = db.deliveries.all();
  const active = all.filter((d) => ['accepted', 'picked_up', 'delivering'].includes(d.status)).length;
  const online = db.driverProfiles.find((p) => p.status !== 'offline').length;
  const revenueToday = all.filter((d) => (d.created_at || '').slice(0, 10) === today())
    .reduce((s, d) => s + d.total, 0);
  const pending = all.filter((d) => d.status === 'pending').length;
  const delivered = all.filter((d) => d.status === 'delivered');
  const avgMiles = delivered.length ? delivered.reduce((s, d) => s + d.miles, 0) / delivered.length : 0;
  res.json({
    activeDeliveries: active,
    onlineDrivers: online,
    revenueToday: +revenueToday.toFixed(2),
    pending,
    avgMiles: +avgMiles.toFixed(1),
  });
});

// GET /api/admin/drivers
r.get('/drivers', (req, res) => {
  const rows = db.driverProfiles.all().map((p) => {
    const u = db.users.get(p.user_id) || {};
    return {
      id: u.id, name: u.name, email: u.email, avatar: u.avatar,
      tier: p.tier, rating: p.rating, total_trips: p.total_trips,
      accept_rate: p.accept_rate, on_time_rate: p.on_time_rate,
      vehicle: p.vehicle, plate: p.plate, status: p.status, lat: p.lat, lng: p.lng,
    };
  }).sort((a, b) => b.rating - a.rating);
  res.json({ drivers: rows });
});

// GET /api/admin/customers
r.get('/customers', (req, res) => {
  const rows = db.customerProfiles.all().map((p) => {
    const u = db.users.get(p.user_id) || {};
    return {
      id: u.id, name: u.name, email: u.email, avatar: u.avatar,
      total_spent: p.total_spent, total_deliveries: p.total_deliveries, rating: p.rating,
    };
  }).sort((a, b) => b.total_spent - a.total_spent);
  res.json({ customers: rows });
});

// GET /api/admin/zones
r.get('/zones', (req, res) => {
  res.json({ zones: db.zones.all().sort((a, b) => b.surge - a.surge) });
});

// PATCH /api/admin/zones/:id  { surge, active }
r.patch('/zones/:id', (req, res) => {
  const z = db.zones.get(req.params.id);
  if (!z) return res.status(404).json({ error: 'Zone not found' });
  const { surge, active } = req.body || {};
  const updated = db.zones.update(z.id, {
    surge: surge ?? z.surge,
    active: active === undefined ? z.active : !!active,
  });
  res.json({ zone: updated });
});

// GET /api/admin/revenue
r.get('/revenue', (req, res) => {
  const delivered = db.deliveries.find((d) => d.status === 'delivered');
  const totals = delivered.reduce((acc, d) => {
    acc.service += d.service_fee; acc.tips += d.tip; acc.gross += d.total; return acc;
  }, { service: 0, tips: 0, gross: 0 });
  for (const k in totals) totals[k] = +totals[k].toFixed(2);

  const byDay = {};
  for (const d of db.deliveries.all()) {
    const day = (d.created_at || '').slice(0, 10);
    byDay[day] = (byDay[day] || 0) + d.total;
  }
  const daily = Object.entries(byDay).map(([day, total]) => ({ day, total: +total.toFixed(2) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 14);
  res.json({ totals, daily });
});

export default r;
