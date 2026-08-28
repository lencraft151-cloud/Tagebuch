/**
 * Lokaler Zwischenspeicher für unveröffentlichte Änderungen.
 *
 * Alles, was im Verwaltungsbereich bearbeitet wird, landet zuerst hier -
 * in der IndexedDB dieses Browsers. Erst beim Veröffentlichen wird daraus
 * ein Paket, das zu GitHub hochgeladen wird.
 *
 * IndexedDB statt localStorage, weil Bilder als Blob gespeichert werden und
 * localStorage nur Text kann (und bei ~5 MB endet).
 */

const DB_NAME = 'tagebuch-admin';
const DB_VERSION = 1;
const TRIPS = 'trips';   // slug -> { slug, trip, deleted, updatedAt }
const MEDIA = 'media';   // src   -> { src, thumb, full, thumbBlob, width, height }

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRIPS)) db.createObjectStore(TRIPS, { keyPath: 'slug' });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'src' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB nicht verfügbar.'));
  });
  return dbPromise;
}

function run(storeName, mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve();
    }
  }));
}

/* ------------------------------------------------------------- Reisen --- */

export const localTrips = {
  all: () => run(TRIPS, 'readonly', (store) => store.getAll()),
  get: (slug) => run(TRIPS, 'readonly', (store) => store.get(slug)),
  put: (slug, trip) => run(TRIPS, 'readwrite', (store) =>
    store.put({ slug, trip, deleted: false, updatedAt: new Date().toISOString() })),
  markDeleted: (slug, trip) => run(TRIPS, 'readwrite', (store) =>
    store.put({ slug, trip, deleted: true, updatedAt: new Date().toISOString() })),
  remove: (slug) => run(TRIPS, 'readwrite', (store) => store.delete(slug)),
  clear: () => run(TRIPS, 'readwrite', (store) => store.clear())
};

/* ------------------------------------------------------------- Bilder --- */

export const localMedia = {
  all: () => run(MEDIA, 'readonly', (store) => store.getAll()),
  get: (src) => run(MEDIA, 'readonly', (store) => store.get(src)),
  put: (entry) => run(MEDIA, 'readwrite', (store) => store.put(entry)),
  remove: (src) => run(MEDIA, 'readwrite', (store) => store.delete(src)),
  clear: () => run(MEDIA, 'readwrite', (store) => store.clear())
};

/** Alles verwerfen - nach dem Veröffentlichen oder auf Wunsch. */
export async function clearAll() {
  await localTrips.clear();
  await localMedia.clear();
}

/** Wie viel Platz belegen die offenen Änderungen? */
export async function usage() {
  const media = await localMedia.all();
  const bytes = media.reduce((sum, item) => sum + (item.full?.size || 0) + (item.thumbBlob?.size || 0), 0);
  const trips = await localTrips.all();
  return { images: media.length, trips: trips.length, bytes };
}

export function isAvailable() {
  return typeof indexedDB !== 'undefined';
}
