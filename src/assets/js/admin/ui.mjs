/** Kleine UI-Bausteine für den Verwaltungsbereich. */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const icons = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.4 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8"/><path d="M6.2 6.6A16.8 16.8 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.2-.9"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/></svg>',
  sort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16"/><path d="M4 17l3 3 3-3"/><path d="M14 6h6"/><path d="M14 11h5"/><path d="M14 16h4"/></svg>'
};

/* ------------------------------------------------------------- Meldungen -- */

export function toast(message, variant = '') {
  const stack = $('[data-toasts]');
  if (!stack) return;
  const node = el(`<div class="toast${variant ? ` toast--${variant}` : ''}">${escapeHtml(message)}</div>`);
  stack.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 300);
  }, variant === 'error' ? 5200 : 3000);
}

let loadingDepth = 0;

/** Text des Lade-Overlays ändern, ohne den Zähler zu verschieben. */
export function setLoadingText(text) {
  const overlay = $('[data-loading]');
  if (overlay && !overlay.hidden) $('[data-loading-text]', overlay).textContent = text;
}

export function setLoading(active, text = 'Wird geladen …') {
  const overlay = $('[data-loading]');
  if (!overlay) return;
  loadingDepth = Math.max(0, loadingDepth + (active ? 1 : -1));
  if (loadingDepth > 0) {
    $('[data-loading-text]', overlay).textContent = text;
    overlay.hidden = false;
  } else {
    overlay.hidden = true;
  }
}

export function confirmDialog({ title, text, confirmLabel = 'Bestätigen', danger = true }) {
  return new Promise((resolve) => {
    const modal = $('[data-modal]');
    if (!modal) { resolve(window.confirm(text)); return; }

    $('[data-modal-title]', modal).textContent = title;
    $('[data-modal-text]', modal).textContent = text;

    const confirmBtn = $('[data-modal-confirm]', modal);
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;

    const close = (result) => {
      modal.hidden = true;
      document.removeEventListener('keydown', onKey);
      for (const node of $$('[data-modal-cancel]', modal)) node.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      resolve(result);
    };
    const onCancel = () => close(false);
    const onConfirm = () => close(true);
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    };

    for (const node of $$('[data-modal-cancel]', modal)) node.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    document.addEventListener('keydown', onKey);

    modal.hidden = false;
    confirmBtn.focus();
  });
}

/* ------------------------------------------------------------- Werkzeuge -- */

export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (mode) => {
    const resolved = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = mode;
  };
  media.addEventListener?.('change', () => {
    if ((document.documentElement.dataset.themePref || 'system') === 'system') apply('system');
  });
  for (const button of $$('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('tagebuch:theme', next); } catch { /* ignorieren */ }
      apply(next);
    });
  }
}

/** Datum von "2026-07-12T14:00" nach "12.07.2026, 14:00" (nur zur Anzeige). */
export function humanDateTime(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value));
  if (!match) return String(value);
  const [, y, m, d, hh, mm] = match;
  return hh ? `${d}.${m}.${y}, ${hh}:${mm} Uhr` : `${d}.${m}.${y}`;
}

export function humanDate(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value);
}
