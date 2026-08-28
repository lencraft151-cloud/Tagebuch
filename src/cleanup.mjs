#!/usr/bin/env node
/**
 * Räumt das Repository auf - läuft in GitHub Actions vor dem Build.
 *
 * Der Verwaltungsbereich im Browser kann Dateien nur hinzufügen, nicht
 * löschen. Was dort gelöscht wird, kommt deshalb als Markierung an
 * ("deleted": true). Dieses Skript führt das Löschen wirklich aus - und
 * entfernt gleich auch Bilder, die von keiner Reise mehr verwendet werden.
 *
 * Aufruf:
 *   node src/cleanup.mjs           löscht und meldet
 *   node src/cleanup.mjs --dry-run zeigt nur, was passieren würde
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTrip, isTombstone } from './lib/trips.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

const TRIPS_DIR = path.join(ROOT, config.repo?.contentDir || 'content/trips');
const MEDIA_DIR = path.join(ROOT, config.repo?.mediaDir || 'content/media');
const REMOVE_UNUSED_MEDIA = config.cleanup?.unusedMedia !== false;

const dryRun = process.argv.includes('--dry-run');
const removed = [];

function remove(file, reason) {
  removed.push({ file: path.relative(ROOT, file), reason });
  if (!dryRun) fs.rmSync(file, { force: true });
}

/* ------------------------------------------------ Vorgemerkte Löschungen -- */

const trips = [];

if (fs.existsSync(TRIPS_DIR)) {
  for (const name of fs.readdirSync(TRIPS_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const full = path.join(TRIPS_DIR, name);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      console.error(`   ! ${name} ist kein gültiges JSON - bleibt unangetastet.`);
      continue;
    }

    if (isTombstone(raw)) {
      remove(full, 'zum Löschen vorgemerkt');
      continue;
    }
    trips.push(normalizeTrip(raw));
  }
}

/* ------------------------------------------------ Nicht genutzte Bilder --- */

if (REMOVE_UNUSED_MEDIA && fs.existsSync(MEDIA_DIR)) {
  const used = new Set();
  const add = (image) => {
    if (image?.src) used.add(path.basename(image.src));
    if (image?.thumb) used.add(path.basename(image.thumb));
  };
  for (const trip of trips) {
    add(trip.coverImage);
    for (const entry of trip.entries) for (const image of entry.images) add(image);
  }

  for (const name of fs.readdirSync(MEDIA_DIR)) {
    if (name.startsWith('.')) continue;
    const full = path.join(MEDIA_DIR, name);
    if (fs.statSync(full).isDirectory()) continue;
    if (!used.has(name)) remove(full, 'von keiner Reise verwendet');
  }
}

/* ----------------------------------------------------------- Ausgabe ----- */

console.log(`\n▸ Aufräumen${dryRun ? ' (Probelauf)' : ''}`);

if (!removed.length) {
  console.log('   Nichts zu tun.\n');
  process.exit(0);
}

for (const item of removed) console.log(`   − ${item.file}  (${item.reason})`);
console.log(`\n✓ ${removed.length} Datei(en) ${dryRun ? 'wären entfernt worden' : 'entfernt'}.\n`);

// Der Workflow prüft diese Ausgabe, um nur bei Bedarf zu committen.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `removed=${removed.length}\n`);
}
