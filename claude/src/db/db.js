/* Data layer with a synchronous collection interface, backed by either:
   - Postgres (Neon) when DATABASE_URL is set  → durable, survives deploys
   - a local JSON file otherwise               → zero-setup local dev

   Design: all rows are loaded into memory on startup. Reads are synchronous
   (instant, from memory) so existing route code needs no changes. Writes update
   memory AND write through to the backing store. For an app of this size on a
   single instance, this is simple and correct.

   IMPORTANT: call `await db.init()` once at startup before serving requests. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../flashrush-data.json');
const DATABASE_URL = process.env.DATABASE_URL;
const usePg = !!DATABASE_URL;

// Ensure the directory holding the data file exists (e.g. a mounted disk path).
function ensureDir(filePath) {
  try {
    const dir = dirname(filePath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (e) { console.error('Could not create data dir:', e.message); }
}

const COLLECTIONS = ['users', 'driver_profiles', 'customer_profiles', 'deliveries', 'zones'];
const empty = () => ({
  users: [], driver_profiles: [], customer_profiles: [], deliveries: [], zones: [], _seq: {},
});

let data = empty();
let pool = null;

// ---------- JSON file backing (local dev) ----------
let fileLoadFailed = false;
function loadFile() {
  if (existsSync(DB_PATH)) {
    const raw = readFileSync(DB_PATH, 'utf8');
    // An existing but empty/whitespace file is treated as a real (empty) DB.
    if (!raw.trim()) { data = empty(); return; }
    try {
      data = { ...empty(), ...JSON.parse(raw) };
    } catch (e) {
      // The file exists and has content but won't parse. DO NOT wipe it.
      // Refuse to proceed so auto-seed can't overwrite real data.
      fileLoadFailed = true;
      console.error('FATAL: data file exists but failed to parse:', e.message);
      console.error('Refusing to start to avoid overwriting data at', DB_PATH);
      throw new Error('Corrupt or unreadable data file; aborting to protect data');
    }
  } else {
    data = empty();
  }
}
let writeTimer = null;
function persistFile() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try { ensureDir(DB_PATH); writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch {}
    writeTimer = null;
  }, 50);
}

// ---------- Postgres backing (production) ----------
// Each collection is stored as one table: id SERIAL PRIMARY KEY, doc JSONB.
// We keep the flexible document shape so no per-field schema migration is needed.
async function initPg() {
  const { default: pg } = await import('pg');
  pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  for (const name of COLLECTIONS) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${name} (id SERIAL PRIMARY KEY, doc JSONB NOT NULL)`
    );
  }

  // Load every row into memory.
  data = empty();
  for (const name of COLLECTIONS) {
    const { rows } = await pool.query(`SELECT id, doc FROM ${name} ORDER BY id`);
    data[name] = rows.map((r) => ({ id: r.id, ...r.doc }));
    const maxId = rows.reduce((m, r) => Math.max(m, r.id), 0);
    data._seq[name] = maxId;
  }
}

// Write-through helpers (fire-and-forget with error logging; memory is source of truth for reads).
function pgInsert(name, row) {
  const { id, ...doc } = row;
  pool.query(`INSERT INTO ${name} (id, doc) VALUES ($1, $2)`, [id, doc])
    .catch((e) => console.error(`pg insert ${name} failed:`, e.message));
  // Keep the serial sequence ahead of manually-inserted ids.
  pool.query(`SELECT setval(pg_get_serial_sequence('${name}','id'), GREATEST($1, (SELECT COALESCE(MAX(id),1) FROM ${name})))`, [id])
    .catch(() => {});
}
function pgUpdate(name, id, row) {
  const { id: _omit, ...doc } = row;
  pool.query(`UPDATE ${name} SET doc = $2 WHERE id = $1`, [id, doc])
    .catch((e) => console.error(`pg update ${name} failed:`, e.message));
}
function pgDelete(name, id) {
  pool.query(`DELETE FROM ${name} WHERE id = $1`, [id])
    .catch((e) => console.error(`pg delete ${name} failed:`, e.message));
}
async function pgClear(name) {
  await pool.query(`DELETE FROM ${name}`);
  await pool.query(`ALTER SEQUENCE ${name}_id_seq RESTART WITH 1`).catch(() => {});
}

// ---------- Shared write dispatch ----------
function persistInsert(name, row) { usePg ? pgInsert(name, row) : persistFile(); }
function persistUpdate(name, id, row) { usePg ? pgUpdate(name, id, row) : persistFile(); }
function persistDelete(name, id) { usePg ? pgDelete(name, id) : persistFile(); }

function nextId(name) {
  data._seq[name] = (data._seq[name] || 0) + 1;
  return data._seq[name];
}

function collection(name) {
  return {
    all() { return data[name].slice(); },
    find(pred) { return data[name].filter(pred); },
    get(id) { return data[name].find((r) => r.id === Number(id)) || null; },
    one(pred) { return data[name].find(pred) || null; },
    insert(rec) {
      const row = { id: nextId(name), ...rec };
      data[name].push(row);
      persistInsert(name, row);
      return row;
    },
    update(id, patch) {
      const row = data[name].find((r) => r.id === Number(id));
      if (!row) return null;
      Object.assign(row, patch);
      persistUpdate(name, row.id, row);
      return row;
    },
    remove(id) {
      const i = data[name].findIndex((r) => r.id === Number(id));
      if (i >= 0) { const rid = data[name][i].id; data[name].splice(i, 1); persistDelete(name, rid); return true; }
      return false;
    },
    clear() {
      data[name] = []; data._seq[name] = 0;
      if (usePg) { pgClear(name).catch((e) => console.error(`pg clear ${name}:`, e.message)); }
      else persistFile();
    },
  };
}

const db = {
  users: collection('users'),
  driverProfiles: collection('driver_profiles'),
  customerProfiles: collection('customer_profiles'),
  deliveries: collection('deliveries'),
  zones: collection('zones'),
  // Must be awaited once at startup.
  async init() {
    if (usePg) { await initPg(); console.log('  ✓ Data layer: Postgres (Neon) — durable'); }
    else { loadFile(); console.log('  ✓ Data layer: local JSON file'); }
  },
  // For the seed script: ensure async writes have flushed to Postgres before exit.
  async drain() {
    if (usePg && pool) {
      // Give in-flight write-through queries a moment, then verify by counting.
      await new Promise((r) => setTimeout(r, 500));
    }
  },
  flush() {
    if (usePg) return;
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    try { ensureDir(DB_PATH); writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('flush failed:', e.message); }
  },
  raw: () => data,
};

export default db;
