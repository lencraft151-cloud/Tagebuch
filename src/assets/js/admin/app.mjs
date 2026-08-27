/**
 * Verwaltungsbereich: Urlaube anlegen, bearbeiten, veröffentlichen und löschen.
 *
 * Alle Änderungen werden als Commits über die GitHub-API im Repository
 * gespeichert. GitHub Actions baut die Website danach automatisch neu.
 */

import { GitHub, encodeText } from './github.mjs';
import { prepareImage, uploadImage, createMediaResolver, isSupportedImage, formatBytes } from './media.mjs';
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
  firstImage,
  sortTripsByDate
} from '../lib/trips.mjs';
import { formatDateRange, pluralize } from '../lib/format.mjs';
import { $, $$, el, escapeHtml, icons, toast, setLoading, confirmDialog, debounce, initTheme, humanDate, humanDateTime } from './ui.mjs';

const config = window.__ADMIN_CONFIG__ || {};
const repoConfig = config.repo || {};
const CONTENT_DIR = repoConfig.contentDir || 'content/trips';
const MEDIA_DIR = repoConfig.mediaDir || 'content/media';

const github = new GitHub({
  owner: repoConfig.owner,
  name: repoConfig.name,
  branch: repoConfig.branch || 'main'
});

let media = createMediaResolver(github, MEDIA_DIR);

const state = {
  trips: [],          // { trip, path, sha }
  current: null,      // aktuell bearbeitete Reise (Kopie)
  currentPath: '',
  currentSha: '',
  dirty: false,
  search: '',
  statusFilter: '',
  openEntries: new Set()
};

/* ======================================================== Hilfsfunktionen == */

const publicUrl = (slug) => `${config.base || '/'}reisen/${slug}/`;

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

/** Bildquellen im DOM asynchron auflösen (öffentlich: Roh-URL, privat: API). */
async function hydrateImages(scope = document) {
  const nodes = $$('img[data-src]', scope);
  await Promise.all(nodes.map(async (img) => {
    const src = img.dataset.src;
    img.removeAttribute('data-src');
    const url = await media.resolve(src);
    if (url) img.src = url;
    else img.closest('.image-item__frame, .trip-row__thumb, .cover')?.classList.add('is-missing');
  }));
}

/* ============================================================== Anmeldung == */

function showLogin(message = '') {
  $('[data-view="login"]').hidden = false;
  $('[data-view="app"]').hidden = true;
  const error = $('[data-login-error]');
  error.hidden = !message;
  error.textContent = message;
}

function showApp() {
  $('[data-view="login"]').hidden = true;
  $('[data-view="app"]').hidden = false;
  $('[data-repo-label]').textContent = `${github.repoPath} · ${github.branch}`;
  $('[data-user-name]').textContent = github.user?.login || '';
  const avatar = $('[data-user-avatar]');
  if (github.user?.avatar_url) {
    avatar.src = github.user.avatar_url;
    avatar.hidden = false;
  }
}

async function signIn(token, remember) {
  setLoading(true, 'Anmeldung wird geprüft …');
  try {
    await github.signIn(token);
    if (!remember) {
      // Token nur für diese Sitzung im Speicher halten
      try { localStorage.removeItem('tagebuch:gh-token'); } catch { /* ignorieren */ }
    }
    media = createMediaResolver(github, MEDIA_DIR);
    showApp();
    await loadTrips();
  } catch (error) {
    github.clearToken();
    showLogin(error.message || 'Anmeldung fehlgeschlagen.');
  } finally {
    setLoading(false);
  }
}

/* =============================================================== Laden ===== */

