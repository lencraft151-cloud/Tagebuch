/**
 * Verwaltungsbereich - ohne Anmeldung bei GitHub.
 *
 * Ablauf:
 *   1. Lesen   - die Inhalte kommen unverschlüsselt und ohne Token aus dem
 *                öffentlichen Repository (raw.githubusercontent.com) sowie
 *                aus data/manifest.json der eigenen Website.
 *   2. Ändern  - alles Bearbeitete liegt zunächst in der IndexedDB dieses
 *                Browsers. Nichts geht dabei ins Netz.
 *   3. Veröffentlichen - die offenen Änderungen werden als ZIP ausgegeben und
 *                auf der Hochladen-Seite von GitHub abgelegt. GitHub Actions
 *                baut die Website danach automatisch neu.
 *
 * Der Verzicht auf einen Token bedeutet: Dieser Bereich kann nichts schreiben.
 * Der letzte Schritt passiert bewusst bei GitHub, wo du ohnehin angemeldet
 * bist. Damit liegt nirgends ein Zugangsschlüssel herum.
 */

import { prepareImage, storeImage, createMediaResolver, isSupportedImage, formatBytes } from './media.mjs';
import { Repo, RepoError } from './repo.mjs';
import { localTrips, localMedia, clearAll, isAvailable } from './localstore.mjs';
import { pendingChanges, exportChanges, exportTrip } from './publish.mjs';
import {
  normalizeTrip,
  emptyTrip,
  slugify,
  uniqueSlug,
  effectiveState,
  STATE_LABELS,
  sortEntriesChronologically,
  createId,
  countImages,
  firstImage
} from '../lib/trips.mjs';
import { formatDateRange, pluralize } from '../lib/format.mjs';
import { $, $$, el, escapeHtml, icons, toast, setLoading, setLoadingText, confirmDialog, debounce, initTheme, humanDate, humanDateTime } from './ui.mjs';

const config = window.__ADMIN_CONFIG__ || {};
const repoConfig = config.repo || {};

const repo = new Repo({
  owner: repoConfig.owner,
  name: repoConfig.name,
  branch: repoConfig.branch || 'main',
  contentDir: repoConfig.contentDir || 'content/trips',
  mediaDir: repoConfig.mediaDir || 'content/media',
  base: config.base || '/'
});

const media = createMediaResolver(repo);

const state = {
  trips: [],          // { trip, file, source: 'repo' | 'lokal', dirty, deleted }
  current: null,
  currentFile: '',
  dirty: false,
  search: '',
  statusFilter: '',
  openEntries: new Set()
};

/* ======================================================== Hilfsfunktionen == */

/** Pfad auf der Website (relativ) - taugt direkt als href. */
const publicUrl = (slug) => `${config.base || '/'}reisen/${slug}/`;

/**
 * Vollständige URL zum Anzeigen und Teilen.
 * Aus siteUrl wird nur der Ursprung genommen: Steht dort bereits ein Pfad
 * (z. B. ".../Tagebuch"), würde ein simples Aneinanderhängen den Basispfad
 * doppelt einsetzen.
 */
const siteOrigin = (() => {
  try {
    return new URL(config.siteUrl).origin;
  } catch {
    return '';
  }
})();
const absolutePublicUrl = (slug) => `${siteOrigin}${publicUrl(slug)}`;

function markDirty(dirty = true) {
  state.dirty = dirty;
  const dot = $('[data-dirty]');
  if (dot) dot.hidden = !dirty;
  const save = $('[data-save]');
  if (save) save.disabled = !dirty;
}

function nowStamp() {
  return new Date().toISOString();
}

/** Bildquellen im DOM auflösen (lokal Zwischengespeichertes bevorzugt). */
async function hydrateImages(scope = document) {
  const nodes = $$('img[data-src]', scope);
  await Promise.all(nodes.map(async (img) => {
    const src = img.dataset.src;
    img.removeAttribute('data-src');
    const url = await media.resolve(src);
    if (!url) return;
    img.src = url;
    // Noch nicht gebaute, aber bereits committete Bilder liegen nur bei GitHub.
    img.addEventListener('error', () => {
      const fallback = media.fallback(src);
      if (fallback && img.src !== fallback) img.src = fallback;
    }, { once: true });
  }));
}

/* ============================================================== Anmeldung == */

/**
 * PIN-Prüfung.
 *
 * Hinter der PIN liegt kein Geheimnis: Der Bereich kann von sich aus nichts
 * veröffentlichen, das geht nur über deinen GitHub-Zugang. Sie ist deshalb
 * ein Riegel gegen versehentliches Verstellen, keine echte Zugangssperre.
 * Gespeichert ist nur ein gesalzener SHA-256-Hash, damit die Ziffern nicht
 * offen im Quelltext stehen.
 */
