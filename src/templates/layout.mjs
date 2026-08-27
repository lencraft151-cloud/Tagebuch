/** Basis-HTML-Gerüst für alle Seiten. */

import { escapeHtml } from '../lib/format.mjs';

export function joinUrl(base, path = '') {
  const cleanBase = String(base || '/').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  if (!cleanPath) return `${cleanBase}/`;
  return `${cleanBase}/${cleanPath}`;
}

export function absoluteUrl(siteUrl, base, path = '') {
  const origin = String(siteUrl || '').replace(/\/+$/, '');
  if (!origin) return joinUrl(base, path);
  try {
    const url = new URL(origin);
    return `${url.origin}${joinUrl(base, path)}`;
  } catch {
    return joinUrl(base, path);
  }
}

const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400&family=Inter:wght@400;500;600;700&display=swap';

export function renderLayout(options) {
  const {
    config,
    base,
    version,
    title,
    description,
    canonicalPath = '',
    ogImage = '',
    ogType = 'website',
    bodyClass = '',
    noindex = false,
    head = '',
    header = '',
    main = '',
    footer = '',
    scripts = [],
    jsonLd = null,
    inlineHeadScript = '',
    htmlAttrs = {}
  } = options;

  const canonical = absoluteUrl(config.siteUrl, base, canonicalPath);
  const fullTitle = title === config.title ? title : `${title} · ${config.title}`;
  const image = ogImage ? (/^https?:/i.test(ogImage) ? ogImage : absoluteUrl(config.siteUrl, base, ogImage)) : '';

  return `<!doctype html>
<html lang="${escapeHtml(config.language || 'de')}" data-base="${escapeHtml(joinUrl(base))}"${Object.entries(htmlAttrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('')}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description || config.description)}">
<meta name="author" content="${escapeHtml(config.author || '')}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#faf7f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#12100e" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${escapeHtml(canonical)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}

<meta property="og:site_name" content="${escapeHtml(config.title)}">
<meta property="og:type" content="${escapeHtml(ogType)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description || config.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:locale" content="${escapeHtml(config.locale || 'de_DE')}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n<meta property="og:image:alt" content="${escapeHtml(title)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description || config.description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}

<link rel="icon" href="${joinUrl(base, 'assets/favicon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${joinUrl(base, 'assets/icon-180.png')}">
<link rel="manifest" href="${joinUrl(base, 'manifest.webmanifest')}">
${config.theme?.useGoogleFonts ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${GOOGLE_FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${GOOGLE_FONTS}"></noscript>` : ''}
<link rel="stylesheet" href="${joinUrl(base, `assets/site.css?v=${version}`)}">
<script>
(function () {
  try {
    var stored = localStorage.getItem('tagebuch:theme');
    var mode = stored || ${JSON.stringify(config.theme?.defaultMode || 'system')};
    if (mode === 'system') {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themePref = stored || 'system';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
</script>
${inlineHeadScript ? `<script>${inlineHeadScript}</script>` : ''}
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
${head}
</head>
<body class="${escapeHtml(bodyClass)}">
<a class="skip-link" href="#inhalt">Zum Inhalt springen</a>
${header}
<main id="inhalt">
${main}
</main>
${footer}
${scripts.map((src) => `<script type="module" src="${joinUrl(base, `${src}?v=${version}`)}"></script>`).join('\n')}
</body>
</html>`;
}

export function renderHeader({ config, base, active = 'home' }) {
  return `<header class="site-header" data-header>
  <div class="shell site-header__inner">
    <a class="brand" href="${joinUrl(base)}">
      <span class="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 21.5z"/>
          <path d="M9 3v18"/><path d="M13 8h4"/><path d="M13 12h4"/>
        </svg>
      </span>
      <span class="brand__text">
        <strong>${escapeHtml(config.title)}</strong>
        <small>${escapeHtml(config.tagline || '')}</small>
      </span>
    </a>

    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="hauptnavigation" data-nav-toggle>
      <span class="nav-toggle__box" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="sr-only">Menü öffnen</span>
    </button>

    <nav class="site-nav" id="hauptnavigation" data-nav aria-label="Hauptnavigation">
      <a class="site-nav__link${active === 'home' ? ' is-active' : ''}" href="${joinUrl(base)}">Reisen</a>
      <a class="site-nav__link${active === 'archive' ? ' is-active' : ''}" href="${joinUrl(base, '#archiv')}" data-archive-link>Archiv</a>
      <a class="site-nav__link${active === 'about' ? ' is-active' : ''}" href="${joinUrl(base, '#über')}">Über</a>
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Farbschema umschalten" title="Farbschema umschalten">
        <svg class="theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
        </svg>
        <svg class="theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
        </svg>
      </button>
    </nav>
  </div>
</header>`;
}

export function renderFooter({ config, base }) {
  const year = new Date().getFullYear();
  return `<footer class="site-footer" id="über">
  <div class="shell site-footer__inner">
    <div class="site-footer__about">
      <h2 class="site-footer__title">${escapeHtml(config.title)}</h2>
      <p>${escapeHtml(config.description)}</p>
    </div>
    <div class="site-footer__meta">
      <p><a href="${joinUrl(base)}">Alle Reisen</a></p>
      <p>© ${year} ${escapeHtml(config.author || config.title)}</p>
      <p class="site-footer__note">${escapeHtml(config.footer?.note || '')}</p>
    </div>
  </div>
</footer>`;
}