async function loadTrips() {
  setLoading(true, 'Urlaube werden geladen …');
  try {
    const files = (await github.listDir(CONTENT_DIR)).filter((item) => item.type === 'file' && item.name.endsWith('.json'));

    const loaded = await Promise.all(files.map(async (file) => {
      try {
        const { text, sha } = await github.getFile(file.path);
        const trip = normalizeTrip(JSON.parse(text));
        if (!trip.slug) trip.slug = slugify(file.name.replace(/\.json$/, ''));
        return { trip, path: file.path, sha };
      } catch (error) {
        console.error(`Fehler in ${file.name}:`, error);
        toast(`${file.name} konnte nicht gelesen werden.`, 'error');
        return null;
      }
    }));

    state.trips = loaded.filter(Boolean);
    state.trips.sort((a, b) => (b.trip.startDate || '').localeCompare(a.trip.startDate || ''));
    renderList();
  } catch (error) {
    toast(error.message || 'Urlaube konnten nicht geladen werden.', 'error');
  } finally {
    setLoading(false);
  }
}

/* ============================================================= Übersicht === */

function renderList() {
  $('[data-panel="list"]').hidden = false;
  $('[data-panel="editor"]').hidden = true;

  const list = $('[data-trip-list]');
  const now = new Date();
  list.innerHTML = '';

  // Zusammenfassung nach tatsächlichem Zustand, nicht nach rohem Status –
  // so passt sie zu den Abzeichen in der Liste.
  const counts = {};
  for (const item of state.trips) {
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

  $('[data-list-summary]').textContent = state.trips.length
    ? `${pluralize(state.trips.length, 'Urlaub', 'Urlaube')} · ${summary.join(' · ')}`
    : 'Noch nichts angelegt.';

  for (const item of state.trips) {
    const trip = item.trip;
    const cover = firstImage(trip);
    const stateKey = effectiveState(trip, now);

    const row = el(`
      <article class="trip-row" data-slug="${escapeHtml(trip.slug)}">
        <div class="trip-row__thumb">${cover ? `<img data-src="${escapeHtml(cover.thumb || cover.src)}" alt="">` : ''}</div>
        <div class="trip-row__body">
          <h2 class="trip-row__title">
            <span>${escapeHtml(trip.title)}</span>
            <span class="state" data-state="${stateKey}">${escapeHtml(STATE_LABELS[stateKey] || stateKey)}</span>
          </h2>
          <p class="trip-row__meta">${escapeHtml([trip.location, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')) || '—'}</p>
          <p class="trip-row__stats">${pluralize(trip.entries.length, 'Tag', 'Tage')} · ${pluralize(countImages(trip), 'Bild', 'Bilder')}${trip.publishFrom ? ` · ab ${escapeHtml(humanDateTime(trip.publishFrom))}` : ''}${trip.publishUntil ? ` · bis ${escapeHtml(humanDateTime(trip.publishUntil))}` : ''}</p>
        </div>
        <div class="trip-row__actions">
          <button class="btn btn--quiet btn--small" type="button" data-action="edit">${icons.edit} Bearbeiten</button>
          <button class="btn btn--quiet btn--small" type="button" data-action="toggle">${trip.status === 'published' ? `${icons.eyeOff} Verstecken` : `${icons.eye} Veröffentlichen`}</button>
          <button class="btn btn--quiet btn--small" type="button" data-action="archive" title="Archivieren">${icons.archive}</button>
          <button class="btn btn--quiet btn--small" type="button" data-action="duplicate" title="Duplizieren">${icons.copy}</button>
          <button class="btn btn--quiet btn--small" type="button" data-action="delete" title="Löschen">${icons.trash}</button>
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

  if (action === 'toggle') {
    const next = trip.status === 'published' ? 'draft' : 'published';
    await persistTrip({ ...item, trip: { ...trip, status: next, updatedAt: nowStamp() } },
      next === 'published' ? `Urlaub veröffentlicht: ${trip.title}` : `Urlaub versteckt: ${trip.title}`);
    return;
  }

  if (action === 'archive') {
    const next = trip.status === 'archived' ? 'published' : 'archived';
    await persistTrip({ ...item, trip: { ...trip, status: next, updatedAt: nowStamp() } },
      next === 'archived' ? `Urlaub archiviert: ${trip.title}` : `Urlaub reaktiviert: ${trip.title}`);
    return;
  }

  if (action === 'duplicate') { await duplicateTrip(item); return; }

  if (action === 'delete') {
    const ok = await confirmDialog({
      title: 'Urlaub löschen?',
      text: `„${trip.title}“ wird mit allen Einträgen gelöscht. Bilder, die nur hier verwendet werden, werden ebenfalls entfernt.`,
      confirmLabel: 'Endgültig löschen'
    });
    if (!ok) return;

    setLoading(true, 'Wird gelöscht …');
    try {
      const previousPaths = mediaPathsOf(trip);
      await github.deleteFile({ path: item.path, sha: item.sha, message: `Urlaub gelöscht: ${trip.title}` });
      state.trips = state.trips.filter((t) => t !== item);
      const removed = await cleanUpMedia(previousPaths, null);
      renderList();
      toast(`Urlaub gelöscht${removed ? ` · ${removed} Bilddatei(en) entfernt` : ''}.`, 'success');
      watchDeploy();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
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

  setLoading(true, 'Kopie wird erstellt …');
  try {
    const path = `${CONTENT_DIR}/${copy.slug}.json`;
    const { sha } = await github.putFile({
      path,
      contentBase64: encodeText(`${JSON.stringify(copy, null, 2)}\n`),
      message: `Urlaub dupliziert: ${copy.title}`
    });
    state.trips.unshift({ trip: copy, path, sha });
    renderList();
    toast('Kopie als Entwurf angelegt.', 'success');
    watchDeploy();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

/** Reise speichern und Liste aktualisieren. */
async function persistTrip(item, message) {
  setLoading(true, 'Wird gespeichert …');
  try {
    const trip = normalizeTrip(item.trip);
    const targetPath = `${CONTENT_DIR}/${trip.slug}.json`;
    const renamed = item.path && item.path !== targetPath;

    const { sha } = await github.putFile({
      path: targetPath,
      contentBase64: encodeText(`${JSON.stringify(trip, null, 2)}\n`),
      message,
      sha: renamed ? undefined : item.sha
    });

    if (renamed) {
      try {
        await github.deleteFile({ path: item.path, sha: item.sha, message: `Alte Datei entfernt: ${item.path}` });
      } catch (error) {
        console.warn('Alte Datei konnte nicht entfernt werden:', error);
      }
    }

    const index = state.trips.findIndex((t) => t.path === item.path || t.trip.id === trip.id);
    const record = { trip, path: targetPath, sha };
    if (index >= 0) state.trips[index] = record;
    else state.trips.unshift(record);

    state.trips.sort((a, b) => (b.trip.startDate || '').localeCompare(a.trip.startDate || ''));

    toast('Gespeichert.', 'success');
    watchDeploy();
    return record;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  } finally {
    setLoading(false);
    if (!$('[data-panel="editor"]').hidden) {
      // Editor bleibt offen – nur Kopfzeile aktualisieren
      renderEditorBar();
    } else {
      renderList();
    }
  }
}

/* ------------------------------------------------------- Medien aufräumen -- */

let mediaShaCache = null;

async function mediaShas(force = false) {
  if (!mediaShaCache || force) {
    const items = await github.listDir(MEDIA_DIR);
    mediaShaCache = new Map(items.filter((i) => i.type === 'file').map((i) => [i.name, i.sha]));
  }
  return mediaShaCache;
}

/** Alle Bildpfade einer Reise (Titelbild, Einträge, jeweils Voll- und Vorschaubild). */
function mediaPathsOf(trip) {
  const paths = new Set();
  const add = (image) => {
    if (image?.src) paths.add(image.src);
    if (image?.thumb) paths.add(image.thumb);
  };
  if (!trip) return paths;
  add(trip.coverImage);
  for (const entry of trip.entries || []) for (const image of entry.images || []) add(image);
  return paths;
}

/**
 * Löscht Bilddateien, die nach dem Speichern von keiner Reise mehr verwendet
 * werden. Bewusst erst nach dem Speichern: Solange die Änderung nicht
 * geschrieben ist, könnte sonst eine noch referenzierte Datei verschwinden.
 */
async function cleanUpMedia(previousPaths, keptTrip) {
  const stillUsed = new Set();
  for (const item of state.trips) {
    const trip = item.trip.id === keptTrip?.id ? keptTrip : item.trip;
    for (const path of mediaPathsOf(trip)) stillUsed.add(path);
  }
  if (keptTrip) for (const path of mediaPathsOf(keptTrip)) stillUsed.add(path);

  const orphans = [...previousPaths].filter((path) => !stillUsed.has(path) && path.startsWith('media/'));
  if (!orphans.length) return 0;

  let removed = 0;
  try {
    const shas = await mediaShas(true);
    for (const orphan of orphans) {
      const name = orphan.replace(/^media\//, '');
      const sha = shas.get(name);
      if (!sha) continue;
      try {
        await github.deleteFile({ path: `${MEDIA_DIR}/${name}`, sha, message: `Nicht mehr verwendetes Bild entfernt: ${name}` });
        shas.delete(name);
        removed += 1;
      } catch (error) {
        console.warn(`Bild ${name} konnte nicht gelöscht werden:`, error);
      }
    }
  } catch (error) {
    console.warn('Bilder konnten nicht aufgeräumt werden:', error);
  }
  return removed;
}

/* ================================================================ Editor === */

function openEditor(item) {
  state.current = normalizeTrip(structuredClone(item.trip));
  state.currentPath = item.path;
  state.currentSha = item.sha;
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
          <a class="btn btn--quiet btn--small" href="${escapeHtml(publicUrl(trip.slug))}" target="_blank" rel="noopener">Vorschau</a>
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
  preview.textContent = `${config.siteUrl || ''}${publicUrl(slug)}`;
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
  const image = await uploadFiles([file], $('[data-cover-progress]'), 'titelbild');
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
          text: 'Das Bild wird aus diesem Tag entfernt. Wird es nirgendwo sonst verwendet, wird die Datei beim Speichern auch aus dem Repository gelöscht.',
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
  const uploaded = await uploadFiles(files, $('[data-entry-progress]', card), state.current.slug);
  if (!uploaded?.length) return;
  entry.images.push(...uploaded);
  markDirty();
  renderEntries();
}

/**
 * Dateien verkleinern, hochladen und Fortschritt anzeigen.
 * Gibt die fertigen Bild-Datensätze zurück.
 */
async function uploadFiles(files, progressBox, prefix) {
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

  paint(`0 von ${total} hochgeladen`);
  const results = [];

  for (const file of usable) {
    try {
      paint(`${done} von ${total} · „${file.name}“ wird verkleinert …`);
      const prepared = await prepareImage(file);
      savedBytes += Math.max(0, prepared.originalSize - prepared.newSize);

      paint(`${done} von ${total} · „${file.name}“ wird hochgeladen …`);
      const image = await uploadImage({ github, mediaDir: MEDIA_DIR, prepared, prefix });

      // Sofortige Vorschau, ohne auf GitHub zu warten
      media.registerLocal(image.src, prepared.full);
      media.registerLocal(image.thumb, prepared.thumb);

      results.push(image);
      done += 1;
      paint(`${done} von ${total} hochgeladen`);
    } catch (error) {
      console.error(error);
      toast(`„${file.name}“: ${error.message}`, 'error');
    }
  }

  box.innerHTML = '';
  if (results.length) {
    toast(`${results.length} Bild${results.length === 1 ? '' : 'er'} hochgeladen${savedBytes > 1024 * 100 ? ` · ${formatBytes(savedBytes)} eingespart` : ''}.`, 'success');
    watchDeploy();
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

async function saveCurrent() {
  const trip = state.current;
  if (!trip) return;

  if (!trip.title.trim()) { toast('Bitte einen Namen für den Urlaub angeben.', 'error'); return; }
  if (!trip.startDate) { toast('Bitte ein Startdatum angeben.', 'error'); return; }
  if (!trip.endDate) trip.endDate = trip.startDate;
  if (trip.endDate < trip.startDate) { toast('Das Enddatum liegt vor dem Startdatum.', 'error'); return; }

  const taken = new Set(state.trips.filter((t) => t.trip.id !== trip.id).map((t) => t.trip.slug));
  trip.slug = uniqueSlug(trip.slug || trip.title, taken);
  trip.updatedAt = nowStamp();

  const previousPaths = mediaPathsOf(state.trips.find((t) => t.trip.id === trip.id)?.trip);

  const record = await persistTrip(
    { trip, path: state.currentPath, sha: state.currentSha },
    `Urlaub gespeichert: ${trip.title}`
  );

  if (record) {
    const removed = await cleanUpMedia(previousPaths, record.trip);
    if (removed) toast(`${removed} nicht mehr verwendete${removed === 1 ? 's Bild' : ' Bilder'} gelöscht.`);

    // Wichtig: state.current NICHT ersetzen. Die Formularfelder und
    // Bild-Aktionen im DOM halten Referenzen auf genau diese Objekte –
    // eine frische Kopie würde alle folgenden Änderungen ins Leere laufen
    // lassen. In der Liste liegt ohnehin eine eigene, normalisierte Fassung.
    state.currentPath = record.path;
    state.currentSha = record.sha;
    markDirty(false);
    const slugField = $('[data-field="slug"]');
    if (slugField) slugField.value = trip.slug;
    updateSlugPreview();
  }
}

async function createTrip() {
  const taken = new Set(state.trips.map((t) => t.trip.slug));
  const trip = emptyTrip({ title: 'Neuer Urlaub' });
  trip.slug = uniqueSlug('neuer-urlaub', taken);
  openEditor({ trip, path: '', sha: '' });
  markDirty(true);
  $('[data-field="title"]')?.select?.();
}

/* ---------------------------------------------------------- Deploy-Status -- */

let deployTimer = null;

async function watchDeploy(attempt = 0) {
  const bar = $('[data-deploy-bar]');
  if (!bar) return;
  clearTimeout(deployTimer);

  const run = await github.latestRun();
  if (!run) { bar.hidden = true; return; }

  const status = run.status === 'completed' ? run.conclusion : run.status;
  const labels = {
    queued: 'Website-Build ist eingereiht …',
    in_progress: 'Website wird neu gebaut …',
    success: 'Website ist aktuell.',
    failure: 'Der letzte Build ist fehlgeschlagen.',
    cancelled: 'Der letzte Build wurde abgebrochen.'
  };

  bar.hidden = false;
  $('[data-deploy-dot]', bar).dataset.status = status;
  $('[data-deploy-text]', bar).textContent = labels[status] || `Build: ${status}`;

  if ((run.status !== 'completed' || attempt === 0) && attempt < 24) {
    deployTimer = setTimeout(() => watchDeploy(attempt + 1), run.status === 'completed' ? 12000 : 8000);
  }
}

/* ================================================================== Start == */

function init() {
  initTheme();

  $('[data-repo-name]').textContent = `${repoConfig.owner}/${repoConfig.name}`;

  $('[data-login-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const token = $('[data-token-input]').value.trim();
    const remember = $('[data-remember]').checked;
    if (token) signIn(token, remember);
  });

  $('[data-logout]').addEventListener('click', async () => {
    if (state.dirty) {
      const ok = await confirmDialog({
        title: 'Abmelden?',
        text: 'Es gibt ungespeicherte Änderungen, die verloren gehen.',
        confirmLabel: 'Trotzdem abmelden'
      });
      if (!ok) return;
    }
    github.clearToken();
    state.trips = [];
    state.current = null;
    markDirty(false);
    $('[data-token-input]').value = '';
    showLogin();
  });

  $('[data-new-trip]').addEventListener('click', createTrip);
  $('[data-reload]').addEventListener('click', loadTrips);
  $('[data-go-list]').addEventListener('click', () => {
    if (state.current) leaveEditor();
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
  });

  // Bereits vorhandenes Token automatisch verwenden
  const token = github.loadToken();
  if (token) signIn(token, true);
  else showLogin();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
