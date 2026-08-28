/**
 * Bildverarbeitung im Browser: verkleinern, komprimieren und einen
 * Vorschau-Platzhalter erzeugen.
 *
 * Warum im Browser? Auf GitHub Pages gibt es keinen Server, der Bilder
 * skalieren könnte. Ohne Verkleinerung landen 8-MB-Handyfotos im Repository
 * und die Website wird auf dem Smartphone unbenutzbar.
 *
 * Die fertigen Bilder werden zunächst nur lokal abgelegt und erst beim
 * Veröffentlichen gemeinsam als Paket ausgegeben.
 */

import { localMedia } from './localstore.mjs';

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

/**
 * Erzeugte Bilder lokal ablegen und den Datensatz für die Reise-JSON liefern.
 * Hochgeladen wird nichts - das passiert später gebündelt beim Veröffentlichen.
 */
export async function storeImage({ prepared, prefix = '' }) {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  const name = `${prefix ? `${prefix}-` : ''}${prepared.baseName}-${stamp}${random}`;

  const src = `media/${name}.jpg`;
  const thumb = `media/${name}-thumb.jpg`;

  await localMedia.put({
    src,
    thumb,
    full: prepared.full,
    thumbBlob: prepared.thumb,
    width: prepared.width,
    height: prepared.height,
    createdAt: new Date().toISOString()
  });

  return {
    id: `img-${stamp}${random}`,
    src,
    thumb,
    alt: '',
    caption: '',
    width: prepared.width,
    height: prepared.height,
    placeholder: prepared.placeholder
  };
}

/**
 * Bildpfade zu anzeigbaren Adressen auflösen.
 *
 * Reihenfolge: noch nicht veröffentlichte Bilder kommen aus der lokalen
 * Ablage, alles andere vom eigenen Server. Schlägt beides fehl, wird die
 * Rohdatei bei GitHub versucht - dort liegen bereits committete Bilder, die
 * der Build noch nicht verarbeitet hat.
 */
export function createMediaResolver(repo) {
  const cache = new Map();

  return {
    async resolve(src) {
      if (!src) return '';
      if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
      if (cache.has(src)) return cache.get(src);

      const pending = await findLocal(src);
      if (pending) {
        const url = URL.createObjectURL(pending);
        cache.set(src, url);
        return url;
      }

      const url = repo.imageUrl(src);
      cache.set(src, url);
      return url;
    },
    fallback(src) {
      return repo.imageRawUrl(src);
    },
    forget(src) {
      const url = cache.get(src);
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
      cache.delete(src);
    }
  };
}

async function findLocal(src) {
  const direct = await localMedia.get(src);
  if (direct?.full) return direct.full;

  // Vorschaubilder sind unter dem Vollbild abgelegt
  const all = await localMedia.all();
  const match = all.find((item) => item.thumb === src);
  return match?.thumbBlob || null;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
