#!/usr/bin/env node
/**
 * Statischer Generator für das Urlaubs-Tagebuch.
 *
 * - liest die Reisen aus content/trips/*.json
 * - rendert eine vorgerenderte HTML-Seite je Reise (echtes SEO + Open Graph)
 * - erzeugt Suchindex, Sitemap, robots.txt, Manifest, Icons
 * - kopiert Medien, Styles, Skripte und den Admin-Bereich nach dist/
 *
 * Bewusst ohne externe Abhängigkeiten, damit der Build auf GitHub Pages
 * (GitHub Actions) ohne Installation und ohne Lockfile-Pflege laeuft.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  normalizeTrip,
  sortEntriesChronologically,
  sortTripsByDate,
  effectiveState,
  isDeployable,
  toIndexEntry,
  tripYears,
  countImages,
  firstImage
} from './lib/trips.mjs';
import { excerpt, isoDate } from './lib/format.mjs';
import { renderLayout, renderHeader, renderFooter, joinUrl, absoluteUrl } from './templates/layout.mjs';
import { renderHome, homeJsonLd } from './templates/home.mjs';
import { renderTripPage, tripGateScript, tripJsonLd } from './templates/trip.mjs';
import { renderNotFound } from './templates/notfound.mjs';
import { makeIcon } from './lib/icon.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const log = (...args) => console.log('  ', ...args);

/* ------------------------------------------------------------------ Utils */

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`Konnte ${path.relative(ROOT, file)} nicht lesen: ${error.message}`);
  }
}

function writeFile(relPath, contents) {
  const target = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function copyDir(from, to, transform = null) {
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const src = path.join(from, item.name);
    const dest = path.join(to, item.name);
    if (item.isDirectory()) {
      count += copyDir(src, dest, transform);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (transform && /\.(mjs|js|css|html|webmanifest|json|txt|svg)$/i.test(item.name)) {
        fs.writeFileSync(dest, transform(fs.readFileSync(src, 'utf8'), item.name));
      } else {
        fs.copyFileSync(src, dest);
      }
      count += 1;
    }
  }
  return count;
}

function hashOf(values) {
  const hash = crypto.createHash('sha1');
  for (const value of values) hash.update(String(value));
  return hash.digest('hex').slice(0, 10);
}

function normalizeBase(value) {
  let base = String(value || '/').trim();
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base.replace(/\/{2,}/g, '/');
}

/* --------------------------------------------------------------- Konfig */

function loadConfig() {
  const config = readJson(path.join(ROOT, 'site.config.json'));

  // GitHub Actions liefert den korrekten Basis-Pfad (inkl. Custom Domain).
  const envBase = process.env.SITE_BASE || process.env.PAGES_BASE_PATH || '';
  const envUrl = process.env.SITE_URL || process.env.PAGES_URL || '';

  const base = normalizeBase(envBase || config.basePath || '/');
  const siteUrl = (envUrl || config.siteUrl || '').replace(/\/+$/, '');

  // Aufgelöste Werte zurückschreiben: Vorlagen greifen auf config.siteUrl und
  // config.basePath zu und müssen dieselben Werte sehen wie der Build.
  config.siteUrl = siteUrl;
  config.basePath = base;

  return { config, base, siteUrl };
}

/* --------------------------------------------------------------- Inhalte */

function loadTrips(config) {
  const dir = path.join(ROOT, config.repo?.contentDir || 'content/trips');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const trips = [];
  const seenSlugs = new Map();

  for (const file of files) {
    const full = path.join(dir, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
      console.error(`   ! ${file} ist kein gültiges JSON und wird übersprungen: ${error.message}`);
      continue;
    }
    const trip = normalizeTrip({ ...raw, slug: raw.slug || path.basename(file, '.json') });
    trip.entries = sortEntriesChronologically(trip.entries);
    trip.sourceFile = file;

    if (seenSlugs.has(trip.slug)) {
      console.error(`   ! Doppelter Slug "${trip.slug}" (${file} und ${seenSlugs.get(trip.slug)}) - ${file} wird übersprungen.`);
      continue;
    }
    seenSlugs.set(trip.slug, file);
    trips.push(trip);
  }

  return sortTripsByDate(trips);
}

/* ----------------------------------------------------------------- Build */

