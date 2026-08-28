/**
 * Veröffentlichen ohne Anmeldung.
 *
 * Alle offenen Änderungen werden zu einem ZIP gebündelt, dessen Ordner genau
 * der Struktur des Repositories entsprechen. Wer den Inhalt auf der
 * Hochladen-Seite von GitHub ablegt, committet damit die richtigen Dateien
 * an die richtigen Stellen - ganz ohne Token.
 *
 * Löschungen lassen sich so nicht ausdrücken; dafür gibt es Direktverweise
 * auf die jeweilige Datei bei GitHub.
 */

import { createZip, blobToBytes, textToBytes, download } from './zip.mjs';
import { localTrips, localMedia } from './localstore.mjs';

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Was liegt gerade an? */
export async function pendingChanges() {
  const [trips, media] = await Promise.all([localTrips.all(), localMedia.all()]);
  const changed = trips.filter((entry) => !entry.deleted);
  const deleted = trips.filter((entry) => entry.deleted);
  const bytes = media.reduce((sum, item) => sum + (item.full?.size || 0) + (item.thumbBlob?.size || 0), 0);
  return { changed, deleted, media, bytes, total: changed.length + deleted.length + media.length };
}

function readme({ repo, changed, deleted }) {
  const lines = [
    'Urlaubs-Tagebuch – Änderungen veröffentlichen',
    '='.repeat(46),
    '',
    'Dieses Paket enthält den Ordner "content" mit deinen Änderungen.',
    '',
    'So kommen sie auf die Website:',
    '',
    '  1. Dieses ZIP entpacken.',
    `  2. Im Browser öffnen: ${repo.uploadUrl()}`,
    '  3. Den entpackten Ordner "content" in das Feld ziehen.',
    '  4. Unten auf "Commit changes" klicken.',
    '',
    'Danach baut GitHub die Website automatisch neu; nach etwa einer Minute',
    'ist alles öffentlich sichtbar.',
    '',
    'Enthaltene Reisen:',
    ...(changed.length ? changed.map((e) => `  - ${e.trip.title}  (content/trips/${e.slug}.json)`) : ['  (keine)']),
    ''
  ];

  if (deleted.length) {
    lines.push(
      'Noch zu löschen (das geht nur direkt bei GitHub):',
      ...deleted.map((e) => `  - ${e.trip.title}\n    ${repo.deleteUrl(`${repo.contentDir}/${e.slug}.json`)}`),
      ''
    );
  }

  return lines.join('\n');
}

/**
 * Paket schnüren und zum Herunterladen anbieten.
 * @returns {Promise<{files: number, bytes: number}>}
 */
export async function exportChanges(repo) {
  const { changed, deleted, media } = await pendingChanges();
  if (!changed.length && !media.length && !deleted.length) {
    throw new Error('Es gibt nichts zu veröffentlichen.');
  }

  const files = [];

  for (const entry of changed) {
    files.push({
      name: `content/trips/${entry.slug}.json`,
      data: textToBytes(`${JSON.stringify(entry.trip, null, 2)}\n`)
    });
  }

  for (const item of media) {
    if (item.full) {
      files.push({ name: `content/media/${item.src.replace(/^media\//, '')}`, data: await blobToBytes(item.full) });
    }
    if (item.thumbBlob && item.thumb) {
      files.push({ name: `content/media/${item.thumb.replace(/^media\//, '')}`, data: await blobToBytes(item.thumbBlob) });
    }
  }

  files.push({ name: 'LIESMICH.txt', data: textToBytes(readme({ repo, changed, deleted })) });

  const blob = createZip(files);
  download(blob, `tagebuch-${stamp()}.zip`);

  return { files: files.length, bytes: blob.size };
}

/** Einzelne Reise als JSON herunterladen - praktisch für kleine Korrekturen. */
export function exportTrip(trip) {
  const blob = new Blob([`${JSON.stringify(trip, null, 2)}\n`], { type: 'application/json' });
  download(blob, `${trip.slug}.json`);
}