async function checkPin(pin) {
  const { pinSalt = '', pinHash = '' } = config.admin || {};
  if (!pinHash) return true;
  if (!globalThis.crypto?.subtle) {
    throw new Error('Die Seite muss über HTTPS geöffnet werden.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pinSalt}:${pin}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === pinHash;
}

function showLogin(message = '') {
  $('[data-view="login"]').hidden = false;
  $('[data-view="app"]').hidden = true;
  const error = $('[data-login-error]');
  error.hidden = !message;
  error.textContent = message;
  const field = $('[data-pin-input]');
  if (field) {
    field.value = '';
    field.focus();
  }
}

function showApp() {
  $('[data-view="login"]').hidden = true;
  $('[data-view="app"]').hidden = false;
  $('[data-repo-label]').textContent = `${repo.path} · ${repo.branch}`;
  try {
    sessionStorage.setItem('tagebuch:entsperrt', '1');
  } catch { /* nicht schlimm */ }
}

async function unlock(pin) {
  setLoading(true, 'Wird geprüft …');
  try {
    if (!(await checkPin(pin))) {
      showLogin('PIN falsch.');
      return;
    }
    showApp();
    await loadTrips();
  } catch (error) {
    showLogin(error.message || 'Anmeldung fehlgeschlagen.');
  } finally {
    setLoading(false);
  }
}

/* =============================================================== Laden ===== */

/**
 * Reisen laden: Grundlage ist das Repository, darüber liegen die noch nicht
 * veröffentlichten Änderungen aus diesem Browser.
 */
async function loadTrips() {
  setLoading(true, 'Reisen werden geladen …');
  try {
    let manifest = null;
    try {
      manifest = await repo.loadManifest();
      if (manifest?.repo?.branch) repo.branch = manifest.repo.branch;
    } catch (error) {
      toast(error.message, 'error');
    }

    const remote = [];
    for (const item of manifest?.trips || []) {
      try {
        const raw = await repo.loadTrip(item.file);
        remote.push({ trip: normalizeTrip(raw), file: item.file, source: 'repo' });
      } catch (error) {
        console.error(`Fehler bei ${item.file}:`, error);
        toast(`„${item.file}" konnte nicht geladen werden.`, 'error');
      }
    }

    // Lokale Änderungen darüberlegen
    const local = isAvailable() ? await localTrips.all() : [];
    const bySlug = new Map(remote.map((entry) => [entry.trip.slug, entry]));

    for (const entry of local) {
      if (entry.deleted) {
        const existing = bySlug.get(entry.slug);
        if (existing) existing.deleted = true;
        else bySlug.set(entry.slug, { trip: normalizeTrip(entry.trip), file: `${entry.slug}.json`, source: 'lokal', deleted: true });
        continue;
      }
      bySlug.set(entry.slug, {
        trip: normalizeTrip(entry.trip),
        file: `${entry.slug}.json`,
        source: bySlug.has(entry.slug) ? 'repo' : 'lokal',
        dirty: true
      });
    }

    state.trips = [...bySlug.values()].sort((a, b) => (b.trip.startDate || '').localeCompare(a.trip.startDate || ''));
    renderList();
    await refreshPendingBar();
  } catch (error) {
    toast(error.message || 'Reisen konnten nicht geladen werden.', 'error');
  } finally {
    setLoading(false);
  }
}

/* ======================================================= Offene Änderungen = */

async function refreshPendingBar() {
  const bar = $('[data-pending-bar]');
  if (!bar) return;
  if (!isAvailable()) {
    bar.hidden = true;
    return;
  }

  const { changed, deleted, media: pendingMedia, bytes, total } = await pendingChanges();
  bar.hidden = total === 0;
  if (!total) return;

  const parts = [];
  if (changed.length) parts.push(pluralize(changed.length, 'geänderte Reise', 'geänderte Reisen'));
  if (deleted.length) parts.push(`${deleted.length} zu löschen`);
  if (pendingMedia.length) parts.push(`${pluralize(pendingMedia.length, 'neues Bild', 'neue Bilder')} (${formatBytes(bytes)})`);

  $('[data-pending-text]', bar).textContent = `Noch nicht veröffentlicht: ${parts.join(' · ')}`;
}

/** Reise lokal speichern. Netzwerk ist dabei nicht im Spiel. */
async function storeTrip(trip) {
  const clean = normalizeTrip({ ...trip, updatedAt: nowStamp() });
  await localTrips.put(clean.slug, clean);

  const index = state.trips.findIndex((entry) => entry.trip.id === clean.id);
  const record = {
    trip: clean,
    file: `${clean.slug}.json`,
    source: index >= 0 ? state.trips[index].source : 'lokal',
    dirty: true
  };
  if (index >= 0) state.trips[index] = record;
  else state.trips.unshift(record);

  state.trips.sort((a, b) => (b.trip.startDate || '').localeCompare(a.trip.startDate || ''));
  await refreshPendingBar();
  return record;
}

/* ============================================================= Übersicht === */

function renderList() {
  $('[data-panel="list"]').hidden = false;
  $('[data-panel="editor"]').hidden = true;

  const list = $('[data-trip-list]');
  const now = new Date();
  list.innerHTML = '';

  const counts = {};
  for (const item of state.trips) {
    if (item.deleted) continue;
    const key = effectiveState(item.trip, now);
    counts[key] = (counts[key] || 0) + 1;
  }
  const summary = [
    counts.live ? `${counts.live} sichtbar` : '',
    counts.scheduled ? `${counts.scheduled} geplant` : '',
    counts.draft ? pluralize(counts.draft, 'Entwurf', 'Entwürfe') : '',
    counts.archived ? `${counts.archived} archiviert` : '',
    counts.expired ? `${counts.expired} ausgeblendet` : ''
  ].filter(Boolean);

  const visible = state.trips.filter((t) => !t.deleted).length;
  $('[data-list-summary]').textContent = visible
    ? `${pluralize(visible, 'Urlaub', 'Urlaube')} · ${summary.join(' · ')}`
    : 'Noch nichts angelegt.';

  for (const item of state.trips) {
    const trip = item.trip;
    const cover = firstImage(trip);
    const stateKey = effectiveState(trip, now);

    const row = el(`
      <article class="trip-row${item.deleted ? ' is-deleted' : ''}" data-slug="${escapeHtml(trip.slug)}">
        <div class="trip-row__thumb">${cover ? `<img data-src="${escapeHtml(cover.thumb || cover.src)}" alt="">` : ''}</div>
        <div class="trip-row__body">
          <h2 class="trip-row__title">
            <span>${escapeHtml(trip.title)}</span>
            ${item.deleted
              ? '<span class="state" data-state="expired">Zum Löschen</span>'
              : `<span class="state" data-state="${stateKey}">${escapeHtml(STATE_LABELS[stateKey] || stateKey)}</span>`}
            ${item.dirty && !item.deleted ? '<span class="state" data-state="scheduled" title="Diese Änderung ist noch nicht bei GitHub">Geändert</span>' : ''}
          </h2>
          <p class="trip-row__meta">${escapeHtml([trip.location, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')) || '—'}</p>
          <p class="trip-row__stats">${pluralize(trip.entries.length, 'Tag', 'Tage')} · ${pluralize(countImages(trip), 'Bild', 'Bilder')}${trip.publishFrom ? ` · ab ${escapeHtml(humanDateTime(trip.publishFrom))}` : ''}${trip.publishUntil ? ` · bis ${escapeHtml(humanDateTime(trip.publishUntil))}` : ''}</p>
        </div>
        <div class="trip-row__actions">
          ${item.deleted
            ? `<button class="btn btn--quiet btn--small" type="button" data-action="undelete">Löschen zurücknehmen</button>`
            : `<button class="btn btn--quiet btn--small" type="button" data-action="edit">${icons.edit} Bearbeiten</button>
               <button class="btn btn--quiet btn--small" type="button" data-action="toggle">${trip.status === 'published' ? `${icons.eyeOff} Verstecken` : `${icons.eye} Veröffentlichen`}</button>
               <button class="btn btn--quiet btn--small" type="button" data-action="archive" title="Archivieren">${icons.archive}</button>
               <button class="btn btn--quiet btn--small" type="button" data-action="duplicate" title="Duplizieren">${icons.copy}</button>
               <button class="btn btn--quiet btn--small" type="button" data-action="delete" title="Löschen">${icons.trash}</button>`}
        </div>
      </article>
    `);

    row.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      handleListAction(button.dataset.action, item);
    });

    list.appendChild(row);
  }

  applyListFilter();
  hydrateImages(list);
}

