'use strict';
(() => {
  const links = [...document.querySelectorAll('[data-gallery-photo]')];
  const track = document.querySelector('[data-gallery-track]');
  const controls = document.querySelector('[data-gallery-controls]');
  if (track && controls && links.length) {
    const back = controls.querySelector('[data-gallery-back]');
    const forward = controls.querySelector('[data-gallery-forward]');
    const position = controls.querySelector('[data-gallery-position]');
    const cards = [...track.querySelectorAll('figure')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const left = i => cards[i].offsetLeft - cards[0].offsetLeft;
    let target = null;
    let settle;
    const current = () => cards.reduce((best, card, i) => Math.abs(left(i) - track.scrollLeft) < Math.abs(left(best) - track.scrollLeft) ? i : best, 0);
    function update() {
      const overflow = track.scrollWidth > track.clientWidth + 2;
      controls.hidden = !overflow;
      back.disabled = track.scrollLeft <= 2;
      forward.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      position.textContent = `${current() + 1} / ${cards.length}`;
    }
    function step(direction) {
      target = Math.max(0, Math.min(cards.length - 1, (target ?? current()) + direction));
      track.scrollTo({ left: left(target), behavior: reduced.matches ? 'instant' : 'smooth' });
      clearTimeout(settle);
      settle = setTimeout(() => { target = null; update(); }, 500);
    }
    back.addEventListener('click', () => step(-1));
    forward.addEventListener('click', () => step(1));
    track.addEventListener('keydown', event => {
      if (event.target !== track || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1);
    });
    track.addEventListener('pointerdown', () => { target = null; });
    track.addEventListener('scroll', update, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(update).observe(track);
    else window.addEventListener('resize', update);
    update();
  }
  const dialog = document.querySelector('.trainer-gallery-viewer');
  if (!links.length || !dialog || typeof dialog.showModal !== 'function') return;
  const image = dialog.querySelector('[data-gallery-image]');
  const caption = dialog.querySelector('[data-gallery-caption]');
  let index = 0;
  function show(next) {
    index = (next + links.length) % links.length;
    image.src = links[index].href;
    image.alt = links[index].querySelector('img').alt;
    caption.textContent = links[index].dataset.caption;
    caption.hidden = !caption.textContent;
  }
  links.forEach((link, i) => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault(); show(i); dialog.showModal(); document.documentElement.classList.add('trainer-gallery-open');
  }));
  dialog.querySelector('[data-gallery-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(index + (event.key === 'ArrowLeft' ? -1 : 1)); }
  });
  let start = null;
  dialog.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { start = null; return; }
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  dialog.addEventListener('touchend', event => {
    if (!start || event.touches.length || !event.changedTouches.length) { start = null; return; }
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && (window.visualViewport?.scale ?? 1) <= 1.05) show(index + (dx < 0 ? 1 : -1));
  }, { passive: true });
  dialog.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('trainer-gallery-open');
    start = null;
  });
})();
