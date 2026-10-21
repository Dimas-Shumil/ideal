'use strict';
// IDEAL / MONO: нативная лёгкая сценическая анимация, без CDN или runtime зависимостей.
// Работает одинаково с обоими HTML-входами. Без JS экран остаётся статичным.
(() => {
  const html = document.documentElement;
  const hero = document.querySelector('.hero');
  const next = document.querySelector('.preview-next');
  const backgroundImage = hero?.querySelector('.hero__background img');
  const foreground = hero?.querySelector('.hero__foreground');
  const titleWrap = hero?.querySelector('.hero__title-wrap');
  const transitionFog = hero?.querySelector('.hero__transition-fog');
  if (!hero) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const body = document.body;
  let running = false;
  let done = !html.classList.contains('hero-intro');
  let completeTimer = null;
  let introToken = 0;

  // Прогресс скролла больше не хранится в CSS-переменных.
  // Изменяем только свойства соответствующих слоёв.
  const applyScrollProgress = (progress) => {
    if (!done || reducedMotion.matches) return;
    if (backgroundImage) backgroundImage.style.transform = `scale(${(1 + progress * .025).toFixed(5)})`;
    if (foreground) foreground.style.transform = `translate3d(0, ${(-30 * progress).toFixed(2)}px, 0) scale(${(1 - progress * .022).toFixed(5)})`;
    if (titleWrap) {
      titleWrap.style.transform = `translate3d(-50%, ${(-30 * progress).toFixed(2)}px, 0) scale(${(1 + progress * .04).toFixed(5)})`;
      titleWrap.style.opacity = String(1 - progress * .75);
    }
    if (transitionFog) transitionFog.style.opacity = String(progress * .96);
  };

  const clearScrollStyles = () => {
    for (const el of [backgroundImage, foreground, titleWrap]) el?.style.removeProperty('transform');
    titleWrap?.style.removeProperty('opacity');
    transitionFog?.style.removeProperty('opacity');
  };

  const finishIntro = () => {
    if (done) return;
    done = true;
    running = false;
    introToken += 1;
    window.clearTimeout(completeTimer);
    html.classList.remove('hero-intro', 'hero-intro-playing');
    applyScrollProgress(currentProgress);
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
    completeTimer = window.setTimeout(finishIntro, 4130);
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
      clearScrollStyles();
      next?.classList.remove('is-reveal-enabled');
    } else {
      updateOnScroll();
    }
  });

  // Параллакс не догоняет колесо скачками: плавная инерция ~180 мс при любом FPS.
  let rafPending = false;
  let previousFrame = 0;
  let currentProgress = 0;
  let targetProgress = 0;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function animateScroll(frameTime) {
    if (reducedMotion.matches) {
      rafPending = false;
      previousFrame = 0;
      return;
    }
    const dt = previousFrame ? Math.min(frameTime - previousFrame, 64) : 16;
    previousFrame = frameTime;
    const smoothing = 1 - Math.exp(-dt / 180);
    currentProgress += (targetProgress - currentProgress) * smoothing;
    if (Math.abs(targetProgress - currentProgress) < .0005) {
      currentProgress = targetProgress;
      rafPending = false;
      previousFrame = 0;
    }
    applyScrollProgress(currentProgress);
    if (rafPending) requestAnimationFrame(animateScroll);
  }
  function updateOnScroll() {
    if (reducedMotion.matches) return;
    const y = window.scrollY || window.pageYOffset;
    if (y > 24 && !done) finishIntro();
    const distance = Math.max(hero.offsetHeight * .85, 1);
    targetProgress = clamp(y / distance, 0, 1);
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(animateScroll);
    }
  }
  function requestScrollUpdate() { updateOnScroll(); }
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
