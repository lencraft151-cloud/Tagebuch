/** 404-Seite (GitHub Pages liefert /404.html automatisch aus). */

import { escapeHtml } from '../lib/format.mjs';
import { joinUrl } from './layout.mjs';

export function renderNotFound({ config, base, trips }) {
  const suggestions = trips.slice(0, 3);
  return `
<section class="notfound">
  <div class="shell notfound__inner">
    <p class="notfound__code" aria-hidden="true">404</p>
    <h1 class="notfound__title">Diese Seite gibt es nicht.</h1>
    <p class="notfound__text">
      Vielleicht wurde die Reise umbenannt, ist noch nicht veröffentlicht oder der Link enthält einen Tippfehler.
    </p>
    <div class="notfound__actions">
      <a class="btn btn--primary" href="${joinUrl(base)}">Zur Startseite</a>
      <a class="btn btn--ghost" href="${joinUrl(base, '#reisen')}">Alle Reisen ansehen</a>
    </div>
    ${suggestions.length ? `<div class="notfound__suggestions">
      <h2 class="notfound__subtitle">Zuletzt veröffentlicht</h2>
      <ul>
${suggestions.map((trip) => `        <li><a href="${joinUrl(base, `reisen/${trip.slug}/`)}">${escapeHtml(trip.title)}</a></li>`).join('\n')}
      </ul>
    </div>` : ''}
  </div>
  <div class="hero__glow" aria-hidden="true"></div>
</section>
`;
}