function build() {
  const started = Date.now();
  const { config, base, siteUrl } = loadConfig();
  const now = new Date();

  console.log(`\n▸ Urlaubs-Tagebuch wird gebaut`);
  log(`Basis-Pfad : ${base}`);
  log(`Site-URL   : ${siteUrl || '(nicht gesetzt)'}`);

  const allTrips = loadTrips(config);
  const deployable = allTrips.filter(isDeployable);
  const drafts = allTrips.length - deployable.length;

  const live = deployable.filter((trip) => effectiveState(trip, now) === 'live');
  const archived = deployable.filter((trip) => effectiveState(trip, now) === 'archived');

  log(`Reisen     : ${allTrips.length} gesamt · ${live.length} sichtbar · ${archived.length} archiviert · ${drafts} Entwurf/Entwuerfe (nicht deployt)`);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // Version für Cache-Busting aus Inhalt + Assets ableiten
  const assetFingerprint = [];
  for (const dir of ['assets/css', 'assets/js']) {
    const full = path.join(__dirname, dir);
    const walk = (p) => {
      if (!fs.existsSync(p)) return;
      for (const item of fs.readdirSync(p, { withFileTypes: true })) {
        const child = path.join(p, item.name);
        if (item.isDirectory()) walk(child);
        else assetFingerprint.push(fs.readFileSync(child));
      }
    };
    walk(full);
  }
  const version = hashOf([...assetFingerprint, JSON.stringify(deployable.map((t) => t.updatedAt + t.slug))]);
  log(`Version    : ${version}`);

  /* --- Assets ------------------------------------------------------- */

  const withVersion = (source) =>
    source.replace(/from\s+(['"])(\.\.?\/[^'"]+\.mjs)\1/g, (m, q, spec) => `from ${q}${spec}?v=${version}${q}`);

  copyDir(path.join(__dirname, 'assets/css'), path.join(DIST, 'assets'));
  copyDir(path.join(__dirname, 'assets/js'), path.join(DIST, 'assets/js'), withVersion);
  copyDir(path.join(__dirname, 'lib'), path.join(DIST, 'assets/js/lib'), withVersion);
  copyDir(path.join(__dirname, 'static'), path.join(DIST, 'assets'));

  // Medien
  const mediaFrom = path.join(ROOT, config.repo?.mediaDir || 'content/media');
  const mediaCount = copyDir(mediaFrom, path.join(DIST, 'media'));
  log(`Medien     : ${mediaCount} Datei(en)`);

  // Icons
  writeFile('assets/favicon.svg', makeIcon.svg(config.theme?.accent || '#c2683a'));
  writeFile('assets/icon-180.png', makeIcon.png(180, config.theme?.accent || '#c2683a'));
  writeFile('assets/icon-512.png', makeIcon.png(512, config.theme?.accent || '#c2683a'));

  /* --- Daten -------------------------------------------------------- */

  const index = deployable.map(toIndexEntry);
  writeFile('data/trips.json', JSON.stringify({ generatedAt: now.toISOString(), base, trips: index }, null, 0));

  for (const trip of deployable) {
    const { sourceFile, ...clean } = trip;
    writeFile(`data/reisen/${trip.slug}.json`, JSON.stringify(clean, null, 0));
  }

  /* --- Seiten ------------------------------------------------------- */

  const header = renderHeader({ config, base, active: 'home' });
  const footer = renderFooter({ config, base });

  const stats = {
    trips: live.length,
    entries: live.reduce((sum, trip) => sum + trip.entries.length, 0),
    images: live.reduce((sum, trip) => sum + countImages(trip), 0)
  };

  const years = [...new Set(deployable.flatMap(tripYears))].sort((a, b) => b - a);
  // Eine ausdrücklich markierte Reise wird hervorgehoben, sonst die neueste.
  const liveOrdered = [...live].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
  const withIndex = (trip) => ({ ...trip, ...toIndexEntry(trip), entries: trip.entries });

  // Geplante und abgelaufene Reisen kommen mit ins Raster - versteckt per CSS.
  // Nur so kann der Browser sie zum eingestellten Zeitpunkt einblenden, ohne
  // dass die Seite vorher neu gebaut werden muss.
  const gridSource = [
    ...liveOrdered,
    ...deployable.filter((trip) => !['live', 'archived'].includes(effectiveState(trip, now)))
  ];
  const homeFeatured = liveOrdered[0] ? withIndex(liveOrdered[0]) : null;
  const homeTrips = gridSource.map(withIndex);
  const archiveTrips = archived.map(withIndex);

  const heroImage = firstImage(live[0] || deployable[0] || {});

  writeFile('index.html', renderLayout({
    config,
    base,
    version,
    title: config.title,
    description: config.description,
    canonicalPath: '',
    ogImage: heroImage?.src || '',
    bodyClass: 'page page--home',
    header,
    main: renderHome({ config, base, featured: homeFeatured, trips: homeTrips, archived: archiveTrips, years, stats, now }),
    footer,
    scripts: ['assets/js/site.js'],
    jsonLd: homeJsonLd({ config, base, trips: liveOrdered.map(withIndex), siteUrl })
  }));

  writeFile('404.html', renderLayout({
    config,
    base,
    version,
    title: 'Seite nicht gefunden',
    description: 'Diese Seite existiert nicht (mehr).',
    canonicalPath: '404.html',
    bodyClass: 'page page--404',
    noindex: true,
    header,
    main: renderNotFound({ config, base, trips: liveOrdered.map(withIndex) }),
    footer,
    scripts: ['assets/js/site.js']
  }));

  let pageCount = 2;
  for (let i = 0; i < deployable.length; i += 1) {
    const trip = deployable[i];
    const state = effectiveState(trip, now);
    const entries = trip.entries;
    const visibleNeighbours = deployable.filter((t) => effectiveState(t, now) === 'live');
    const position = visibleNeighbours.findIndex((t) => t.slug === trip.slug);
    const prev = position > 0 ? visibleNeighbours[position - 1] : null;
    const next = position >= 0 && position < visibleNeighbours.length - 1 ? visibleNeighbours[position + 1] : null;
    const cover = firstImage(trip);

    writeFile(`reisen/${trip.slug}/index.html`, renderLayout({
      config,
      base,
      version,
      title: trip.title,
      description: excerpt(trip.description, 180) || `${trip.title} – Reisetagebuch mit ${entries.length} Einträgen.`,
      canonicalPath: `reisen/${trip.slug}/`,
      ogImage: cover?.src || '',
      ogType: 'article',
      bodyClass: 'page page--trip',
      noindex: state !== 'live' && state !== 'archived',
      htmlAttrs: { 'data-trip-state': state },
      header: renderHeader({ config, base, active: 'trip' }),
      main: renderTripPage({ config, base, trip, entries, now, prev, next }),
      footer,
      scripts: ['assets/js/site.js'],
      inlineHeadScript: tripGateScript(trip),
      jsonLd: tripJsonLd({ config, base, trip, entries })
    }));
    pageCount += 1;
  }

  /* --- Admin -------------------------------------------------------- */

  const adminHtml = fs.readFileSync(path.join(__dirname, 'admin/index.html'), 'utf8')
    .replace(/\{\{BASE\}\}/g, joinUrl(base))
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{CONFIG\}\}/g, JSON.stringify({
      title: config.title,
      base,
      siteUrl,
      repo: config.repo,
      theme: config.theme
    }).replace(/</g, '\\u003c'));
  writeFile('admin/index.html', adminHtml);
  pageCount += 1;

  /* --- Meta-Dateien ------------------------------------------------- */

  writeFile('.nojekyll', '');

  const sitemapUrls = [
    { loc: absoluteUrl(siteUrl, base, ''), lastmod: isoDate(now.toISOString()), priority: '1.0' },
    ...live.map((trip) => ({
      loc: absoluteUrl(siteUrl, base, `reisen/${trip.slug}/`),
      lastmod: isoDate(trip.updatedAt || trip.endDate || trip.startDate) || isoDate(now.toISOString()),
      priority: '0.8'
    }))
  ];

  writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>
`);

  writeFile('robots.txt', `User-agent: *
Allow: /
Disallow: ${joinUrl(base, 'admin/')}
${siteUrl ? `Sitemap: ${absoluteUrl(siteUrl, base, 'sitemap.xml')}` : ''}
`);

  writeFile('manifest.webmanifest', JSON.stringify({
    name: config.title,
    short_name: config.title,
    description: config.description,
    start_url: joinUrl(base),
    scope: joinUrl(base),
    display: 'standalone',
    background_color: '#faf7f2',
    theme_color: config.theme?.accent || '#c2683a',
    lang: config.language || 'de',
    icons: [
      { src: joinUrl(base, 'assets/icon-180.png'), sizes: '180x180', type: 'image/png' },
      { src: joinUrl(base, 'assets/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: joinUrl(base, 'assets/favicon.svg'), sizes: 'any', type: 'image/svg+xml' }
    ]
  }, null, 2));

  const cname = process.env.SITE_CNAME || config.cname || '';
  if (cname) writeFile('CNAME', `${cname}\n`);

  console.log(`\n✓ Fertig in ${Date.now() - started} ms · ${pageCount} Seiten · dist/\n`);
}

try {
  build();
} catch (error) {
  console.error('\n✗ Build fehlgeschlagen:', error.message);
  console.error(error.stack);
  process.exit(1);
}
