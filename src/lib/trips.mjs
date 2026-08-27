/**
 * Datenmodell, Normalisierung und Sichtbarkeits-Logik für Urlaube.
 * Laeuft identisch im Build (Node) und im Browser - damit Server- und
 * Client-Sicht niemals auseinanderlaufen.
 */

import { parseDate, excerpt } from './format.mjs';

export const STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
};

export const STATUS_LABELS = {
  draft: 'Entwurf',
  published: 'Veröffentlicht',
  archived: 'Archiviert'
};

/** Zustände, die sich erst zur Laufzeit aus dem Zeitplan ergeben */
export const STATE_LABELS = {
  draft: 'Entwurf',
  scheduled: 'Geplant',
  live: 'Sichtbar',
  archived: 'Archiv',
  expired: 'Ausgeblendet'
};

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'urlaub';
}

export function createId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function normalizeImage(image) {
  if (!image) return null;
  if (typeof image === 'string') {
    return { id: createId('img'), src: image, thumb: '', alt: '', caption: '', width: 0, height: 0, placeholder: '' };
  }
  const src = String(image.src || image.path || image.url || '').trim();
  if (!src) return null;
  return {
    id: image.id || createId('img'),
    src,
    thumb: String(image.thumb || '').trim(),
    alt: String(image.alt || '').trim(),
    caption: String(image.caption || '').trim(),
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    placeholder: String(image.placeholder || '').trim()
  };
}

function normalizeEntry(entry, index) {
  const images = Array.isArray(entry?.images)
    ? entry.images.map(normalizeImage).filter(Boolean)
    : [];
  return {
    id: entry?.id || createId('entry'),
    date: String(entry?.date || '').trim(),
    time: String(entry?.time || '').trim(),
    title: String(entry?.title || '').trim() || `Tag ${index + 1}`,
    location: String(entry?.location || '').trim(),
    text: String(entry?.text || ''),
    images
  };
}

export function normalizeTrip(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const title = String(data.title || '').trim() || 'Ohne Titel';
  const entries = Array.isArray(data.entries) ? data.entries.map(normalizeEntry) : [];
  const status = [STATUS.DRAFT, STATUS.PUBLISHED, STATUS.ARCHIVED].includes(data.status)
    ? data.status
    : STATUS.DRAFT;

  return {
    id: data.id || createId('trip'),
    slug: slugify(data.slug || title),
    title,
    location: String(data.location || '').trim(),
    startDate: String(data.startDate || '').trim(),
    endDate: String(data.endDate || data.startDate || '').trim(),
    description: String(data.description || ''),
    coverImage: normalizeImage(data.coverImage),
    status,
    publishFrom: String(data.publishFrom || '').trim(),
    publishUntil: String(data.publishUntil || '').trim(),
    onExpire: data.onExpire === 'archive' ? 'archive' : 'hide',
    featured: Boolean(data.featured),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
    entries
  };
}

/** Chronologisch: Datum, dann Uhrzeit; Einträge ohne Datum ans Ende. */
export function sortEntriesChronologically(entries) {
  return [...entries].sort((a, b) => {
    const da = a.date ? `${a.date}T${(a.time || '00:00').padStart(5, '0')}` : '';
    const db = b.date ? `${b.date}T${(b.time || '00:00').padStart(5, '0')}` : '';
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });
}

/**
 * Effektiver Zustand eines Urlaubs zum Zeitpunkt `now`.
 * -> 'draft' | 'scheduled' | 'live' | 'archived' | 'expired'
 */
export function effectiveState(trip, now = new Date()) {
  if (!trip) return 'draft';
  if (trip.status === STATUS.DRAFT) return 'draft';

  const reference = now instanceof Date ? now : new Date(now);
  const from = trip.publishFrom ? parseDate(trip.publishFrom) : null;
  const until = trip.publishUntil ? parseDate(trip.publishUntil) : null;

  if (from && reference < from) return 'scheduled';
  if (until && reference > until) return trip.onExpire === 'archive' ? 'archived' : 'expired';
  if (trip.status === STATUS.ARCHIVED) return 'archived';
  return 'live';
}

/** Auf der Startseite sichtbar (ohne Archiv-Filter)? */
export function isPubliclyListed(trip, now = new Date()) {
  return effectiveState(trip, now) === 'live';
}

/** Ueberhaupt im Archiv-Bereich sichtbar? */
export function isArchived(trip, now = new Date()) {
  return effectiveState(trip, now) === 'archived';
}

/** Darf die Detailseite Inhalte zeigen? */
export function isReadable(trip, now = new Date()) {
  const state = effectiveState(trip, now);
  return state === 'live' || state === 'archived';
}

/** Kommt der Urlaub überhaupt in den öffentlichen Build? */
export function isDeployable(trip) {
  return trip.status !== STATUS.DRAFT;
}

export function tripYears(trip) {
  const years = new Set();
  for (const value of [trip.startDate, trip.endDate]) {
    const date = parseDate(value);
    if (date) years.add(date.getFullYear());
  }
  for (const entry of trip.entries || []) {
    const date = parseDate(entry.date);
    if (date) years.add(date.getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

export function countImages(trip) {
  let total = trip.coverImage ? 1 : 0;
  for (const entry of trip.entries || []) total += entry.images.length;
  return total;
}

/** Erstes verfuegbares Bild - Fallback für Titelbild und Open Graph */
export function firstImage(trip) {
  if (trip.coverImage?.src) return trip.coverImage;
  for (const entry of trip.entries || []) {
    if (entry.images.length) return entry.images[0];
  }
  return null;
}

export function searchText(trip) {
  const parts = [trip.title, trip.location, trip.description];
  for (const entry of trip.entries || []) {
    parts.push(entry.title, entry.location, entry.text);
    for (const image of entry.images) parts.push(image.caption, image.alt);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Kompakter Datensatz für Startseite, Suche und Filter */
export function toIndexEntry(trip) {
  const cover = firstImage(trip);
  return {
    id: trip.id,
    slug: trip.slug,
    title: trip.title,
    location: trip.location,
    startDate: trip.startDate,
    endDate: trip.endDate,
    summary: excerpt(trip.description, 180),
    cover: cover ? { src: cover.src, thumb: cover.thumb, alt: cover.alt || trip.title, width: cover.width, height: cover.height, placeholder: cover.placeholder } : null,
    status: trip.status,
    publishFrom: trip.publishFrom,
    publishUntil: trip.publishUntil,
    onExpire: trip.onExpire,
    featured: trip.featured,
    years: tripYears(trip),
    entryCount: trip.entries.length,
    imageCount: countImages(trip),
    updatedAt: trip.updatedAt,
    search: searchText(trip)
  };
}

/** Neueste zuerst (nach Startdatum, dann Titel) */
export function sortTripsByDate(trips) {
  return [...trips].sort((a, b) => {
    const da = a.startDate || '';
    const db = b.startDate || '';
    if (da === db) return String(a.title).localeCompare(String(b.title), 'de');
    return db.localeCompare(da);
  });
}

/** Freier Slug innerhalb einer Menge bereits vergebener Slugs */
export function uniqueSlug(base, taken) {
  const root = slugify(base);
  if (!taken.has(root)) return root;
  let counter = 2;
  while (taken.has(`${root}-${counter}`)) counter += 1;
  return `${root}-${counter}`;
}

export function emptyTrip(overrides = {}) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return normalizeTrip({
    title: 'Neuer Urlaub',
    startDate: iso,
    endDate: iso,
    status: STATUS.DRAFT,
    entries: [],
    ...overrides
  });
}
