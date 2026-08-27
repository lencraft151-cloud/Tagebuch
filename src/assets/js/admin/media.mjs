/**
 * Bildverarbeitung im Browser: verkleinern, komprimieren, Vorschau-Platzhalter
 * erzeugen und zu GitHub hochladen.
 *
 * Warum im Browser? Auf GitHub Pages gibt es keinen Server, der Bilder
 * skalieren könnte. Ohne Verkleinerung landen 8-MB-Handyfotos im Repository
 * und die Website wird auf dem Smartphone unbenutzbar.
 */

import { encodeBytes } from './github.mjs';

export const FULL_MAX = 2000;
export const THUMB_MAX = 800;
export const PLACEHOLDER_MAX = 24;
export const FULL_QUALITY = 0.82;
export const THUMB_QUALITY = 0.76;

const ACCEPTED = /^image\/(jpeg|png|webp|avif|gif|heic|heif)$/i;

export function isSupportedImage(file) {
  return Boolean(file) && (ACCEPTED.test(file.type) || /\.(jpe?g|png|webp|avif|gif|heic|heif)$/i.test(file.name || ''));
}

function fileSlug(name) {
  return String(name || 'bild')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'bild';
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* Fallback unten */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden.')); };
    image.src = url;
  });
}

function drawScaled(source, maxSize) {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return { canvas, width, height };
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht kodiert werden.'))),
      'image/jpeg',
      quality
    );
  });
}

/**
 * Erzeugt aus einer Datei drei Varianten:
 * Vollbild (max. 2000 px), Vorschau (max. 800 px) und einen winzigen
 * Base64-Platzhalter für den weichen Ladeeffekt.
 */
export async function prepareImage(file) {
  const bitmap = await loadBitmap(file);

  const full = drawScaled(bitmap, FULL_MAX);
  const thumb = drawScaled(bitmap, THUMB_MAX);
  const tiny = drawScaled(bitmap, PLACEHOLDER_MAX);

  const [fullBlob, thumbBlob] = await Promise.all([
    toBlob(full.canvas, FULL_QUALITY),
    toBlob(thumb.canvas, THUMB_QUALITY)
  ]);

  const placeholder = tiny.canvas.toDataURL('image/jpeg', 0.5);
  bitmap.close?.();

  return {
    baseName: fileSlug(file.name),
    width: full.width,
    height: full.height,
    placeholder,
    full: fullBlob,
    thumb: thumbBlob,
    originalSize: file.size,
    newSize: fullBlob.size + thumbBlob.size
  };
}

async function blobToBase64(blob) {
  return encodeBytes(await blob.arrayBuffer());
}

/**
 * Lädt Vollbild und Vorschau ins Repository und liefert den Bild-Datensatz
 * für die Reise-JSON.
 */
export async function uploadImage({ github, mediaDir, prepared, prefix = '', onProgress }) {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  const name = `${prefix ? `${prefix}-` : ''}${prepared.baseName}-${stamp}${random}`;

  const fullPath = `${mediaDir}/${name}.jpg`;
  const thumbPath = `${mediaDir}/${name}-thumb.jpg`;

  onProgress?.({ step: 'full', name });
  await github.putFile({
    path: fullPath,
    contentBase64: await blobToBase64(prepared.full),
    message: `Bild hinzugefügt: ${name}.jpg`
  });

  onProgress?.({ step: 'thumb', name });
  await github.putFile({
    path: thumbPath,
    contentBase64: await blobToBase64(prepared.thumb),
    message: `Vorschaubild hinzugefügt: ${name}-thumb.jpg`
  });

  return {
    id: `img-${stamp}${random}`,
    src: `media/${name}.jpg`,
    thumb: `media/${name}-thumb.jpg`,
    alt: '',
    caption: '',
    width: prepared.width,
    height: prepared.height,
    placeholder: prepared.placeholder
  };
}

/**
 * Bildpfade aus der JSON ("media/foo.jpg") in eine anzeigbare URL übersetzen.
 * Öffentliche Repositories nutzen die schnelle Roh-URL, private Repositories
 * laden über die API und erzeugen eine Blob-URL.
 */
export function createMediaResolver(github, mediaDir) {
  const cache = new Map();
  const local = new Map();

  const repoPath = (src) => `${mediaDir}/${String(src).replace(/^media\//, '')}`;

  return {
    /** Sofortige Vorschau für gerade ausgewählte Dateien (vor dem Upload). */
    registerLocal(src, blob) {
      const url = URL.createObjectURL(blob);
      local.set(src, url);
      cache.set(src, url);
      return url;
    },
    async resolve(src) {
      if (!src) return '';
      if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
      if (cache.has(src)) return cache.get(src);

      if (!github.isPrivate) {
        const url = github.rawUrl(repoPath(src));
        cache.set(src, url);
        return url;
      }

      try {
        const buffer = await github.getBlob(repoPath(src));
        const url = URL.createObjectURL(new Blob([buffer]));
        cache.set(src, url);
        return url;
      } catch {
        return '';
      }
    },
    forget(src) {
      const url = local.get(src);
      if (url) URL.revokeObjectURL(url);
      local.delete(src);
      cache.delete(src);
    }
  };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
