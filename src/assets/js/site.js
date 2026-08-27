/**
 * Oeffentliche Website: Navigation, Theme, Suche/Filter, Lightbox, Teilen.
 * Reines ES-Modul, keine Abhängigkeiten.
 */

import { createLightbox, enhanceGalleries } from './lightbox.mjs';
import { effectiveState } from './lib/trips.mjs';

/* ------------------------------------------------------------- Helfer --- */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function toast(message) {
  let node = $('.toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    document.body.appendChild(node);
  }
  node.textContent = message;
  requestAnimationFrame(() => node.classList.add('is-visible'));
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('is-visible'), 2600);
}

/* -------------------------------------------------------------- Theme --- */

function initTheme() {
  const toggle = $('[data-theme-toggle]');
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = (mode) => {
    const resolved = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = mode;
  };

  media.addEventListener?.('change', () => {
    if ((document.documentElement.dataset.themePref || 'system') === 'system') apply('system');
  });

  toggle?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('tagebuch:theme', next); } catch { /* Speicher nicht verfügbar */ }
    apply(next);
  });
}

/* --------------------------------------------------------- Navigation --- */

function initNavigation() {
  const header = $('[data-header]');
  const toggle = $('[data-nav-toggle]');
  const nav = $('[data-nav]');

  if (toggle && nav) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.sr-only').textContent = open ? 'Menü schließen' : 'Menü öffnen';
    };

    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!nav.classList.contains('is-open')) return;
      if (event.target.closest('[data-nav]') || event.target.closest('[data-nav-toggle]')) return;
      setOpen(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 832) setOpen(false);
    });
  }

  if (header) {
    const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
}

/* ------------------------------------------------------------- Bilder --- */

/** Bereits im Cache geladene Bilder markieren (onload feuert dann nicht mehr). */
function initImages() {
  for (const img of $$('.media img')) {
    if (img.complete && img.naturalWidth > 0) img.closest('.media')?.classList.add('is-loaded');
    else img.addEventListener('load', () => img.closest('.media')?.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', () => img.closest('.media')?.classList.add('is-loaded'), { once: true });
  }
}

/* ------------------------------------------------------------- Reveal --- */

function initReveal() {
  // Bewusst nur die Tagebuch-Einträge: Bedienelemente dürfen niemals von
  // einer Animation abhängen, falls der Observer nicht greift.
  const targets = $$('.entry');
  if (!targets.length || !('IntersectionObserver' in window)) return;

  for (const target of targets) target.setAttribute('data-reveal', '');

  const reveal = (node) => node.classList.add('is-visible');

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        reveal(entry.target);
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.02 });

  for (const target of targets) observer.observe(target);

  // Sicherheitsnetz: nach 2,5 s ist alles sichtbar, egal was passiert ist.
  setTimeout(() => targets.forEach(reveal), 2500);
}

/* --------------------------------------------------- Sichtbarkeitsgate --- */

/**
 * Kartenzustand gegen die aktuelle Uhrzeit neu bewerten.
 * Der Build kennt nur den Stand des letzten Deploys - so werden geplante
 * Reisen punktgenau sichtbar bzw. abgelaufene ausgeblendet.
 */
function refreshCardStates() {
  const now = new Date();
  for (const card of $$('[data-trip-card]')) {
    const state = effectiveState({
      status: card.dataset.status,
      publishFrom: card.dataset.publishFrom,
      publishUntil: card.dataset.publishUntil,
      onExpire: card.dataset.onExpire
    }, now);
    card.dataset.state = state;
  }

  // Hervorgehobene Reise ausblenden, sobald sie nicht mehr sichtbar sein soll.
  const featured = $('.featured');
  if (featured) {
    const card = $('[data-trip-card]', featured);
    featured.hidden = !card || card.dataset.state !== 'live';
  }

  const archiveSection = $('[data-archive-section]');
  if (archiveSection) {
    const grid = $('[data-archive-grid]');
    const mainGrid = $('[data-trip-grid]');

    // Karten, deren Zustand sich in "archived" geändert hat, umhaengen
    for (const card of $$('[data-trip-card]', mainGrid || document)) {
      if (card.dataset.state === 'archived' && grid && card.parentElement !== grid) grid.appendChild(card);
    }
    for (const card of grid ? $$('[data-trip-card]', grid) : []) {
      if (card.dataset.state === 'live' && mainGrid) mainGrid.appendChild(card);
    }

    const visibleArchive = grid ? $$('[data-trip-card][data-state="archived"]', grid).length : 0;
    archiveSection.hidden = visibleArchive === 0;
  }
}

/* ----------------------------------------------------- Suche & Filter --- */

