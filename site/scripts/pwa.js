(() => {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const status = document.querySelector('[data-pwa-status]');
  const update = document.querySelector('[data-pwa-update]');
  const install = document.querySelector('[data-pwa-install]');
  const check = document.querySelector('[data-pwa-check]');
  let prompt, registration;
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function state() {
    if (status) status.textContent = !navigator.onLine ? 'Нет соединения. Серверные операции недоступны.' : installed() ? 'Приложение открыто в отдельном окне.' : 'Установка доступна через поддерживаемый браузер.';
    if (install) install.hidden = !prompt || installed();
  }
  function waiting() {
    if (update) update.textContent = registration?.waiting ? 'Доступна новая версия. Завершите работу и закройте все вкладки и окна ИДЕАЛ, затем откройте приложение снова.' : 'Ожидающих обновлений нет. Проверка требует соединения с сервером.';
  }
  window.addEventListener('beforeinstallprompt', event => {
    // Suppress automatic promotion only where our explicit install control exists.
    if (!install) return;
    event.preventDefault(); prompt = event; state();
  });
  install?.addEventListener('click', async () => {
    if (!prompt) return;
    const current = prompt; prompt = null; state();
    try { await current.prompt(); await current.userChoice; }
    catch { if (status) status.textContent = 'Установите приложение через меню браузера.'; }
  });
  window.addEventListener('appinstalled', () => { prompt = null; state(); });
  window.addEventListener('online', state); window.addEventListener('offline', state);
  state();
  navigator.serviceWorker.register('/push-sw.js', {scope: '/', updateViaCache: 'none'}).then(reg => {
    registration = reg; waiting();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        // Registration.waiting may be assigned after the installed state event.
        setTimeout(waiting, 0);
      });
    });
  }).catch(() => {
    if (status) status.textContent = 'Подготовить приложение не удалось. Проверьте соединение и настройки браузера.';
    if (update) update.textContent = 'Проверка обновления недоступна.';
  });
  check?.addEventListener('click', async () => {
    if (!registration) { if (update) update.textContent = 'Приложение ещё не подготовлено. Откройте страницу снова при доступной сети.'; return; }
    check.disabled = true;
    try { await registration.update(); waiting(); }
    catch { if (update) update.textContent = 'Не удалось проверить обновление. Проверьте соединение.'; }
    finally { check.disabled = false; }
  });
})();
