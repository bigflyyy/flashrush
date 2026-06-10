/* Pure-JavaScript datastore — zero native dependencies, no build tools.
   Persists to a single JSON file. Good for v1 / small scale; the access
   pattern (collections of records) ports cleanly to Postgres/Mongo later.

   Concurrency model: single Node process, synchronous in-memory operations,
   debounced write-to-disk. Fine for a v1 courier app. */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../flashrush-data.json');

const empty = () => ({
  users: [],
  driver_profiles: [],
  customer_profiles: [],
  deliveries: [],     // the core entity: a parcel job
  zones: [],
  _seq: {},           // per-collection autoincrement counters
});

let data = empty();

function load() {
  if (existsSync(DB_PATH)) {
    try { data = { ...empty(), ...JSON.parse(readFileSync(DB_PATH, 'utf8')) }; }
    catch { data = empty(); }
  }
}
load();

let writeTimer = null;
function persist() {
  // Debounce disk writes so bursts of mutations don't thrash the filesystem.
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    writeTimer = null;
  }, 50);
}

function flush() {
  // Synchronous write — used by the seed script so data is on disk before exit.
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextId(collection) {
  data._seq[collection] = (data._seq[collection] || 0) + 1;
  return data._seq[collection];
}

/* Minimal collection helper. Records are plain objects with an `id`. */
function collection(name) {
  return {
    all() { return data[name].slice(); },
    find(pred) { return data[name].filter(pred); },
    get(id) { return data[name].find((r) => r.id === Number(id)) || null; },
    one(pred) { return data[name].find(pred) || null; },
    insert(rec) {
      const row = { id: nextId(name), ...rec };
      data[name].push(row);
      persist();
      return row;
    },
    update(id, patch) {
      const row = data[name].find((r) => r.id === Number(id));
      if (!row) return null;
      Object.assign(row, patch);
      persist();
      return row;
    },
    remove(id) {
      const i = data[name].findIndex((r) => r.id === Number(id));
      if (i >= 0) { data[name].splice(i, 1); persist(); return true; }
      return false;
    },
    clear() { data[name] = []; data._seq[name] = 0; persist(); },
  };
}

const db = {
  users: collection('users'),
  driverProfiles: collection('driver_profiles'),
  customerProfiles: collection('customer_profiles'),
  deliveries: collection('deliveries'),
  zones: collection('zones'),
  flush,
  raw: () => data,
};

export default db;
