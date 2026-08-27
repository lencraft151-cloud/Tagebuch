/**
 * Formatierungs-Helfer.
 * Laeuft unverändert in Node (Build) und im Browser (Laufzeit) - keine Node-APIs.
 */

const LOCALE = 'de-DE';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** "2026-07-12" -> Date (lokal, ohne Zeitzonen-Verschiebung) */
export function parseDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (local) {
    return new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      Number(local[6] || 0)
    );
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value, style = 'long') {
  const date = parseDate(value);
  if (!date) return '';
  if (style === 'short') {
    return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }
  if (style === 'day') {
    return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short' }).format(date);
  }
  if (style === 'weekday') {
    return new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(date);
  }
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/** "12.07.2026 - 26.07.2026", kompakt wenn im selben Monat/Jahr */
export function formatDateRange(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a && !b) return '';
  if (!b) return formatDate(start, 'short');
  if (!a) return formatDate(end, 'short');

  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
  const full = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });

  if (sameMonth) {
    if (a.getDate() === b.getDate()) return full.format(a);
    return `${a.getDate()}. – ${full.format(b)}`;
  }
  if (sameYear) return `${dayMonth.format(a)} – ${full.format(b)}`;
  return `${full.format(a)} – ${full.format(b)}`;
}

/** Anzahl der Tage zwischen zwei Daten (inklusive) */
export function durationInDays(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return 0;
  const ms = b.setHours(12, 0, 0, 0) - a.setHours(12, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

export function formatTime(value) {
  if (!value) return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value).trim());
  if (!match) return '';
  return `${String(match[1]).padStart(2, '0')}:${match[2]} Uhr`;
}

/** ISO-Datum für <time datetime> / Sitemap */
export function isoDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function pluralize(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Sehr schlanker Text-Renderer: Absätze + wenige Inline-Auszeichnungen.
 * Es wird immer zuerst escaped, danach werden nur die erlaubten Muster ersetzt.
 */
export function renderRichText(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  return raw
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      // Zitat
      if (/^>\s?/.test(trimmed)) {
        const inner = trimmed.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n');
        return `<blockquote>${inlineFormat(inner).replace(/\n/g, '<br>')}</blockquote>`;
      }

      // Aufzählung
      if (/^[-*+]\s+/.test(trimmed)) {
        const items = trimmed
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => `<li>${inlineFormat(l.replace(/^\s*[-*+]\s+/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      // Nummerierte Liste
      if (/^\d+[.)]\s+/.test(trimmed)) {
        const items = trimmed
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => `<li>${inlineFormat(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`)
          .join('');
        return `<ol>${items}</ol>`;
      }

      // Zwischenüberschrift
      if (/^#{2,4}\s+/.test(trimmed)) {
        const level = Math.min(4, trimmed.match(/^#+/)[0].length);
        return `<h${level}>${inlineFormat(trimmed.replace(/^#+\s+/, ''))}</h${level}>`;
      }

      return `<p>${inlineFormat(trimmed).replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function inlineFormat(text) {
  let out = escapeHtml(text);
  // Links: [Text](https://…)
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) =>
    `<a href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return out;
}

/** Kurzer Auszug für Karten und Meta-Beschreibungen */
export function excerpt(text, maxLength = 165) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[*_`>#]/g, '')
    .trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : cut.length).trim()}…`;
}