function initFilters() {
  const form = $('[data-filter-form]');
  if (!form) return;

  const input = $('[data-search-input]', form);
  const clear = $('[data-search-clear]', form);
  const yearSelect = $('[data-year-select]', form);
  const grids = $$('[data-trip-grid], [data-archive-grid]');
  const counter = $('[data-result-count]');
  const noResults = $('[data-no-results]');
  const emptyState = $('[data-empty-state]');
  const archiveSection = $('[data-archive-section]');
  const featured = $('.featured');

  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .trim();

  function apply({ pushState = true } = {}) {
    const query = normalize(input?.value);
    const terms = query.split(/\s+/).filter(Boolean);
    const year = yearSelect?.value || '';
    const filtering = Boolean(terms.length || year);

    let matches = 0;
    let totalVisible = 0;

    for (const grid of grids) {
      for (const card of $$('[data-trip-card]', grid)) {
        const isVisibleState = card.dataset.state === 'live' || card.dataset.state === 'archived';
        const isDuplicate = card.hasAttribute('data-duplicate');
        if (isVisibleState && !isDuplicate) totalVisible += 1;

        const haystack = normalize(card.dataset.search);
        const years = (card.dataset.years || '').split(',').filter(Boolean);
        const matchesQuery = terms.every((term) => haystack.includes(term));
        const matchesYear = !year || years.includes(year);
        const visible = isVisibleState && matchesQuery && matchesYear;

        card.classList.toggle('is-filtered', !visible);

        // Die hervorgehobene Reise erscheint während der Filterung im Raster,
        // damit sie auch gefunden wird, wenn der Hero-Bereich ausgeblendet ist.
        if (isDuplicate) card.hidden = !filtering;
        else if (visible) matches += 1;
        if (isDuplicate && filtering && visible) matches += 1;
      }
    }

    if (featured) featured.hidden = filtering;
    if (clear) clear.hidden = !input?.value;

    if (counter) {
      counter.hidden = !filtering;
      counter.textContent = filtering
        ? `${matches} ${matches === 1 ? 'Reise gefunden' : 'Reisen gefunden'}`
        : '';
    }
    if (noResults) noResults.hidden = !(filtering && matches === 0);
    if (emptyState) emptyState.hidden = !(totalVisible === 0 && !filtering);

    if (archiveSection) {
      const archiveGrid = $('[data-archive-grid]');
      const archiveVisible = archiveGrid
        ? $$('[data-trip-card]', archiveGrid).filter((c) => !c.classList.contains('is-filtered') && !c.hidden).length
        : 0;
      archiveSection.hidden = archiveVisible === 0;
    }

    if (pushState) {
      const params = new URLSearchParams(window.location.search);
      if (input?.value) params.set('q', input.value); else params.delete('q');
      if (year) params.set('jahr', year); else params.delete('jahr');
      const search = params.toString();
      const url = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', url);
    }
  }

  // Zustand aus der URL übernehmen (teilbare Suchlinks)
  const params = new URLSearchParams(window.location.search);
  if (input && params.get('q')) input.value = params.get('q');
  if (yearSelect && params.get('jahr')) yearSelect.value = params.get('jahr');

  let debounce;
  input?.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => apply(), 140);
  });
  input?.addEventListener('search', () => apply());
  yearSelect?.addEventListener('change', () => apply());
  clear?.addEventListener('click', () => {
    if (!input) return;
    input.value = '';
    input.focus();
    apply();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });

  apply({ pushState: false });
  return apply;
}

/* ----------------------------------------------------- Tages-Navigation --- */

function initDayNav() {
  const nav = $('[data-day-nav]');
  if (!nav || !('IntersectionObserver' in window)) return;

  const chips = $$('.day-chip', nav);
  const entries = $$('[data-entry]');
  if (!chips.length || !entries.length) return;

  const setCurrent = (index) => {
    chips.forEach((chip, i) => chip.classList.toggle('is-current', i === index));
    const chip = chips[index];
    if (chip && nav.querySelector('.day-nav__track')) {
      const track = nav.querySelector('.day-nav__track');
      const left = chip.offsetLeft - track.clientWidth / 2 + chip.clientWidth / 2;
      track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  };

  const observer = new IntersectionObserver((records) => {
    const visible = records
      .filter((record) => record.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) setCurrent(Number(visible.target.dataset.index || 0));
  }, { rootMargin: '-30% 0px -55% 0px', threshold: 0 });

  for (const entry of entries) observer.observe(entry);
}

/* -------------------------------------------------------------- Teilen --- */

function initShare() {
  for (const button of $$('[data-share]')) {
    button.addEventListener('click', async () => {
      const url = button.dataset.url || window.location.href;
      const title = button.dataset.title || document.title;

      if (navigator.share) {
        try {
          await navigator.share({ title, url });
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }

      try {
        await navigator.clipboard.writeText(url);
        toast('Link kopiert');
      } catch {
        window.prompt('Link kopieren:', url);
      }
    });
  }
}

/* ---------------------------------------------------------------- Init --- */

function init() {
  initTheme();
  initNavigation();
  initImages();
  refreshCardStates();
  const applyFilters = initFilters();
  initDayNav();
  initShare();
  initReveal();
  enhanceGalleries();
  createLightbox();

  // Karten alle 60 s neu bewerten, damit Veroeffentlichungszeitpunkte
  // auch bei geoeffnetem Tab punktgenau greifen.
  if ($('[data-trip-card]')) {
    setInterval(() => {
      refreshCardStates();
      applyFilters?.({ pushState: false });
    }, 60000);
  }

  // Reisenummerierung für gestaffelte Einblend-Animation
  $$('[data-trip-card]').forEach((card, i) => card.style.setProperty('--i', String(Math.min(i, 12))));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