function applyListFilter() {
  const term = state.search.trim().toLowerCase();
  let visible = 0;

  for (const row of $$('.trip-row')) {
    const item = state.trips.find((t) => t.trip.slug === row.dataset.slug);
    if (!item) continue;
    const haystack = `${item.trip.title} ${item.trip.location} ${item.trip.description}`.toLowerCase();
    const matchesTerm = !term || haystack.includes(term);
    const matchesStatus = !state.statusFilter || item.trip.status === state.statusFilter;
    const show = matchesTerm && matchesStatus;
    row.classList.toggle('is-hidden', !show);
    if (show) visible += 1;
  }

  const empty = $('[data-list-empty]');
  empty.hidden = visible > 0;
  empty.textContent = state.trips.length
    ? 'Kein Urlaub passt zu dieser Suche.'
    : 'Noch kein Urlaub angelegt. Lege den ersten an.';
}

async function handleListAction(action, item) {
  const trip = item.trip;

  if (action === 'edit') { openEditor(item); return; }

  if (action === 'toggle' || action === 'archive') {
    const next = action === 'toggle'
      ? (trip.status === 'published' ? 'draft' : 'published')
      : (trip.status === 'archived' ? 'published' : 'archived');
    await storeTrip({ ...trip, status: next });
    renderList();
    toast('Geändert. Zum Veröffentlichen das Paket hochladen.');
    return;
  }

  if (action === 'duplicate') { await duplicateTrip(item); return; }

  if (action === 'undelete') {
    await localTrips.remove(trip.slug);
    await loadTrips();
    toast('Löschen zurückgenommen.');
    return;
  }

  if (action === 'delete') {
    const ok = await confirmDialog({
      title: 'Urlaub löschen?',
      text: `„${trip.title}" wird zum Löschen vorgemerkt. Weil dieser Bereich nichts schreiben darf, führst du das Löschen beim Veröffentlichen mit einem Klick bei GitHub aus.`,
      confirmLabel: 'Vormerken'
    });
    if (!ok) return;

    if (item.source === 'lokal' && !item.dirtyFromRepo) {
      // Nur lokal vorhanden - einfach verwerfen
      await localTrips.remove(trip.slug);
      await loadTrips();
      toast('Entwurf verworfen.');
      return;
    }
    await localTrips.markDeleted(trip.slug, trip);
    await loadTrips();
    toast('Zum Löschen vorgemerkt.');
  }
}

async function duplicateTrip(item) {
  const taken = new Set(state.trips.map((t) => t.trip.slug));
  const copy = normalizeTrip({
    ...structuredClone(item.trip),
    id: createId('trip'),
    slug: uniqueSlug(`${item.trip.slug}-kopie`, taken),
    title: `${item.trip.title} (Kopie)`,
    status: 'draft',
    publishFrom: '',
    publishUntil: '',
    createdAt: nowStamp(),
    updatedAt: nowStamp()
  });
  copy.entries = copy.entries.map((entry) => ({ ...entry, id: createId('entry') }));

  await storeTrip(copy);
  renderList();
  toast('Kopie als Entwurf angelegt.', 'success');
}

/* ================================================================ Editor === */

function openEditor(item) {
  state.current = normalizeTrip(structuredClone(item.trip));
  state.currentFile = item.file;
  state.openEntries = new Set();
  markDirty(false);

  $('[data-panel="list"]').hidden = true;
  const panel = $('[data-panel="editor"]');
  panel.hidden = false;
  renderEditor();
  window.scrollTo({ top: 0 });
}

async function leaveEditor() {
  if (state.dirty) {
    const ok = await confirmDialog({
      title: 'Änderungen verwerfen?',
      text: 'Es gibt ungespeicherte Änderungen. Möchtest du den Editor trotzdem verlassen?',
      confirmLabel: 'Verwerfen'
    });
    if (!ok) return;
  }
  state.current = null;
  markDirty(false);
  renderList();
  window.scrollTo({ top: 0 });
}

