(() => {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const LATER = 'ideal-pwa-later-until';
  const INSTALLED = 'ideal-pwa-installed';
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  let deferredPrompt, banner, installButton, hint, dismissed = false;
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Current page still works without storage. */ } };
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone()) write(INSTALLED, '1');
  const suppressed = () => dismissed || standalone() || read(INSTALLED) === '1' || Number(read(LATER)) > Date.now();
  function later() {
    dismissed = true; write(LATER, String(Date.now() + WEEK));
    if (banner) banner.hidden = true;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferredPrompt = event;
    if (hint) hint.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    write(INSTALLED, '1'); deferredPrompt = null;
    if (banner) banner.hidden = true;
  });
  window.addEventListener('storage', event => {
    if ((event.key === LATER || event.key === INSTALLED) && banner && suppressed()) banner.hidden = true;
  });
  function show() {
    if (suppressed()) return;
    banner = document.createElement('aside');
    banner.className = 'pwa-install'; banner.setAttribute('aria-label', 'Установка приложения ИДЕАЛ');
    const content = document.createElement('div'); content.className = 'pwa-install__content';
    const title = document.createElement('p'); title.className = 'pwa-install__title'; title.textContent = 'ИДЕАЛ всегда под рукой';
    const text = document.createElement('p'); text.className = 'pwa-install__text'; text.textContent = 'Установите приложение клуба для быстрого доступа к сайту и магазину.';
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
    const logo = document.createElement('img'); logo.className = 'pwa-install__logo'; logo.src = '/site/img/brand/ideal-logo-v1.webp'; logo.alt = ''; logo.width = 64; logo.height = 64;
    title.append(logo); content.append(title, text, hint); actions.append(installButton, dismiss); banner.append(content, actions); document.body.append(banner);
    // Non-modal: never steal keyboard focus or prevent interaction with the page.
  }
  setTimeout(() => {
    if (!document.hidden) show();
    else document.addEventListener('visibilitychange', function visible() {
      if (!document.hidden) { document.removeEventListener('visibilitychange', visible); show(); }
    });
  }, 10000);
})();
