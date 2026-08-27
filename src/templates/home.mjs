/** Startseite: Hero, Suche/Filter, Reise-Karten, Archiv. */

import { escapeHtml, pluralize } from '../lib/format.mjs';
import { renderTripCard } from './components.mjs';
import { absoluteUrl } from './layout.mjs';

export function renderHome({ config, base, featured, trips, archived, years, stats, now }) {

  return `
<section class="hero">
  <div class="shell hero__inner">
    <p class="hero__eyebrow">${escapeHtml(config.tagline || 'Reisetagebuch')}</p>
    <h1 class="hero__title">${escapeHtml(config.title)}</h1>
    <p class="hero__lead">${escapeHtml(config.description)}</p>
    <dl class="hero__stats">
      <div><dt>Reisen</dt><dd data-stat="trips">${stats.trips}</dd></div>
      <div><dt>Tagebuch-Einträge</dt><dd data-stat="entries">${stats.entries}</dd></div>
      <div><dt>Bilder</dt><dd data-stat="images">${stats.images}</dd></div>
    </dl>
  </div>
  <div class="hero__glow" aria-hidden="true"></div>
</section>

${featured ? `<section class="featured shell" aria-label="Neueste Reise">
  ${renderTripCard({ trip: featured, base, now, featured: true })}
</section>` : ''}

<section class="collection shell" id="reisen" aria-labelledby="reisen-titel">
  <div class="collection__head">
    <h2 class="section-title" id="reisen-titel">Alle Reisen</h2>
    <form class="toolbar" role="search" data-filter-form autocomplete="off" onsubmit="return false">
      <div class="field field--search">
        <svg class="field__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
        </svg>
        <input type="search" id="suche" name="q" placeholder="Reise, Ort oder Text suchen…" aria-label="Reisen durchsuchen" data-search-input>
        <button class="field__clear" type="button" data-search-clear hidden aria-label="Suche zurücksetzen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="field field--year">
        <label class="sr-only" for="jahr">Nach Jahr filtern</label>
        <select id="jahr" name="year" data-year-select>
          <option value="">Alle Jahre</option>
${years.map((year) => `          <option value="${year}">${year}</option>`).join('\n')}
        </select>
        <svg class="field__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </div>
    </form>
  </div>

  <p class="collection__count" data-result-count hidden></p>

  <div class="trip-grid" data-trip-grid>
${trips.map((trip) => renderTripCard({
    trip,
    base,
    now,
    // Die hervorgehobene Reise steht zusätzlich versteckt im Raster, damit sie
    // beim Suchen und Filtern gefunden wird.
    duplicate: Boolean(featured) && trip.slug === featured.slug
  })).join('\n')}
  </div>

  <p class="empty-state" data-empty-state${featured || archived.length ? ' hidden' : ''}>
    <strong>Noch keine Reise veröffentlicht.</strong>
    <span>Sobald ein Urlaub veröffentlicht wird, erscheint er hier automatisch.</span>
  </p>

  <p class="empty-state" data-no-results hidden>
    <strong>Keine Treffer.</strong>
    <span>Für diese Suche gibt es keine Reise. Versuche einen anderen Begriff oder ein anderes Jahr.</span>
  </p>
</section>

<section class="collection collection--archive shell" id="archiv" aria-labelledby="archiv-titel"${archived.length ? '' : ' hidden'} data-archive-section>
  <div class="collection__head">
    <h2 class="section-title" id="archiv-titel">Archiv</h2>
    <p class="section-lead">Ältere Reisen, die nicht mehr in der Übersicht erscheinen.</p>
  </div>
  <div class="trip-grid trip-grid--compact" data-archive-grid>
${archived.map((trip) => renderTripCard({ trip, base, now })).join('\n')}
  </div>
</section>
`;
}

export function homeJsonLd({ config, base, trips, siteUrl }) {
  const abs = (path) => absoluteUrl(siteUrl, base, path);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: config.title,
    description: config.description,
    url: abs(''),
    inLanguage: config.language || 'de',
    hasPart: trips.slice(0, 20).map((trip) => ({
      '@type': 'Article',
      headline: trip.title,
      url: abs(`reisen/${trip.slug}/`),
      datePublished: trip.startDate || undefined
    }))
  };
}

export function homeStatsText(stats) {
  return `${pluralize(stats.trips, 'Reise', 'Reisen')}, ${pluralize(stats.entries, 'Eintrag', 'Einträge')}, ${pluralize(stats.images, 'Bild', 'Bilder')}`;
}