function renderEditorBar() {
  const bar = $('[data-editor-bar]');
  if (!bar || !state.current) return;
  $('[data-editor-name]', bar).textContent = state.current.title;
}

function renderEditor() {
  const trip = state.current;
  const panel = $('[data-panel="editor"]');

  panel.innerHTML = `
    <div class="editor">
      <div class="editor__bar" data-editor-bar>
        <div class="editor__bar-left">
          <button class="btn btn--quiet btn--small" type="button" data-back>${icons.back} Übersicht</button>
          <span class="dirty-dot" data-dirty hidden title="Ungespeicherte Änderungen"></span>
          <span class="editor__name" data-editor-name>${escapeHtml(trip.title)}</span>
        </div>
        <div class="editor__bar-actions">
          <a class="btn btn--quiet btn--small" href="${escapeHtml(publicUrl(trip.slug))}" target="_blank" rel="noopener" title="Zeigt den zuletzt veröffentlichten Stand">Vorschau</a>
          <button class="btn btn--primary btn--small" type="button" data-save disabled>Speichern</button>
        </div>
      </div>

      <div class="editor__grid">
        <div class="editor__side">
          <div class="card">
            <h2 class="card__title">Titelbild</h2>
            <div class="cover" data-cover></div>
            <label class="dropzone" style="margin-top:.6rem" data-cover-drop>
              ${icons.upload}
              <span>Titelbild hochladen</span>
              <input type="file" accept="image/*" data-cover-input>
            </label>
            <div data-cover-progress></div>
          </div>

          <div class="card">
            <h2 class="card__title">Veröffentlichung</h2>
            <div class="card__grid">
              <label class="input">
                <span class="input__label">Status</span>
                <select data-field="status">
                  <option value="draft">Entwurf – nicht auf der Website</option>
                  <option value="published">Veröffentlicht</option>
                  <option value="archived">Archiviert</option>
                </select>
              </label>
              <label class="input">
                <span class="input__label">Sichtbar ab (optional)</span>
                <input type="datetime-local" data-field="publishFrom">
                <span class="input__hint">Vorher für Besucher nicht sichtbar.</span>
              </label>
              <label class="input">
                <span class="input__label">Ausblenden am (optional)</span>
                <input type="datetime-local" data-field="publishUntil">
              </label>
              <label class="input">
                <span class="input__label">Nach Ablauf</span>
                <select data-field="onExpire">
                  <option value="hide">ausblenden</option>
                  <option value="archive">ins Archiv verschieben</option>
                </select>
              </label>
              <label class="checkbox">
                <input type="checkbox" data-field-checkbox="featured">
                <span>Auf der Startseite hervorheben</span>
              </label>
              <p class="input__hint" data-state-preview></p>
            </div>
          </div>

          <div class="card">
            <h2 class="card__title">Adresse</h2>
            <label class="input">
              <span class="input__label">URL-Kürzel</span>
              <input type="text" data-field="slug" spellcheck="false">
              <span class="input__hint" data-slug-preview></span>
            </label>
          </div>
        </div>

        <div class="editor__main">
          <div class="card">
            <h2 class="card__title">Eckdaten</h2>
            <div class="card__grid">
              <label class="input">
                <span class="input__label">Name des Urlaubs</span>
                <input type="text" data-field="title" placeholder="z. B. Sommerurlaub 2026">
              </label>
              <label class="input">
                <span class="input__label">Ort (optional)</span>
                <input type="text" data-field="location" placeholder="z. B. Italien">
              </label>
              <div class="card__row">
                <label class="input">
                  <span class="input__label">Startdatum</span>
                  <input type="date" data-field="startDate">
                </label>
                <label class="input">
                  <span class="input__label">Enddatum</span>
                  <input type="date" data-field="endDate">
                </label>
              </div>
              <label class="input">
                <span class="input__label">Beschreibung</span>
                <textarea data-field="description" rows="6" placeholder="Worum ging es bei dieser Reise?"></textarea>
                <span class="input__hint">Absätze mit Leerzeile trennen. **fett**, *kursiv*, &gt; Zitat und - Listen sind möglich.</span>
              </label>
            </div>
          </div>

          <div class="card">
            <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:space-between;margin-bottom:.85rem">
              <h2 class="card__title" style="margin:0">Tage &amp; Einträge</h2>
              <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                <button class="btn btn--quiet btn--small" type="button" data-sort-entries title="Nach Datum sortieren">${icons.sort} Sortieren</button>
                <button class="btn btn--primary btn--small" type="button" data-add-entry>${icons.plus} Tag hinzufügen</button>
              </div>
            </div>
            <div class="entry-list" data-entry-list></div>
            <p class="admin-empty" data-entry-empty hidden style="padding:2rem 1rem">Noch kein Tag angelegt.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Felder befüllen
  for (const field of $$('[data-field]', panel)) {
    field.value = trip[field.dataset.field] ?? '';
  }
  for (const box of $$('[data-field-checkbox]', panel)) {
    box.checked = Boolean(trip[box.dataset.fieldCheckbox]);
  }

  updateSlugPreview();
  updateStatePreview();
  renderCover();
  renderEntries();

  // Ereignisse
  $('[data-back]', panel).addEventListener('click', leaveEditor);
  $('[data-save]', panel).addEventListener('click', saveCurrent);
  $('[data-add-entry]', panel).addEventListener('click', addEntry);
  $('[data-sort-entries]', panel).addEventListener('click', () => {
    state.current.entries = sortEntriesChronologically(state.current.entries);
    markDirty();
    renderEntries();
    toast('Nach Datum sortiert.');
  });

  panel.addEventListener('input', onFieldInput);
  panel.addEventListener('change', onFieldInput);

  $('[data-cover-input]', panel).addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadCover(file);
  });
  wireDropzone($('[data-cover-drop]', panel), (files) => files[0] && uploadCover(files[0]));
}

function onFieldInput(event) {
  const box = event.target.closest('[data-field-checkbox]');
  if (box && state.current) {
    state.current[box.dataset.fieldCheckbox] = box.checked;
    markDirty();
    return;
  }

  const field = event.target.closest('[data-field]');
  if (!field || !state.current) return;
  const key = field.dataset.field;

  let value = field.value;
  if (key === 'slug') value = slugify(value || state.current.title);

  state.current[key] = value;
  markDirty();

  if (key === 'title') renderEditorBar();
  if (key === 'slug' || key === 'title') updateSlugPreview();
  if (['status', 'publishFrom', 'publishUntil', 'onExpire'].includes(key)) updateStatePreview();
}

function updateSlugPreview() {
  const preview = $('[data-slug-preview]');
  if (!preview) return;
  const slug = state.current.slug || slugify(state.current.title);
  preview.textContent = absolutePublicUrl(slug) || publicUrl(slug);
}

function updateStatePreview() {
  const preview = $('[data-state-preview]');
  if (!preview) return;
  const key = effectiveState(state.current, new Date());
  const texts = {
    draft: 'Entwurf: wird gar nicht erst auf die Website gebaut.',
    scheduled: `Geplant: erscheint am ${humanDateTime(state.current.publishFrom)}.`,
    live: 'Sichtbar: erscheint nach dem nächsten Build in der Übersicht.',
    archived: 'Archiv: nur im Archiv-Bereich und über den direkten Link erreichbar.',
    expired: `Ausgeblendet seit ${humanDateTime(state.current.publishUntil)}.`
  };
  preview.textContent = texts[key] || '';
}

/* --------------------------------------------------------------- Titelbild */

function renderCover() {
  const box = $('[data-cover]');
  if (!box) return;
  const cover = state.current.coverImage;

  if (!cover?.src) {
    box.innerHTML = '<span>Kein Titelbild gesetzt.<br>Lade eines hoch oder markiere ein Bild aus einem Tag mit dem Stern.</span>';
    return;
  }

  box.innerHTML = `
    <img data-src="${escapeHtml(cover.thumb || cover.src)}" alt="">
    <div class="cover__actions">
      <button class="mini-btn" type="button" data-cover-remove title="Titelbild entfernen">${icons.trash}</button>
    </div>
  `;
  $('[data-cover-remove]', box).addEventListener('click', () => {
    state.current.coverImage = null;
    markDirty();
    renderCover();
  });
  hydrateImages(box);
}

async function uploadCover(file) {
  const image = await processFiles([file], $('[data-cover-progress]'), 'titelbild');
  if (image?.length) {
    state.current.coverImage = image[0];
    markDirty();
    renderCover();
  }
}

/* ----------------------------------------------------------------- Einträge */

function renderEntries() {
  const list = $('[data-entry-list]');
  if (!list) return;
  const entries = state.current.entries;

  $('[data-entry-empty]').hidden = entries.length > 0;
  list.innerHTML = '';

  entries.forEach((entry, index) => {
    const open = state.openEntries.has(entry.id);
    const card = el(`
      <article class="entry-card${open ? ' is-open' : ''}" data-entry-id="${escapeHtml(entry.id)}" data-index="${index}">
        <div class="entry-card__head">
          <button class="drag-handle" type="button" draggable="true" title="Zum Sortieren ziehen" aria-label="Tag verschieben">${icons.grip}</button>
          <button class="entry-card__summary" type="button" data-toggle-entry>
            <span class="entry-card__name">${escapeHtml(entry.title || `Tag ${index + 1}`)}</span>
            <span class="entry-card__meta">${escapeHtml([humanDate(entry.date), entry.time, entry.location].filter(Boolean).join(' · ')) || 'ohne Datum'} · ${pluralize(entry.images.length, 'Bild', 'Bilder')}</span>
          </button>
          <div class="entry-card__tools">
            <button class="icon-btn" type="button" data-move="-1" title="Nach oben"${index === 0 ? ' disabled' : ''}>${icons.up}</button>
            <button class="icon-btn" type="button" data-move="1" title="Nach unten"${index === entries.length - 1 ? ' disabled' : ''}>${icons.down}</button>
            <button class="icon-btn" type="button" data-delete-entry title="Tag löschen">${icons.trash}</button>
          </div>
        </div>
        <div class="entry-card__body"${open ? '' : ' hidden'}>
          <div class="card__row">
            <label class="input">
              <span class="input__label">Datum</span>
              <input type="date" data-entry-field="date" value="${escapeHtml(entry.date)}">
            </label>
            <label class="input">
              <span class="input__label">Uhrzeit (optional)</span>
              <input type="time" data-entry-field="time" value="${escapeHtml(entry.time)}">
            </label>
          </div>
          <label class="input">
            <span class="input__label">Überschrift</span>
            <input type="text" data-entry-field="title" value="${escapeHtml(entry.title)}" placeholder="z. B. Ankunft an der Küste">
          </label>
          <label class="input">
            <span class="input__label">Ort (optional)</span>
            <input type="text" data-entry-field="location" value="${escapeHtml(entry.location)}" placeholder="z. B. Sestri Levante">
          </label>
          <label class="input">
            <span class="input__label">Text</span>
            <textarea data-entry-field="text" rows="8" placeholder="Was ist an diesem Tag passiert?">${escapeHtml(entry.text)}</textarea>
          </label>

          <div>
            <span class="input__label" style="display:block;margin-bottom:.45rem">${pluralize(entry.images.length, 'Bild', 'Bilder')}</span>
            <div class="image-grid" data-image-grid></div>
            <label class="dropzone" style="margin-top:.6rem">
              ${icons.upload}
              <span>Bilder hierher ziehen oder auswählen</span>
              <input type="file" accept="image/*" multiple data-entry-images>
            </label>
            <div data-entry-progress></div>
          </div>
        </div>
      </article>
    `);

    wireEntryCard(card, entry);
    list.appendChild(card);
    if (open) renderEntryImages(card, entry);
  });

  hydrateImages(list);
}

function wireEntryCard(card, entry) {
  const body = $('.entry-card__body', card);

  $('[data-toggle-entry]', card).addEventListener('click', () => {
    const open = state.openEntries.has(entry.id);
    if (open) state.openEntries.delete(entry.id);
    else state.openEntries.add(entry.id);
    body.hidden = open;
    card.classList.toggle('is-open', !open);
    if (!open) {
      renderEntryImages(card, entry);
      hydrateImages(card);
    }
  });

  for (const button of $$('[data-move]', card)) {
    button.addEventListener('click', () => moveEntry(entry, Number(button.dataset.move)));
  }

  $('[data-delete-entry]', card).addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Tag löschen?',
      text: `„${entry.title}“ wird aus diesem Urlaub entfernt. Nicht mehr verwendete Bilder werden beim Speichern gelöscht.`,
      confirmLabel: 'Löschen'
    });
    if (!ok) return;
    state.current.entries = state.current.entries.filter((e) => e.id !== entry.id);
    markDirty();
    renderEntries();
  });

  body.addEventListener('input', (event) => {
    const field = event.target.closest('[data-entry-field]');
    if (!field) return;
    entry[field.dataset.entryField] = field.value;
    markDirty();
    if (field.dataset.entryField !== 'text') {
      $('.entry-card__name', card).textContent = entry.title || 'Ohne Titel';
      $('.entry-card__meta', card).textContent =
        `${[humanDate(entry.date), entry.time, entry.location].filter(Boolean).join(' · ') || 'ohne Datum'} · ${entry.images.length} Bilder`;
    }
  });

  const input = $('[data-entry-images]', card);
  input.addEventListener('change', (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) addEntryImages(entry, files, card);
  });
  wireDropzone(input.closest('.dropzone'), (files) => addEntryImages(entry, files, card));

  wireDragAndDrop(card, entry);
}

function moveEntry(entry, direction) {
  const entries = state.current.entries;
  const index = entries.findIndex((e) => e.id === entry.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= entries.length) return;
  [entries[index], entries[target]] = [entries[target], entries[index]];
  markDirty();
  renderEntries();
}

function wireDragAndDrop(card, entry) {
  const handle = $('.drag-handle', card);

  handle.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entry.id);
    card.classList.add('is-dragging');
  });
  handle.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    for (const node of $$('.entry-card')) node.classList.remove('is-drop-target');
  });

  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    card.classList.add('is-drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('is-drop-target');
    const draggedId = event.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === entry.id) return;

    const entries = state.current.entries;
    const from = entries.findIndex((e) => e.id === draggedId);
    const to = entries.findIndex((e) => e.id === entry.id);
    if (from < 0 || to < 0) return;

    const [moved] = entries.splice(from, 1);
    entries.splice(to, 0, moved);
    markDirty();
    renderEntries();
  });
}

function addEntry() {
  const trip = state.current;
  const last = trip.entries[trip.entries.length - 1];
  const nextDate = last?.date
    ? new Date(new Date(`${last.date}T12:00`).getTime() + 86400000).toISOString().slice(0, 10)
    : trip.startDate || '';

  const entry = {
    id: createId('entry'),
    date: nextDate && (!trip.endDate || nextDate <= trip.endDate) ? nextDate : (trip.startDate || ''),
    time: '',
    title: `Tag ${trip.entries.length + 1}`,
    location: '',
    text: '',
    images: []
  };

  trip.entries.push(entry);
  state.openEntries.add(entry.id);
  markDirty();
  renderEntries();

  const card = $(`[data-entry-id="${CSS.escape(entry.id)}"]`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('[data-entry-field="title"]', card)?.focus();
}

/* ------------------------------------------------------------------ Bilder */

function renderEntryImages(card, entry) {
  const grid = $('[data-image-grid]', card);
  if (!grid) return;
  grid.innerHTML = '';

  entry.images.forEach((image, index) => {
    const isCover = state.current.coverImage?.src === image.src;
    const item = el(`
      <div class="image-item" data-image-id="${escapeHtml(image.id)}">
        <div class="image-item__frame">
          <img data-src="${escapeHtml(image.thumb || image.src)}" alt="">
          <div class="image-item__tools">
            <button class="mini-btn${isCover ? ' is-active' : ''}" type="button" data-image-action="cover" title="Als Titelbild">${icons.star}</button>
            <button class="mini-btn" type="button" data-image-action="left" title="Nach links"${index === 0 ? ' disabled' : ''}>${icons.back}</button>
            <button class="mini-btn" type="button" data-image-action="right" title="Nach rechts"${index === entry.images.length - 1 ? ' disabled' : ''} style="transform:rotate(180deg)">${icons.back}</button>
            <button class="mini-btn" type="button" data-image-action="delete" title="Bild entfernen">${icons.trash}</button>
          </div>
        </div>
        <input type="text" value="${escapeHtml(image.caption)}" placeholder="Bildunterschrift" data-image-caption>
      </div>
    `);

    $('[data-image-caption]', item).addEventListener('input', (event) => {
      image.caption = event.target.value;
      if (!image.alt) image.alt = event.target.value;
      markDirty();
    });

    item.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-image-action]');
      if (!button) return;
      const action = button.dataset.imageAction;

      if (action === 'cover') {
        state.current.coverImage = { ...image };
        markDirty();
        renderCover();
        renderEntryImages(card, entry);
        hydrateImages(card);
        toast('Als Titelbild gesetzt.');
        return;
      }
      if (action === 'left' || action === 'right') {
        const target = index + (action === 'left' ? -1 : 1);
        if (target < 0 || target >= entry.images.length) return;
        [entry.images[index], entry.images[target]] = [entry.images[target], entry.images[index]];
        markDirty();
        renderEntryImages(card, entry);
        hydrateImages(card);
        return;
      }
      if (action === 'delete') {
        const ok = await confirmDialog({
          title: 'Bild entfernen?',
          text: 'Das Bild wird aus diesem Tag entfernt. Bereits veröffentlichte Bilddateien bleiben im Repository – sie lassen sich dort später von Hand aufräumen.',
          confirmLabel: 'Entfernen'
        });
        if (!ok) return;
        entry.images = entry.images.filter((img) => img.id !== image.id);
        markDirty();
        renderEntries();
      }
    });

    grid.appendChild(item);
  });

  hydrateImages(grid);
}

async function addEntryImages(entry, files, card) {
  const added = await processFiles(files, $('[data-entry-progress]', card), state.current.slug);
  if (!added?.length) return;
  entry.images.push(...added);
  markDirty();
  renderEntries();
}

/**
 * Dateien verkleinern und lokal ablegen. Hochgeladen wird hier nichts -
 * das passiert später gebündelt beim Veröffentlichen.
 */
async function processFiles(files, progressBox, prefix) {
  const usable = [...files].filter(isSupportedImage);
  if (!usable.length) {
    toast('Keine unterstützten Bilddateien ausgewählt.', 'error');
    return [];
  }

  const box = progressBox || document.createElement('div');
  const total = usable.length;
  let done = 0;
  let savedBytes = 0;

  const paint = (label) => {
    box.innerHTML = `
      <div class="upload-progress">
        <span>${escapeHtml(label)}</span>
        <span class="upload-progress__bar"><span class="upload-progress__fill" style="width:${Math.round((done / total) * 100)}%"></span></span>
      </div>`;
  };

  paint(`0 von ${total} verarbeitet`);
  const results = [];

  for (const file of usable) {
    try {
      paint(`${done} von ${total} · „${file.name}" wird verkleinert …`);
      const prepared = await prepareImage(file);
      savedBytes += Math.max(0, prepared.originalSize - prepared.newSize);

      const image = await storeImage({ prepared, prefix });
      results.push(image);
      done += 1;
      paint(`${done} von ${total} verarbeitet`);
    } catch (error) {
      console.error(error);
      toast(`„${file.name}": ${error.message}`, 'error');
    }
  }

  box.innerHTML = '';
  if (results.length) {
    toast(`${pluralize(results.length, 'Bild', 'Bilder')} hinzugefügt${savedBytes > 1024 * 100 ? ` · ${formatBytes(savedBytes)} eingespart` : ''}.`, 'success');
    await refreshPendingBar();
  }
  return results;
}

