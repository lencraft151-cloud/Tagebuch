#!/usr/bin/env node
/**
 * Kleiner Entwicklungsserver für die lokale Vorschau (ohne Abhängigkeiten).
 *
 *   npm run dev       baut und startet mit Datei-Beobachtung
 *   npm run preview   baut einmal und startet
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const watch = !process.argv.includes('--no-watch');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function runBuild() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'build.mjs')], { stdio: 'inherit' });
  return result.status === 0;
}

function basePath() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
    const base = process.env.SITE_BASE || config.basePath || '/';
    return `/${String(base).replace(/^\/+|\/+$/g, '')}${String(base).replace(/^\/+|\/+$/g, '') ? '/' : ''}`;
  } catch {
    return '/';
  }
}

if (!fs.existsSync(DIST) && !runBuild()) process.exit(1);

const base = basePath();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (base !== '/' && pathname.startsWith(base)) pathname = `/${pathname.slice(base.length)}`;
  else if (base !== '/' && `${pathname}/` === base) {
    res.writeHead(302, { Location: base });
    res.end();
    return;
  }

  let filePath = path.join(DIST, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;

  if (!filePath.startsWith(DIST) || !fs.existsSync(filePath)) {
    const notFound = path.join(DIST, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Vorschau läuft:  http://${HOST}:${PORT}${base}`);
  console.log(`  Admin-Bereich:   http://${HOST}:${PORT}${base}admin/\n`);
});

if (watch) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('\n↻ Änderung erkannt – neuer Build …');
      runBuild();
    }, 180);
  };
  for (const dir of ['src', 'content', 'site.config.json']) {
    const target = path.join(ROOT, dir);
    if (!fs.existsSync(target)) continue;
    fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, rebuild);
  }
  console.log('  Beobachte src/, content/ und site.config.json …\n');
}
