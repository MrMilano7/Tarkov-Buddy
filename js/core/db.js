/**
 * db.js — promise-based IndexedDB wrapper.
 *
 * Two object stores:
 *   "profiles" — one record per player profile (keyPath: "id")
 *   "kv"       — general key/value app state (active profile id, settings, caches)
 *
 * All persistence in the app goes through this module so the storage
 * backend can evolve (schema migrations via DB_VERSION) without touching
 * feature code.
 */
const DB_NAME = "tarkov-companion";
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Migration ladder: add a block per version bump.
      if (event.oldVersion < 1) {
        db.createObjectStore("profiles", { keyPath: "id" });
        db.createObjectStore("kv");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(storeName, mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const result = work(store);
        transaction.oncomplete = () =>
          resolve(result instanceof IDBRequest ? result.result : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

/* ---------- profiles store ---------- */
export const profiles = {
  get: (id) => tx("profiles", "readonly", (s) => s.get(id)),
  getAll: () => tx("profiles", "readonly", (s) => s.getAll()),
  put: (profile) => tx("profiles", "readwrite", (s) => s.put(profile)),
  delete: (id) => tx("profiles", "readwrite", (s) => s.delete(id)),
};

/* ---------- kv store ---------- */
export const kv = {
  get: (key) => tx("kv", "readonly", (s) => s.get(key)),
  set: (key, value) => tx("kv", "readwrite", (s) => s.put(value, key)),
  delete: (key) => tx("kv", "readwrite", (s) => s.delete(key)),
};

/** Wipe the entire database (used by "Reset save data" in Settings). */
export function destroy() {
  dbPromise = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // resolves after tabs release it
  });
}
