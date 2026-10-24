(async () => {
  const controls = document.querySelector('.notifications__controls');
  if (!controls) return;
  const status = controls.querySelector('[role="status"]');
  const enable = controls.querySelector('[data-enable]'), disable = controls.querySelector('[data-disable]'), reset = controls.querySelector('[data-reset]');
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    status.textContent = 'Web Push недоступен в этом браузере или требуется HTTPS.'; return;
  }
  let registration, config;
  async function api(path, data) {
    const response = await fetch('/api/push/' + path, {
      method: data ? 'POST' : 'GET', credentials: 'same-origin',
      headers: data ? { 'Content-Type': 'application/json', 'x-csrf-token': controls.dataset.csrf } : {},
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'Подписка связана с другим аккаунтом либо сессия завершена. Если вы сменили аккаунт в этом браузере, нажмите «Сбросить подписку браузера», затем включите заново. Если ошибка повторится — войдите в кабинет заново.' : 'Не удалось сохранить состояние. Проверьте соединение и повторите вход.');
    return response.json();
  }
  async function refresh() {
    const sub = registration && await registration.pushManager.getSubscription();
    const server = sub ? await api('status', { endpoint: sub.endpoint }) : { registered: false };
    status.textContent = 'Разрешение: ' + ({ granted: 'выдано', denied: 'запрещено в настройках браузера', default: 'не запрошено' }[Notification.permission]) + '. Это устройство: ' + (server.registered ? 'подключено.' : 'не подключено.');
    enable.hidden = !config.enabled || Notification.permission === 'denied' || server.registered;
    disable.hidden = !server.registered;
    reset.hidden = !sub || server.registered;
    if (sub && !server.registered) status.textContent += ' В браузере есть прежняя подписка. Если включение отклоняется, сначала сбросьте её кнопкой ниже.';
  }
  function busy(value) { enable.disabled = value; disable.disabled = value; reset.disabled = value; }
  reset.addEventListener('click', async () => {
    busy(true);
    status.textContent = 'Сбрасываем подписку этого браузера…';
    try {
      const sub = await registration?.pushManager.getSubscription();
      if (sub && !await sub.unsubscribe()) throw new Error('Не удалось сбросить подписку. Удалите разрешение уведомлений в настройках сайта.');
      await refresh();
      status.textContent = 'Прежняя подписка браузера отключена. Теперь нажмите «Включить на этом устройстве» для текущего аккаунта.';
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  });
  enable.addEventListener('click', async () => {
    busy(true);
    status.textContent = 'Подключаем уведомления… Если браузер запросит разрешение, подтвердите его.';
    try {
      // Permission request stays directly within the user's click handler.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { await refresh(); return; }
      registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        const base64 = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(base64), c => c.charCodeAt(0)) });
      }
      const json = sub.toJSON();
      await api('subscribe', { endpoint: json.endpoint, keys: json.keys });
      await refresh();
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  });
  disable.addEventListener('click', async () => {
    busy(true);
    status.textContent = 'Отключаем уведомления…';
    try {
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await api('unsubscribe', { endpoint: sub.endpoint });
        if (!await sub.unsubscribe()) throw new Error('Серверная подписка отозвана. Удалите разрешение в настройках браузера.');
      }
      await refresh();
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  });
  try {
    config = await api('config');
    registration = await navigator.serviceWorker.getRegistration('/');
    await refresh();
  } catch (error) { status.textContent = error.message; }
})();