function wireDropzone(zone, onFiles) {
  if (!zone) return;
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };

  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (event) => { stop(event); zone.classList.add('is-over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (event) => { stop(event); zone.classList.remove('is-over'); });
  }
  zone.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  });
}

/* -------------------------------------------------------------- Speichern -- */
/* -------------------------------------------------------------- Speichern -- */

async function saveCurrent() {
  const trip = state.current;
  if (!trip) return;

  if (!trip.title.trim()) { toast('Bitte einen Namen für den Urlaub angeben.', 'error'); return; }
  if (!trip.startDate) { toast('Bitte ein Startdatum angeben.', 'error'); return; }
  if (!trip.endDate) trip.endDate = trip.startDate;
  if (trip.endDate < trip.startDate) { toast('Das Enddatum liegt vor dem Startdatum.', 'error'); return; }

  const taken = new Set(state.trips.filter((t) => t.trip.id !== trip.id).map((t) => t.trip.slug));
  const previousSlug = state.currentFile.replace(/\.json$/, '');
  trip.slug = uniqueSlug(trip.slug || trip.title, taken);

  // Beim Umbenennen darf der alte lokale Eintrag nicht liegen bleiben.
  if (previousSlug && previousSlug !== trip.slug) {
    await localTrips.remove(previousSlug);
    state.trips = state.trips.filter((t) => !(t.trip.id !== trip.id && t.trip.slug === previousSlug));
  }

  const record = await storeTrip(trip);
  state.currentFile = record.file;

  markDirty(false);
  const slugField = $('[data-field="slug"]');
  if (slugField) slugField.value = trip.slug;
  updateSlugPreview();
  renderEditorBar();

  toast(
    previousSlug && previousSlug !== trip.slug
      ? `Gespeichert. Die alte Datei ${previousSlug}.json musst du bei GitHub löschen.`
      : 'Lokal gespeichert. Zum Veröffentlichen das Paket hochladen.',
    'success'
  );
}

