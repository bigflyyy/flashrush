import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';

const hash = (pw) => bcrypt.hashSync(pw, 10);

/* Seed demo data.
   - force=false (default): only seeds if the DB is empty. Safe to call on every boot;
     it will NOT touch existing data once users exist.
   - force=true: clears everything first, then seeds. Used by `npm run seed`. */
export function seedData(force = false) {
  const alreadyHasData = db.users.all().length > 0;
  if (alreadyHasData && !force) {
    return { seeded: false, reason: 'database already has data' };
  }

  if (force) {
    db.users.clear();
    db.driverProfiles.clear();
    db.customerProfiles.clear();
    db.deliveries.clear();
    db.zones.clear();
  }

  // --- Users ---
  const marcus = db.users.insert({ role: 'driver', name: 'Marcus Kirkland', email: 'marcus@flashrush.app', password_hash: hash('password123'), phone: '+1-650-555-0142', avatar: 'MK', created_at: new Date().toISOString() });
  const jasmine = db.users.insert({ role: 'driver', name: 'Jasmine Lee', email: 'jasmine@flashrush.app', password_hash: hash('password123'), phone: '+1-650-555-0188', avatar: 'JL', created_at: new Date().toISOString() });
  const sara = db.users.insert({ role: 'driver', name: 'Sara Park', email: 'sara@flashrush.app', password_hash: hash('password123'), phone: '+1-650-555-0199', avatar: 'SP', created_at: new Date().toISOString() });
  const alex = db.users.insert({ role: 'customer', name: 'Alex Kim', email: 'alex@flashrush.app', password_hash: hash('password123'), phone: '+1-650-555-0121', avatar: 'AK', created_at: new Date().toISOString() });
  const maria = db.users.insert({ role: 'customer', name: 'Maria Lopez', email: 'maria@flashrush.app', password_hash: hash('password123'), phone: '+1-650-555-0133', avatar: 'ML', created_at: new Date().toISOString() });
  const admin = db.users.insert({ role: 'admin', name: 'Sarah Chen', email: 'sarah@flashrush.app', password_hash: hash('admin123'), phone: '+1-650-555-0100', avatar: 'SC', created_at: new Date().toISOString() });

  // --- Driver profiles ---
  db.driverProfiles.insert({ user_id: marcus.id, tier: 'Gold', rating: 4.97, total_trips: 342, accept_rate: 98, on_time_rate: 94, vehicle: '2019 Toyota Camry', plate: 'BLP 4821', status: 'delivering', lat: 37.4419, lng: -122.1430, payout_account: 'Chase ···4821' });
  db.driverProfiles.insert({ user_id: jasmine.id, tier: 'Silver', rating: 4.92, total_trips: 210, accept_rate: 95, on_time_rate: 92, vehicle: '2021 Honda Civic', plate: 'JLM 2293', status: 'delivering', lat: 37.4500, lng: -122.1700, payout_account: 'BofA ···7733' });
  db.driverProfiles.insert({ user_id: sara.id, tier: 'Gold', rating: 4.99, total_trips: 521, accept_rate: 99, on_time_rate: 97, vehicle: '2020 Tesla Model 3', plate: 'SRP 0199', status: 'available', lat: 37.4300, lng: -122.1100, payout_account: 'Chase ···0199' });

  // --- Customer profiles ---
  db.customerProfiles.insert({ user_id: alex.id, total_spent: 184.50, total_deliveries: 12, rating: 4.8, stripe_customer_id: null });
  db.customerProfiles.insert({ user_id: maria.id, total_spent: 421.00, total_deliveries: 33, rating: 4.9, stripe_customer_id: null });

  // --- Zones (surge) ---
  db.zones.insert({ name: 'Downtown Sunnyvale', surge: 2.1, active: true });
  db.zones.insert({ name: 'MV Transit', surge: 1.6, active: true });
  db.zones.insert({ name: 'PA University', surge: 1.4, active: true });
  db.zones.insert({ name: 'Los Altos Hills', surge: 1.0, active: true });
  db.zones.insert({ name: 'East Palo Alto', surge: 1.2, active: true });

  // --- A live delivery (Alex's parcel, courier Marcus) ---
  db.deliveries.insert({
    customer_id: alex.id, driver_id: marcus.id, status: 'delivering',
    pickup_address: '1235 El Camino Real, Sunnyvale', pickup_lat: 37.3770, pickup_lng: -122.0310,
    dropoff_address: '88 Oak Ave, Menlo Park', dropoff_lat: 37.4530, dropoff_lng: -122.1820,
    recipient_name: 'Daniel Reyes', recipient_phone: '+1-650-555-0177', parcel_size: 'medium',
    parcel_note: 'Documents — handle flat, do not bend.', parcel_photo: null,
    miles: 9.2, subtotal: 21.13, service_fee: 2.11, tip: 4.00, surge: 1.0, total: 27.24,
    payment_intent: 'pi_seed_demo', payment_status: 'paid', rating: null,
    created_at: new Date().toISOString(), delivered_at: null,
  });

  db.flush();
  return { seeded: true };
}

// When run directly (`npm run seed`), force a full reseed.
const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed.js');
if (isDirectRun) {
  console.log('Seeding FlashRush courier database (force)...');
  seedData(true);
  console.log('✓ Seed complete.');
  console.log('  Logins (passwords: password123; admin is admin123):');
  console.log('  - Customer: alex@flashrush.app');
  console.log('  - Driver:   marcus@flashrush.app');
  console.log('  - Admin:    sarah@flashrush.app');
}
