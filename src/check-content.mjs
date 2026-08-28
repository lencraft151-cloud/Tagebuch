#!/usr/bin/env node
/**
 * Prüft alle Reise-Dateien, bevor gebaut wird.
 *
 * Fehler brechen den Build ab (ungültiges JSON, fehlende Pflichtfelder,
 * doppelte Adressen). Warnungen werden nur gemeldet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTrip, slugify, isTombstone } from './lib/trips.mjs';
import { parseDate } from './lib/format.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const TRIPS_DIR = path.join(ROOT, config.repo?.contentDir || 'content/trips');
const MEDIA_DIR = path.join(ROOT, config.repo?.mediaDir || 'content/media');

const errors = [];
const warnings = [];

function mediaExists(src) {
  if (!src) return true;
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return true;
  return fs.existsSync(path.join(MEDIA_DIR, src.replace(/^media\//, '')));
}

if (!fs.existsSync(TRIPS_DIR)) {
  console.log(`Kein Inhaltsverzeichnis unter ${path.relative(ROOT, TRIPS_DIR)} – nichts zu prüfen.`);
  process.exit(0);
}

const files = fs.readdirSync(TRIPS_DIR).filter((name) => name.endsWith('.json'));
const slugs = new Map();
let entryCount = 0;
let imageCount = 0;
let tombstones = 0;

for (const file of files) {
  const full = path.join(TRIPS_DIR, file);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    errors.push(`${file}: ungültiges JSON – ${error.message}`);
    continue;
  }

  if (isTombstone(raw)) {
    tombstones += 1;
    continue;
  }

  const trip = normalizeTrip({ ...raw, slug: raw.slug || path.basename(file, '.json') });

  if (!raw.title) errors.push(`${file}: "title" fehlt.`);
  if (!raw.startDate) errors.push(`${file}: "startDate" fehlt.`);
  if (raw.startDate && !parseDate(raw.startDate)) errors.push(`${file}: "startDate" ist kein gültiges Datum (${raw.startDate}).`);
  if (raw.endDate && !parseDate(raw.endDate)) errors.push(`${file}: "endDate" ist kein gültiges Datum (${raw.endDate}).`);
  if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) {
    errors.push(`${file}: Enddatum (${trip.endDate}) liegt vor dem Startdatum (${trip.startDate}).`);
  }
  if (raw.status && !['draft', 'published', 'archived'].includes(raw.status)) {
    errors.push(`${file}: unbekannter Status "${raw.status}".`);
  }
  if (trip.publishFrom && trip.publishUntil && trip.publishUntil < trip.publishFrom) {
    errors.push(`${file}: Ausblendzeitpunkt liegt vor dem Veröffentlichungszeitpunkt.`);
  }

  if (slugs.has(trip.slug)) errors.push(`${file}: Adresse "${trip.slug}" wird bereits von ${slugs.get(trip.slug)} verwendet.`);
  else slugs.set(trip.slug, file);

  if (trip.slug !== slugify(trip.slug)) warnings.push(`${file}: Adresse "${trip.slug}" enthält ungewöhnliche Zeichen.`);

  if (trip.coverImage && !mediaExists(trip.coverImage.src)) {
    warnings.push(`${file}: Titelbild fehlt – ${trip.coverImage.src}`);
  }

  for (const [index, entry] of trip.entries.entries()) {
    entryCount += 1;
    if (!entry.date) warnings.push(`${file}: Eintrag ${index + 1} ("${entry.title}") hat kein Datum.`);
    else if (!parseDate(entry.date)) errors.push(`${file}: Eintrag ${index + 1} hat ein ungültiges Datum (${entry.date}).`);
    if (entry.time && !/^\d{1,2}:\d{2}$/.test(entry.time)) {
      errors.push(`${file}: Eintrag ${index + 1} hat eine ungültige Uhrzeit (${entry.time}).`);
    }
    for (const image of entry.images) {
      imageCount += 1;
      if (!mediaExists(image.src)) warnings.push(`${file}: Bild fehlt – ${image.src}`);
      if (image.thumb && !mediaExists(image.thumb)) warnings.push(`${file}: Vorschaubild fehlt – ${image.thumb}`);
    }
  }
}

console.log(`\n▸ Inhalte geprüft: ${files.length - tombstones} Reise(n), ${entryCount} Einträge, ${imageCount} Bilder${tombstones ? ` · ${tombstones} zum Löschen vorgemerkt` : ''}`);

for (const warning of warnings) console.log(`   ! ${warning}`);
for (const error of errors) console.error(`   ✗ ${error}`);

if (errors.length) {
  console.error(`\n✗ ${errors.length} Fehler gefunden. Build abgebrochen.\n`);
  process.exit(1);
}
console.log(`✓ Keine Fehler${warnings.length ? ` (${warnings.length} Hinweis${warnings.length === 1 ? '' : 'e'})` : ''}.\n`);