async function createTrip() {
  const taken = new Set(state.trips.map((t) => t.trip.slug));
  const trip = emptyTrip({ title: 'Neuer Urlaub' });
  trip.slug = uniqueSlug('neuer-urlaub', taken);
  openEditor({ trip, file: '' });
  markDirty(true);
  $('[data-field="title"]')?.select?.();
}

/* ---------------------------------------------------------- Veröffentlichen */

async function openPublishDialog() {
  if (state.dirty) {
    const ok = await confirmDialog({
      title: 'Ungespeicherte Änderungen',
      text: 'Im Editor gibt es Änderungen, die noch nicht gespeichert sind. Sie kommen so nicht ins Paket.',
      confirmLabel: 'Trotzdem fortfahren',
      danger: false
    });
    if (!ok) return;
  }

  const { changed, deleted, media: pendingMedia, bytes, total } = await pendingChanges();
  if (!total) {
    toast('Es gibt nichts zu veröffentlichen.');
    return;
  }

  const dialog = $('[data-publish]');
  $('[data-publish-summary]', dialog).innerHTML = `
    <ul class="publish-list">
      ${changed.length ? `<li><strong>${pluralize(changed.length, 'Reise', 'Reisen')}</strong> geändert
        <span>${changed.map((e) => escapeHtml(e.trip.title)).join(', ')}</span></li>` : ''}
      ${pendingMedia.length ? `<li><strong>${pluralize(pendingMedia.length, 'Bild', 'Bilder')}</strong> neu
        <span>${formatBytes(bytes)}</span></li>` : ''}
      ${deleted.length ? `<li><strong>${pluralize(deleted.length, 'Reise', 'Reisen')}</strong> zu löschen
        <span>${deleted.map((e) => escapeHtml(e.trip.title)).join(', ')}</span></li>` : ''}
    </ul>
  `;

  const deleteBox = $('[data-publish-deletions]', dialog);
  deleteBox.hidden = deleted.length === 0;
  if (deleted.length) {
    $('[data-publish-delete-links]', deleteBox).innerHTML = deleted.map((entry) => `
      <li>
        <a href="${escapeHtml(repo.deleteUrl(`${repo.contentDir}/${entry.slug}.json`))}" target="_blank" rel="noopener">
          ${escapeHtml(entry.trip.title)} löschen
        </a>
      </li>`).join('');
  }

  $('[data-publish-upload]', dialog).href = repo.uploadUrl();
  dialog.hidden = false;
  $('[data-publish-download]', dialog).focus();
}

