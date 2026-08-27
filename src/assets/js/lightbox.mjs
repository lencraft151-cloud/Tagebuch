/** Bild-Lightbox mit Tastatur-, Touch- und Fokus-Unterstuetzung. */

export function createLightbox(root = document) {
  const box = root.querySelector('[data-lightbox]');
  if (!box) return null;

  const image = box.querySelector('[data-lightbox-image]');
  const caption = box.querySelector('[data-lightbox-caption]');
  const counter = box.querySelector('[data-lightbox-counter]');
  const spinner = box.querySelector('[data-lightbox-spinner]');
  const prevBtn = box.querySelector('[data-lightbox-prev]');
  const nextBtn = box.querySelector('[data-lightbox-next]');

  let items = [];
  let index = 0;
  let lastFocused = null;

  function collect(figure) {
    const group = figure.dataset.lightboxGroup;
    const scope = group
      ? [...root.querySelectorAll(`[data-lightbox-group="${CSS.escape(group)}"]`)]
      : [figure];
    return scope.map((node) => {
      const img = node.querySelector('img');
      return {
        src: img?.dataset.full || img?.currentSrc || img?.src || '',
        alt: img?.alt || '',
        caption: img?.dataset.caption || ''
      };
    }).filter((item) => item.src);
  }

  function show(newIndex) {
    if (!items.length) return;
    index = (newIndex + items.length) % items.length;
    const item = items[index];

    spinner.hidden = false;
    image.style.opacity = '0';
    image.src = item.src;
    image.alt = item.alt;
    caption.textContent = item.caption;
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
    counter.hidden = items.length < 2;

    const single = items.length < 2;
    prevBtn.hidden = single;
    nextBtn.hidden = single;

    // Nachbarbilder vorladen
    if (items.length > 1) {
      for (const offset of [1, -1]) {
        const preload = new Image();
        preload.src = items[(index + offset + items.length) % items.length].src;
      }
    }
  }

  image.addEventListener('load', () => {
    spinner.hidden = true;
    image.style.opacity = '1';
  });
  image.addEventListener('error', () => {
    spinner.hidden = true;
    image.style.opacity = '1';
    caption.textContent = 'Bild konnte nicht geladen werden.';
  });

  function open(figure) {
    items = collect(figure);
    if (!items.length) return;
    const start = Number(figure.dataset.lightboxIndex || 0);
    lastFocused = document.activeElement;

    box.hidden = false;
    box.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    requestAnimationFrame(() => box.classList.add('is-open'));

    show(Math.min(start, items.length - 1));
    box.querySelector('[data-lightbox-close]')?.focus?.();
  }

  function close() {
    box.classList.remove('is-open');
    box.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    window.setTimeout(() => {
      box.hidden = true;
      image.removeAttribute('src');
    }, 250);
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  // Öffnen über Klick auf Galeriebilder
  root.addEventListener('click', (event) => {
    const figure = event.target.closest('[data-lightbox-group]');
    if (!figure || figure.closest('a')) return;
    event.preventDefault();
    open(figure);
  });

  // Tastaturbedienung der Galerie
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const figure = event.target.closest('[data-lightbox-group]');
    if (!figure || figure.closest('a')) return;
    event.preventDefault();
    open(figure);
  });

  for (const node of box.querySelectorAll('[data-lightbox-close]')) {
    node.addEventListener('click', close);
  }
  prevBtn.addEventListener('click', () => show(index - 1));
  nextBtn.addEventListener('click', () => show(index + 1));

  document.addEventListener('keydown', (event) => {
    if (box.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    else if (event.key === 'Tab') {
      // Fokus im Dialog halten
      const focusable = [...box.querySelectorAll('button:not([hidden])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  // Wischgesten
  let touchStartX = 0;
  let touchStartY = 0;
  box.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  }, { passive: true });

  box.addEventListener('touchend', (event) => {
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
  }, { passive: true });

  return { open, close };
}

/** Galeriebilder fokussierbar und semantisch als Button auszeichnen. */
export function enhanceGalleries(root = document) {
  for (const figure of root.querySelectorAll('[data-lightbox-group]')) {
    if (figure.closest('a')) continue;
    figure.tabIndex = 0;
    figure.setAttribute('role', 'button');
    const alt = figure.querySelector('img')?.alt;
    figure.setAttribute('aria-label', alt ? `Bild vergrößern: ${alt}` : 'Bild vergrößern');
  }
}
