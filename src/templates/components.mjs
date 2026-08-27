/** Wiederverwendbare HTML-Bausteine (Karten, Bilder, Galerien, Einträge). */

import { escapeHtml, formatDateRange, formatDate, formatTime, renderRichText, pluralize, isoDate } from '../lib/format.mjs';
import { effectiveState, firstImage, countImages } from '../lib/trips.mjs';
import { joinUrl } from './layout.mjs';

/** Bildquelle relativ zur Basis auflösen (externe URLs bleiben unberuehrt). */
export function imageUrl(base, src) {
  if (!src) return '';
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
  return joinUrl(base, src.replace(/^\.?\//, ''));
}

export function renderImage({ image, base, className = '', sizes = '100vw', lazy = true, group = '', index = 0, ratio = '' }) {
  if (!image?.src) return '';
  const full = imageUrl(base, image.src);
  const thumb = image.thumb ? imageUrl(base, image.thumb) : full;
  const alt = image.alt || image.caption || '';
  const hasSize = image.width > 0 && image.height > 0;
  const aspect = ratio || (hasSize ? `${image.width} / ${image.height}` : '');
  const styleParts = [];
  if (aspect) styleParts.push(`--ratio:${aspect}`);
  if (image.placeholder) styleParts.push(`--placeholder:url("${image.placeholder.replace(/"/g, '%22')}")`);
  const style = styleParts.length ? ` style="${styleParts.join(';')}"` : '';

  const srcset = image.thumb && image.thumb !== image.src
    ? ` srcset="${escapeHtml(thumb)} 800w, ${escapeHtml(full)} ${Math.max(1200, image.width || 1600)}w" sizes="${escapeHtml(sizes)}"`
    : '';

  return `<figure class="media ${className}"${style}${group ? ` data-lightbox-group="${escapeHtml(group)}" data-lightbox-index="${index}"` : ''}>
  <img src="${escapeHtml(thumb)}"${srcset} alt="${escapeHtml(alt)}"${hasSize ? ` width="${image.width}" height="${image.height}"` : ''} loading="${lazy ? 'lazy' : 'eager'}" decoding="async" data-full="${escapeHtml(full)}" data-caption="${escapeHtml(image.caption || '')}" onload="this.closest('.media')?.classList.add('is-loaded')">
  ${image.caption ? `<figcaption class="media__caption">${escapeHtml(image.caption)}</figcaption>` : ''}
</figure>`;
}

export function renderTripCard({ trip, base, now = new Date(), featured = false, duplicate = false }) {
  const cover = firstImage(trip);
  const state = effectiveState(trip, now);
  const href = joinUrl(base, `reisen/${trip.slug}/`);
  const meta = [trip.location, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean);
  const stats = [
    pluralize(trip.entries.length, 'Tag', 'Tage'),
    pluralize(countImages(trip), 'Bild', 'Bilder')
  ];

  return `<article class="trip-card${featured ? ' trip-card--featured' : ''}"
  data-trip-card${duplicate ? ' data-duplicate="featured" hidden' : ''}
  data-slug="${escapeHtml(trip.slug)}"
  data-state="${escapeHtml(state)}"
  data-status="${escapeHtml(trip.status)}"
  data-publish-from="${escapeHtml(trip.publishFrom || '')}"
  data-publish-until="${escapeHtml(trip.publishUntil || '')}"
  data-on-expire="${escapeHtml(trip.onExpire)}"
  data-years="${escapeHtml((trip.years || []).join(','))}"
  data-search="${escapeHtml((trip.search || `${trip.title} ${trip.location}`).toLowerCase())}">
  <a class="trip-card__link" href="${href}">
    <div class="trip-card__figure">
      ${cover
        ? renderImage({ image: { ...cover, alt: cover.alt || trip.title }, base, className: 'media--cover', sizes: featured ? '(max-width: 900px) 100vw, 1100px' : '(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 380px', lazy: !featured, ratio: featured ? '16 / 9' : '4 / 3' })
        : '<div class="media media--cover media--empty" aria-hidden="true"></div>'}
      ${state === 'archived' ? '<span class="badge badge--archive">Archiv</span>' : ''}
    </div>
    <div class="trip-card__body">
      <h3 class="trip-card__title">${escapeHtml(trip.title)}</h3>
      <p class="trip-card__meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('<i aria-hidden="true">·</i>')}</p>
      ${trip.summary || trip.description ? `<p class="trip-card__summary">${escapeHtml(trip.summary || '')}</p>` : ''}
      <p class="trip-card__stats">${stats.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</p>
    </div>
  </a>
</article>`;
}

export function renderGallery({ images, base, group }) {
  if (!images?.length) return '';
  const layoutClass = images.length === 1 ? 'gallery--single' : images.length === 2 ? 'gallery--duo' : 'gallery--grid';
  return `<div class="gallery ${layoutClass}" data-gallery data-count="${images.length}">
${images.map((image, index) => renderImage({
    image,
    base,
    className: 'media--gallery',
    sizes: images.length === 1 ? '(max-width: 900px) 100vw, 860px' : '(max-width: 640px) 100vw, 440px',
    group,
    index
  })).join('\n')}
</div>`;
}

export function renderEntry({ entry, base, index, total }) {
  const meta = [];
  if (entry.time) meta.push(formatTime(entry.time));
  if (entry.location) meta.push(entry.location);

  return `<article class="entry" id="tag-${index + 1}" data-entry data-index="${index}">
  <div class="entry__rail" aria-hidden="true">
    <span class="entry__dot"></span>
    <span class="entry__line"></span>
  </div>
  <header class="entry__header">
    <p class="entry__eyebrow">
      <span class="entry__number">Tag ${index + 1}<span class="entry__of"> / ${total}</span></span>
      ${entry.date ? `<time class="entry__date" datetime="${escapeHtml(isoDate(entry.date))}">${escapeHtml(formatDate(entry.date, 'long'))}</time>` : ''}
    </p>
    <h2 class="entry__title">${escapeHtml(entry.title)}</h2>
    ${meta.length ? `<p class="entry__meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('<i aria-hidden="true">·</i>')}</p>` : ''}
  </header>
  ${entry.text ? `<div class="entry__text prose">${renderRichText(entry.text)}</div>` : ''}
  ${renderGallery({ images: entry.images, base, group: `entry-${index}` })}
</article>`;
}

export function renderDayNav(entries) {
  if (entries.length < 2) return '';
  return `<nav class="day-nav" aria-label="Tage" data-day-nav>
  <div class="day-nav__track">
${entries.map((entry, index) => `    <a class="day-chip" href="#tag-${index + 1}">
      <span class="day-chip__num">Tag ${index + 1}</span>
      ${entry.date ? `<span class="day-chip__date">${escapeHtml(formatDate(entry.date, 'day'))}</span>` : ''}
    </a>`).join('\n')}
  </div>
</nav>`;
}

export function renderLightbox() {
  return `<div class="lightbox" data-lightbox hidden aria-hidden="true" role="dialog" aria-modal="true" aria-label="Bildansicht">
  <div class="lightbox__backdrop" data-lightbox-close></div>
  <figure class="lightbox__figure">
    <img class="lightbox__image" alt="" data-lightbox-image>
    <figcaption class="lightbox__caption" data-lightbox-caption></figcaption>
  </figure>
  <button class="lightbox__btn lightbox__btn--close" type="button" data-lightbox-close aria-label="Schließen">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>
  <button class="lightbox__btn lightbox__btn--prev" type="button" data-lightbox-prev aria-label="Vorheriges Bild">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
  </button>
  <button class="lightbox__btn lightbox__btn--next" type="button" data-lightbox-next aria-label="Nächstes Bild">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
  </button>
  <p class="lightbox__counter" data-lightbox-counter></p>
  <div class="lightbox__spinner" data-lightbox-spinner hidden><span class="spinner"></span></div>
</div>`;
}