async function doExport() {
  setLoading(true, 'Paket wird geschnürt …');
  try {
    const { files, bytes } = await exportChanges(repo);
    toast(`${pluralize(files, 'Datei', 'Dateien')} · ${formatBytes(bytes)} heruntergeladen.`, 'success');
    $('[data-publish-step2]').hidden = false;
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function markPublished() {
  const ok = await confirmDialog({
    title: 'Änderungen als veröffentlicht abhaken?',
    text: 'Die lokal gemerkten Änderungen werden verworfen. Mach das erst, wenn der Commit bei GitHub durch ist – sonst sind sie weg.',
    confirmLabel: 'Erledigt, verwerfen'
  });
  if (!ok) return;

  await clearAll();
  $('[data-publish]').hidden = true;
  $('[data-publish-step2]').hidden = true;
  toast('Lokale Änderungen verworfen. Nach dem Build zeigt die Liste den neuen Stand.', 'success');
  await loadTrips();
}

/* ================================================================== Start == */

function init() {
  initTheme();

  $('[data-repo-name]').textContent = `${repoConfig.owner}/${repoConfig.name}`;
  for (const node of $$('[data-upload-link]')) node.href = repo.uploadUrl();

  if (!isAvailable()) {
    toast('Dieser Browser unterstützt keine lokale Ablage. Änderungen gehen beim Schließen verloren.', 'error');
  }

  $('[data-form="pin"]').addEventListener('submit', (event) => {
    event.preventDefault();
    const pin = $('[data-pin-input]').value.trim();
    if (pin) unlock(pin);
  });

  $('[data-logout]').addEventListener('click', () => {
    try { sessionStorage.removeItem('tagebuch:entsperrt'); } catch { /* egal */ }
    state.current = null;
    markDirty(false);
    showLogin();
  });

  $('[data-new-trip]').addEventListener('click', createTrip);
  $('[data-reload]').addEventListener('click', loadTrips);
  $('[data-go-list]').addEventListener('click', () => {
    if (state.current) leaveEditor();
  });

  for (const node of $$('[data-open-publish]')) node.addEventListener('click', openPublishDialog);
  $('[data-publish-download]').addEventListener('click', doExport);
  $('[data-publish-done]').addEventListener('click', markPublished);
  for (const node of $$('[data-publish-close]')) {
    node.addEventListener('click', () => {
      $('[data-publish]').hidden = true;
      $('[data-publish-step2]').hidden = true;
    });
  }

  $('[data-discard-all]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Alle offenen Änderungen verwerfen?',
      text: 'Alles, was seit der letzten Veröffentlichung bearbeitet wurde, geht verloren.',
      confirmLabel: 'Verwerfen'
    });
    if (!ok) return;
    await clearAll();
    state.current = null;
    markDirty(false);
    await loadTrips();
    toast('Offene Änderungen verworfen.');
  });

  $('[data-list-search]').addEventListener('input', debounce((event) => {
    state.search = event.target.value;
    applyListFilter();
  }, 160));

  for (const chip of $$('[data-status-filter]')) {
    chip.addEventListener('click', () => {
      state.statusFilter = chip.dataset.statusFilter;
      for (const other of $$('[data-status-filter]')) other.classList.toggle('is-active', other === chip);
      applyListFilter();
    });
  }

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's' && state.current) {
      event.preventDefault();
      if (state.dirty) saveCurrent();
    }
    if (event.key === 'Escape' && !$('[data-publish]').hidden) {
      $('[data-publish]').hidden = true;
    }
  });

  // Innerhalb einer Sitzung nicht erneut nach der PIN fragen
  let unlocked = false;
  try { unlocked = sessionStorage.getItem('tagebuch:entsperrt') === '1'; } catch { /* egal */ }

  if (unlocked) {
    showApp();
    loadTrips();
  } else {
    showLogin();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
