/** Detailseite einer Reise. */

import { escapeHtml, formatDateRange, formatDateTime, renderRichText, pluralize, isoDate, excerpt } from '../lib/format.mjs';
import { effectiveState, firstImage, countImages } from '../lib/trips.mjs';
import { renderImage, renderEntry, renderDayNav, renderLightbox } from './components.mjs';
import { joinUrl, absoluteUrl } from './layout.mjs';

export function renderTripPage({ config, base, trip, entries, now, prev, next }) {
  const notices = tripGateNotices(trip);
  const cover = firstImage(trip);
  const state = effectiveState(trip, now);
  const meta = [trip.location, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean);
  const stats = [
    pluralize(entries.length, 'Tag', 'Tage'),
    pluralize(countImages(trip), 'Bild', 'Bilder')
  ];

  return `
<article class="trip" data-trip data-slug="${escapeHtml(trip.slug)}">
  <header class="trip-hero${cover ? '' : ' trip-hero--plain'}">
    ${cover ? `<div class="trip-hero__media">
      ${renderImage({ image: { ...cover, alt: cover.alt || trip.title }, base, className: 'media--hero', sizes: '100vw', lazy: false, ratio: '16 / 9' })}
      <div class="trip-hero__scrim" aria-hidden="true"></div>
    </div>` : ''}
    <div class="shell trip-hero__inner">
      <a class="back-link" href="${joinUrl(base)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        Alle Reisen
      </a>
      ${state === 'archived' ? '<p class="badge badge--archive badge--inline">Archivierte Reise</p>' : ''}
      <h1 class="trip-hero__title">${escapeHtml(trip.title)}</h1>
      <p class="trip-hero__meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('<i aria-hidden="true">·</i>')}</p>
      <p class="trip-hero__stats">${stats.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</p>
      <div class="trip-hero__actions">
        <button class="btn btn--ghost" type="button" data-share data-title="${escapeHtml(trip.title)}" data-url="${escapeHtml(absoluteUrl(config.siteUrl, base, `reisen/${trip.slug}/`))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/>
          </svg>
          <span data-share-label>Reise teilen</span>
        </button>
      </div>
    </div>
  </header>

  <div class="trip-gate" data-trip-gate>
    <div class="shell trip-gate__inner">
      <span class="trip-gate__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      </span>
      <h2 class="trip-gate__title">Diese Reise ist gerade nicht verfügbar.</h2>
${Object.entries(notices).map(([key, text]) => `      <p class="trip-gate__note" data-state="${key}">${escapeHtml(text)}</p>`).join('\n')}
      <a class="btn btn--primary" href="${joinUrl(base)}">Zur Übersicht</a>
    </div>
  </div>

  <div class="trip-body" data-trip-body>
    ${trip.description ? `<section class="trip-intro shell">
      <div class="prose prose--lead">${renderRichText(trip.description)}</div>
    </section>` : ''}

    ${renderDayNav(entries)}

    <div class="entries shell" id="tagebuch">
${entries.length
    ? entries.map((entry, index) => renderEntry({ entry, base, index, total: entries.length })).join('\n')
    : `<p class="empty-state"><strong>Noch keine Einträge.</strong><span>Für diese Reise wurden noch keine Tage dokumentiert.</span></p>`}
    </div>

    <nav class="trip-pager shell" aria-label="Weitere Reisen">
      ${prev ? `<a class="trip-pager__item trip-pager__item--prev" href="${joinUrl(base, `reisen/${prev.slug}/`)}">
        <span class="trip-pager__label">Vorherige Reise</span>
        <span class="trip-pager__title">${escapeHtml(prev.title)}</span>
      </a>` : '<span></span>'}
      ${next ? `<a class="trip-pager__item trip-pager__item--next" href="${joinUrl(base, `reisen/${next.slug}/`)}">
        <span class="trip-pager__label">Nächste Reise</span>
        <span class="trip-pager__title">${escapeHtml(next.title)}</span>
      </a>` : '<span></span>'}
    </nav>
  </div>
</article>

${renderLightbox()}
`;
}

/**
 * Blockierendes Inline-Skript: setzt den Sichtbarkeits-Zustand noch vor dem
 * ersten Rendern, damit geplante/abgelaufene Reisen nicht kurz aufblitzen.
 */
export function tripGateScript(trip) {
  const payload = {
    status: trip.status,
    publishFrom: trip.publishFrom || '',
    publishUntil: trip.publishUntil || '',
    onExpire: trip.onExpire
  };
  return `window.__TRIP__=${JSON.stringify(payload)};(function(){var t=window.__TRIP__;function p(v){if(!v)return null;var m=/^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2}))?$/.exec(v);if(!m)return null;return new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0));}var n=new Date(),f=p(t.publishFrom),u=p(t.publishUntil),s='live';if(t.status==='draft')s='draft';else if(f&&n<f)s='scheduled';else if(u&&n>u)s=(t.onExpire==='archive')?'archived':'expired';else if(t.status==='archived')s='archived';document.documentElement.dataset.tripState=s;})();`;
}

export function tripJsonLd({ config, base, trip, entries }) {
  const cover = firstImage(trip);
  const abs = (path) => absoluteUrl(config.siteUrl, base, path);
  const images = [];
  if (cover?.src) images.push(abs(cover.src));
  for (const entry of entries) {
    for (const image of entry.images.slice(0, 3)) images.push(abs(image.src));
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: trip.title,
    description: excerpt(trip.description, 300),
    inLanguage: config.language || 'de',
    author: { '@type': 'Person', name: config.author || config.title },
    datePublished: isoDate(trip.startDate) || undefined,
    dateModified: trip.updatedAt || undefined,
    mainEntityOfPage: abs(`reisen/${trip.slug}/`),
    image: images.slice(0, 8),
    ...(trip.location ? { contentLocation: { '@type': 'Place', name: trip.location } } : {})
  };
}

export function tripGateNotices(trip) {
  return {
    scheduled: trip.publishFrom
      ? `Diese Reise wird am ${formatDateTime(trip.publishFrom)} veröffentlicht.`
      : 'Diese Reise ist noch nicht veröffentlicht.',
    expired: trip.publishUntil
      ? `Diese Reise war bis ${formatDateTime(trip.publishUntil)} verfügbar.`
      : 'Diese Reise ist nicht mehr verfügbar.',
    draft: 'Diese Reise ist ein Entwurf und noch nicht veröffentlicht.'
  };
}
