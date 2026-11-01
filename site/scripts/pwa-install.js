(() => {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const INSTALLED = 'ideal-pwa-installed';
  let deferredPrompt, banner, installButton, hint, dismissed = false;
  // Match the Hero's actual twilight threshold, not a separate 21:00–08:00 schedule.
  // The homepage Hero owns the phase; on other public pages use its UTC+7 cutoff.
  const abakanNight = () => {
    const root = document.documentElement;
    if (root.hasAttribute('data-hero-phase')) return root.classList.contains('hero-night');
    const date = new Date(Date.now() + 7 * 3600000);
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return minutes >= 20 * 60 + 15 || minutes < 7 * 60 + 45;
  };
  const updateBannerPhase = () => { if (banner) banner.dataset.pwaPhase = abakanNight() ? 'night' : 'day'; };
  window.setInterval(() => { if (banner && !banner.hidden) updateBannerPhase(); }, 60000);
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Current page still works without storage. */ } };
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone()) write(INSTALLED, '1');
  const suppressed = () => dismissed || standalone() || read(INSTALLED) === '1';
  function later() {
    // Closing applies only to this document; the next page starts a new 10-second timer.
    dismissed = true;
    if (banner) banner.hidden = true;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferredPrompt = event;
    // A fresh native offer also means a previous installation mark is stale.
    write(INSTALLED, '0');
    if (hint) hint.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    write(INSTALLED, '1'); deferredPrompt = null;
    if (banner) banner.hidden = true;
  });
  window.addEventListener('storage', event => {
    if (event.key === INSTALLED && banner && suppressed()) banner.hidden = true;
  });
  function show() {
    if (suppressed()) return;
    banner = document.createElement('aside');
    banner.className = 'pwa-install'; banner.setAttribute('aria-label', 'Установка приложения ИДЕАЛ'); updateBannerPhase();
    const content = document.createElement('div'); content.className = 'pwa-install__content';
    const title = document.createElement('p'); title.className = 'pwa-install__title'; title.textContent = 'ИДЕАЛ — всегда рядом';
    const text = document.createElement('p'); text.className = 'pwa-install__text'; text.textContent = 'Расписание, тренеры и абонементы — в приложении.';
    hint = document.createElement('p'); hint.className = 'pwa-install__hint'; hint.hidden = true; hint.setAttribute('role', 'status');
    hint.textContent = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? 'Откройте меню «Поделиться» в браузере, выберите «На экран Домой» и подтвердите добавление.'
      : 'Откройте меню браузера и выберите установку приложения. Если такого пункта нет, используйте браузер с поддержкой установки.';
    const actions = document.createElement('div'); actions.className = 'pwa-install__actions';
    installButton = document.createElement('button'); installButton.type = 'button'; installButton.className = 'pwa-install__button'; installButton.textContent = 'Установить';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'pwa-install__button pwa-install__button--later'; dismiss.textContent = 'Позже';
    dismiss.addEventListener('click', later);
    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) { hint.hidden = false; return; }
      const current = deferredPrompt; deferredPrompt = null; installButton.disabled = true;
      try {
        await current.prompt();
        const choice = await current.userChoice;
        if (choice.outcome === 'dismissed') later();
        else { dismissed = true; banner.hidden = true; }
      } catch { hint.hidden = false; }
      finally { installButton.disabled = false; }
    });
    banner.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); later(); } });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'pwa-install__close'; close.textContent = '×'; close.setAttribute('aria-label', 'Закрыть предложение установки');
    close.addEventListener('click', later);
    let touch;
    banner.addEventListener('touchstart', event => {
      touch = null;
      if (event.touches.length !== 1 || event.target.closest('button, a')) return;
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY };
    }, { passive: true });
    banner.addEventListener('touchmove', event => {
      if (event.touches.length !== 1) touch = null;
    }, { passive: true });
    banner.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
    banner.addEventListener('touchend', event => {
      const start = touch; touch = null;
      if (!start || event.touches.length || event.changedTouches.length !== 1) return;
      const point = event.changedTouches[0];
      const dx = point.clientX - start.x, dy = point.clientY - start.y;
      const sideways = Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.2;
      // Preserve vertical scrolling of long instructions on short/zoomed screens.
      const upwards = dy <= -56 && Math.abs(dy) > Math.abs(dx) * 1.2 && banner.scrollHeight <= banner.clientHeight + 1;
      if (sideways || upwards) later();
    }, { passive: true });
    const logo = document.createElement('img'); logo.className = 'pwa-install__logo'; logo.src = '/site/img/pwa/icon-192-orange-v3.png'; logo.alt = ''; logo.width = 64; logo.height = 64;
    title.append(logo); content.append(title, text, hint); actions.append(installButton, dismiss); banner.append(content, actions, close); document.body.append(banner);
    // Non-modal: never steal keyboard focus or prevent interaction with the page.
  }
  setTimeout(() => {
    if (!document.hidden) show();
    else document.addEventListener('visibilitychange', function visible() {
      if (!document.hidden) { document.removeEventListener('visibilitychange', visible); show(); }
    });
  }, 10000);
})();
