'use strict';
// IDEAL / MONO — continuous coverflow, no runtime dependencies.
// The five editorial cards are independent from the live catalog (/shop.html).
(() => {
  const section = document.querySelector('.nutrition');
  if (!section) return;
  const gallery = section.querySelector('.nutrition__gallery');
  const cards = [...section.querySelectorAll('[data-nutrition-card]')];
  const count = cards.length;
  if (count < 2) return;
  const showcase = window.IdealProducts;
  if (!Array.isArray(showcase) || showcase.length !== count) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const counter = section.querySelector('[data-nutrition-counter]');
  const status = section.querySelector('[data-nutrition-status]');
  const fields = ['name', 'category', 'description', 'price'].map(key =>
    [key, section.querySelector(`[data-nutrition-${key}]`)]);
  let position = 0, target = 0, active = 0, frame = 0, cardWidth = 0;
  let pointer = null, suppressClick = false;
  const modulo = value => ((value % count) + count) % count;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const stepWidth = () => cardWidth * (gallery.clientWidth <= 680 ? .64 : .76);
  const opacityAt = distance => distance <= 1 ? 1 - distance * .08
    : distance <= 2 ? .92 - (distance - 1) * .3
      : Math.max(0, .62 * (1 - (distance - 2) / .32));

  function render() {
    cards.forEach((card, index) => {
      // Recycling occurs behind the scene, at zero opacity, never across the foreground.
      const offset = modulo(index - position + count / 2) - count / 2;
      const distance = Math.abs(offset);
      const spread = distance <= 1 ? distance : 1 + (distance - 1) * .75;
      const x = Math.sign(offset) * spread * stepWidth();
      const scale = 1 - Math.min(distance, 2.5) * .15;
      const angle = -Math.sign(offset) * Math.min(distance, 1) * 19;
      card.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(3)}px, ${(distance * 11).toFixed(3)}px, ${(-distance * 52).toFixed(3)}px) rotateY(${angle.toFixed(3)}deg) scale(${scale.toFixed(5)})`;
      card.style.opacity = String(opacityAt(distance));
      card.style.zIndex = String(100 - Math.round(distance * 30));
    });
  }
  function syncInfo(announce = true) {
    active = modulo(Math.round(target));
    const data = showcase[active];
    fields.forEach(([key, element]) => {
      element.textContent = key === 'price' ? 'Актуальные цены — в магазине' : data[key];
    });
    counter.textContent = `${String(active + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`;
    cards.forEach((card, index) => card.setAttribute('aria-hidden', String(index !== active)));
    // Keep showcase actions informative; no demo cart or fabricated product links.
    section.querySelector('[data-nutrition-buy]').setAttribute(
      'aria-label', `Посмотреть товары в магазине: ${data.name}`,
    );
    if (announce) status.textContent = `${active + 1} из ${count}. ${data.name}.`;
  }
  function goTo(next) {
    cancelAnimationFrame(frame);
    const from = position;
    target = next;
    syncInfo();
    if (reduced.matches) { position = target; render(); return; }
    const started = performance.now();
    const animate = now => {
      const t = Math.min((now - started) / 1080, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      position = from + (target - from) * eased;
      render();
      if (t < 1) frame = requestAnimationFrame(animate);
      else { position = target = modulo(target); render(); frame = 0; }
    };
    frame = requestAnimationFrame(animate);
  }
  const step = direction => { if (!pointer) goTo(Math.round(target) + direction); };
  section.querySelector('[data-nutrition-prev]').addEventListener('click', () => step(-1));
  section.querySelector('[data-nutrition-next]').addEventListener('click', () => step(1));
  gallery.addEventListener('keydown', event => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') {
      goTo(Math.round(position) + (event.key === 'Home' ? -active : count - 1 - active));
    } else step(event.key === 'ArrowRight' ? 1 : -1);
  });
  gallery.addEventListener('dragstart', event => event.preventDefault());
  gallery.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    cancelAnimationFrame(frame);
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, origin: position,
      lastX: event.clientX, lastTime: performance.now(), velocity: 0, locked: false};
    suppressClick = false;
    if (event.pointerType === 'mouse') {
      gallery.setPointerCapture(event.pointerId);
    }
  });
  gallery.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.locked) {
      if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) { release(event, true); return; }
      if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy)) return;
      pointer.locked = true;
      suppressClick = true;
      gallery.setPointerCapture(event.pointerId);
      gallery.classList.add('is-dragging');
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now(), elapsed = now - pointer.lastTime;
    if (elapsed > 0) pointer.velocity = .35 * pointer.velocity + .65 * (event.clientX - pointer.lastX) / elapsed;
    pointer.lastX = event.clientX; pointer.lastTime = now;
    position = pointer.origin - dx / stepWidth();
    if (!reduced.matches) render();
  }, {passive: false});
  function release(event, cancelled = false) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const gesture = pointer;
    pointer = null;
    gallery.classList.remove('is-dragging');
    if (gallery.hasPointerCapture(event.pointerId)) gallery.releasePointerCapture(event.pointerId);
    if (!gesture.locked || cancelled) { goTo(Math.round(target)); return; }
    const dx = event.clientX - gesture.x;
    const velocity = performance.now() - gesture.lastTime < 110 ? gesture.velocity : 0;
    let next = Math.round(position - clamp(velocity * 125 / stepWidth(), -1, 1));
    const origin = Math.round(gesture.origin);
    if (next === origin && (Math.abs(dx) > cardWidth * .16 || Math.abs(velocity) > .35)) next += dx < 0 ? 1 : -1;
    goTo(next);
  }
  gallery.addEventListener('pointerup', event => release(event));
  gallery.addEventListener('pointercancel', event => release(event, true));
  gallery.addEventListener('lostpointercapture', event => {
    // Ignore bubbling loss of the card's implicit touch capture when the
    // horizontal gesture transfers capture to the gallery.
    if (event.target === gallery && pointer) release(event, true);
  });
  window.addEventListener('blur', () => {
    if (pointer) release({pointerId: pointer.id}, true);
  });
  gallery.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; return; }
    const card = event.target.closest('[data-nutrition-card]');
    if (!card) return;
    const offset = modulo(cards.indexOf(card) - position + count / 2) - count / 2;
    if (Math.abs(offset) > .1) goTo(Math.round(position + offset));
  });
  const resize = () => {
    // Read untransformed width: transforms include scale/perspective.
    cardWidth = cards[0].offsetWidth; render(); };
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(gallery);
  else window.addEventListener('resize', resize, {passive: true});
  reduced.addEventListener('change', () => { cancelAnimationFrame(frame); position = target; render(); });
  section.querySelector('[data-nutrition-prev]').disabled = false;
  section.querySelector('[data-nutrition-next]').disabled = false;
  resize(); syncInfo(false);

})();
