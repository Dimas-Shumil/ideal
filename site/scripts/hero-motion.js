'use strict';
// IDEAL / MONO: нативная лёгкая сценическая анимация, без CDN или runtime зависимостей.
// Работает одинаково с обоими HTML-входами. Без JS экран остаётся статичным.
(() => {
  const html = document.documentElement;
  const hero = document.querySelector('.hero');
  const next = document.querySelector('.preview-next');
  if (!hero) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const body = document.body;
  let running = false;
  let done = !html.classList.contains('hero-intro');
  let completeTimer = null;
  let introToken = 0;

  const finishIntro = () => {
    if (done) return;
    done = true;
    running = false;
    introToken += 1;
    window.clearTimeout(completeTimer);
    html.classList.remove('hero-intro', 'hero-intro-playing');
    // Удаляем CSS-анимации и состояния, сохраняя итоговые стили v3.
  };

  // Включаем вступление только после готовности фонового изображения, максимум через 900 мс.
  const beginIntro = () => {
    if (done || running || reducedMotion.matches) {
      finishIntro();
      return;
    }
    if (window.scrollY > 12 || window.location.hash && window.location.hash !== '#top') {
      finishIntro();
      return;
    }
    running = true;
    html.classList.add('hero-intro-playing');
    completeTimer = window.setTimeout(finishIntro, 3020);
  };

  if (!done) {
    const image = hero.querySelector('.hero__background img');
    const source = hero.querySelector('.hero__background source');
    const isPortraitArt = window.matchMedia('(max-width: 720px), (max-width: 1024px) and (orientation: portrait)').matches;
    const src = isPortraitArt ? source?.getAttribute('srcset') : image?.getAttribute('src');
    const myToken = ++introToken;
    let resolved = false;
    const startOnce = () => {
      if (resolved || done || myToken !== introToken) return;
      resolved = true;
      // Следующий frame гарантирует установку первого затемнённого кадра.
      requestAnimationFrame(beginIntro);
    };
    window.setTimeout(startOnce, 900);
    if (src) {
      const preload = new Image();
      preload.src = src;
      if (preload.decode) preload.decode().then(startOnce, startOnce);
      else if (preload.complete) startOnce();
      else {
        preload.onload = startOnce;
        preload.onerror = startOnce;
      }
    } else startOnce();
  }

  // Доступность: при запросе reduced motion немедленно показываем финальную композицию.
  reducedMotion.addEventListener('change', (event) => {
    if (event.matches) {
      finishIntro();
      hero.style.removeProperty('--hero-scroll-progress');
      next?.classList.remove('is-reveal-enabled');
    } else {
      updateOnScroll();
    }
  });

  let rafPending = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function updateOnScroll() {
    rafPending = false;
    if (reducedMotion.matches) return;
    const y = window.scrollY || window.pageYOffset;
    if (y > 24 && !done) finishIntro();
    const distance = Math.max(hero.offsetHeight * .85, 1);
    const progress = clamp(y / distance, 0, 1);
    hero.style.setProperty('--hero-scroll-progress', progress.toFixed(4));
  }
  function requestScrollUpdate() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(updateOnScroll);
    }
  }
  window.addEventListener('scroll', requestScrollUpdate, { passive: true });
  window.addEventListener('resize', requestScrollUpdate, { passive: true });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) finishIntro();
    requestScrollUpdate();
  });
  requestScrollUpdate();

  // Fade-in текста следующей секции, не прячем контент без IntersectionObserver.
  if (next && 'IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      next.classList.add('is-visible');
      observer.disconnect();
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    next.classList.add('is-reveal-enabled');
    observer.observe(next);
  }

  // Если посетитель открыл меню или демо-диалог во время intro, убираем затемнение.
  body.addEventListener('click', event => {
    if (event.target.closest('#menu-toggle, [data-preview], .hero__scroll')) finishIntro();
  }, { capture: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab' || event.key === 'Enter') finishIntro();
  }, { capture: true });
})();
