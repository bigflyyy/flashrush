import { Router } from 'express';
import db from '../db/db.js';
import { signToken, hashPassword, checkPassword } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();

// POST /api/auth/register
r.post('/register', (req, res) => {
  const { role = 'customer', name, first_name, last_name, email, password, phone } = req.body || {};
  // Allow either a combined `name` or first/last parts.
  const fullName = name || [first_name, last_name].filter(Boolean).join(' ').trim();
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (!['customer', 'driver'].includes(role)) {
    return res.status(400).json({ error: 'role must be customer or driver' });
  }
  if (db.users.one((u) => u.email === email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const avatar = fullName.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const user = db.users.insert({
    role, name: fullName, first_name: first_name || null, last_name: last_name || null,
    email, password_hash: hashPassword(password),
    phone: phone || null, avatar, created_at: new Date().toISOString(),
  });

  if (role === 'driver') {
    db.driverProfiles.insert({
      user_id: user.id, tier: 'Bronze', rating: 5.0, total_trips: 0,
      accept_rate: 100, on_time_rate: 100, vehicle: null, plate: null,
      status: 'offline', lat: null, lng: null, payout_account: null,
    });
  } else {
    db.customerProfiles.insert({
      user_id: user.id, total_spent: 0, total_deliveries: 0, rating: 5.0, stripe_customer_id: null,
    });
  }

  const pub = { id: user.id, role, name: fullName, email };
  res.status(201).json({ token: signToken(pub), user: pub });
});

// POST /api/auth/login
r.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const row = db.users.one((u) => u.email === email);
  if (!row || !checkPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const pub = { id: row.id, role: row.role, name: row.name, email: row.email };
  res.json({ token: signToken(pub), user: { ...pub, avatar: row.avatar, phone: row.phone } });
});

// GET /api/auth/me
r.get('/me', requireAuth, (req, res) => {
  const row = db.users.get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const { password_hash, ...safe } = row;

  let profile = null;
  if (row.role === 'driver') profile = db.driverProfiles.one((p) => p.user_id === row.id);
  else if (row.role === 'customer') profile = db.customerProfiles.one((p) => p.user_id === row.id);

  res.json({ user: safe, profile });
});

export default r;
