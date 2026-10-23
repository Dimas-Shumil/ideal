'use strict';
(() => {
  const catalog = document.querySelector('.shop__catalog');
  if (!catalog) return;
  // HTML is the single content source. Stable demo IDs and category keys are
  // integration markers, not real product identifiers or an API contract.
  const cards = [...catalog.querySelectorAll('[data-shop-item]')];
  const filters = [...catalog.querySelectorAll('[data-shop-filter]')];
  const resets = [...catalog.querySelectorAll('[data-shop-reset]')];
  const empty = catalog.querySelector('[data-shop-empty]');
  const status = catalog.querySelector('[data-shop-count]');
  function selectCategory(category) {
    let count = 0;
    cards.forEach(card => {
      const matches = category === 'all' || card.dataset.category === category;
      card.hidden = !matches;
      if (matches) count++;
    });
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shopFilter === category)));
    resets.forEach(button => { button.disabled = category === 'all'; });
    empty.hidden = count > 0;
    status.textContent = `Показано демо-карточек: ${count} из ${cards.length}. ${filters.find(button => button.dataset.shopFilter === category).textContent}.`;
  }
  filters.forEach(button => button.addEventListener('click', () => selectCategory(button.dataset.shopFilter)));
  resets.forEach(button => button.addEventListener('click', () => {
    selectCategory('all');
    // Reset disappears or becomes disabled; keep focus in the filter group.
    filters[0].focus({ preventScroll: true });
  }));
  catalog.querySelector('[data-shop-tools]').hidden = false;
  // main.js has already bound the shared dialog handlers (defer script order).
  if (typeof openPreview === 'function') {
    catalog.querySelectorAll('[data-preview]').forEach(button => { button.disabled = false; });
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!('IntersectionObserver' in window) || reduced.matches) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  }), { threshold: 0, rootMargin: '0px 0px -6% 0px' });
  cards.forEach(card => {
    card.classList.add('is-reveal-enabled');
    observer.observe(card);
    card.addEventListener('focusin', () => {
      card.classList.add('is-visible');
      observer.unobserve(card);
    });
  });
  reduced.addEventListener('change', event => {
    if (!event.matches) return;
    observer.disconnect();
    cards.forEach(card => card.classList.remove('is-reveal-enabled'));
  });
})();
