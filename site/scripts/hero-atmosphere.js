'use strict';
// Абакан: UTC+7 круглый год. Не зависит от часового пояса посетителя.
(() => {
  const html = document.documentElement;
  const abakanMinutes = () => {
    const date = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  };
  const nightAmount = (minutes) => {
    if (minutes < 450 || minutes >= 1230) return 1;
    if (minutes < 480) return (480 - minutes) / 30;
    if (minutes < 1200) return 0;
    return (minutes - 1200) / 30;
  };
  const setPhase = (amount) => {
    html.dataset.heroPhase = amount === 0 ? 'day' : amount === 1 ? 'night' : 'twilight';
    html.classList.toggle('hero-night', amount >= .5);
  };
  // Синхронный вызов в head задаёт ночной режим до первой отрисовки.
  setPhase(nightAmount(abakanMinutes()));

  const init = () => {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const sky = hero.querySelector('.hero__night-sky');
    const stars = hero.querySelector('.hero__stars');
    const sun = hero.querySelector('.hero__sun');
    const clouds = hero.querySelector('.hero__clouds');
    const fog = hero.querySelector('.hero__ambient-fog');
    const figure = hero.querySelector('.hero__foreground img');
    let timer = null;
    let inView = true;
    const updateMotion = () => {
      hero.classList.toggle('is-atmosphere-paused', document.hidden || !inView);
    };
    const update = () => {
      const amount = nightAmount(abakanMinutes());
      setPhase(amount);
      if (sky) sky.style.opacity = String(amount);
      if (stars) stars.style.opacity = String(amount);
      if (sun) sun.style.opacity = String(1 - amount);
      if (clouds) clouds.style.opacity = String(.82 - amount * .36);
      if (fog) fog.style.opacity = String(.65 - amount * .23);
      if (figure) figure.style.filter = `brightness(${1 - amount * .28})`;
    };
    const stop = () => { window.clearTimeout(timer); timer = null; };
    const schedule = () => {
      stop();
      if (document.hidden) return;
      update();
      timer = window.setTimeout(schedule, 60000 - Date.now() % 60000 + 30);
    };
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        inView = entries[0]?.isIntersecting ?? true;
        updateMotion();
      }, { threshold: 0 });
      observer.observe(hero);
    }
    document.addEventListener('visibilitychange', () => { updateMotion(); schedule(); });
    window.addEventListener('pageshow', () => { updateMotion(); schedule(); });
    window.addEventListener('pagehide', stop);
    update();
    updateMotion();
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
