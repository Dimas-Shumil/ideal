(async () => {
  const controls = document.querySelector('.notifications__controls');
  if (!controls) return;
  const status = controls.querySelector('[role="status"]');
  const enable = controls.querySelector('[data-enable]'), disable = controls.querySelector('[data-disable]'), reset = controls.querySelector('[data-reset]'), testButton = controls.querySelector('[data-test]');
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    status.textContent = 'Web Push недоступен. На компьютере откройте localhost или 127.0.0.1; для телефона и публичного сайта нужен HTTPS и поддерживаемый браузер.'; return;
  }
  let registration, config, serverState = { registered: false }, keyMismatch = false;
  async function api(path, data) {
    const response = await fetch('/api/push/' + path, {
      method: data ? 'POST' : 'GET', credentials: 'same-origin',
      headers: data ? { 'Content-Type': 'application/json', 'x-csrf-token': controls.dataset.csrf } : {},
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 403
      ? 'Запрос отклонён. Проверьте адрес сайта и вход в аккаунт. Если сменили аккаунт, используйте «Переподключить уведомления».'
      : response.status === 401 ? 'Сессия завершена. Войдите в кабинет заново.'
      : response.status === 429 ? 'Слишком много проверок. Повторите позже.'
      : response.status === 503 ? 'Push на этом сервере не настроен. Проверьте настройки VAPID.'
      : 'Не удалось проверить уведомления. Проверьте соединение и повторите попытку.');
    return response.json();
  }
  function publicKey() {
    const base64 = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
  }
  function sameKey(sub) {
    const actual = sub.options?.applicationServerKey;
    if (!actual || !config.publicKey) return true; // Some engines do not expose the key.
    const bytes = ArrayBuffer.isView(actual) ? new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength) : new Uint8Array(actual);
    const expected = publicKey();
    return bytes.length === expected.length && bytes.every((v, i) => v === expected[i]);
  }
  async function refresh() {
    const sub = registration && await registration.pushManager.getSubscription();
    serverState = sub ? await api('status', { endpoint: sub.endpoint }) : { registered: false };
    keyMismatch = Boolean(sub && config.enabled && !sameKey(sub));
    const connected = serverState.registered && !keyMismatch;
    status.textContent = 'Разрешение: ' + ({ granted: 'выдано', denied: 'запрещено в настройках браузера', default: 'не запрошено' }[Notification.permission]) + '. Это устройство: ' + (connected ? 'подключено.' : 'не подключено.');
    enable.hidden = !config.enabled || Notification.permission === 'denied' || connected;
    enable.textContent = sub ? 'Переподключить на этом устройстве' : 'Включить на этом устройстве';
    disable.hidden = !serverState.registered;
    testButton.hidden = !config.enabled || !connected || Notification.permission !== 'granted';
    reset.hidden = !config.enabled || !sub || Notification.permission === 'denied';
    if (keyMismatch) status.textContent += ' Ключ сервера изменился. Переподключите уведомления для этого адреса.';
    else if (sub && !serverState.registered) status.textContent += ' Прежняя подписка браузера не подключена к текущему аккаунту. Переподключение заменит её.';
    if (!config.enabled) status.textContent += ' На этом сервере не настроена отправка Push.';
    return serverState;
  }
  function busy(value) { enable.disabled = value; disable.disabled = value; reset.disabled = value; testButton.disabled = value; }
  async function connect(force) {
    busy(true);
    status.textContent = 'Подключаем уведомления… Подтвердите разрешение, если браузер запросит его.';
    try {
      // Ask permission directly from the user's click; no permission prompts on load.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { await refresh(); return; }
      config = await api('config');
      if (!config.enabled) throw new Error('Push на этом сервере не настроен.');
      if (config.origin && config.origin !== window.location.origin) throw new Error('Откройте ' + config.origin + '/notifications: адрес должен совпадать с APP_ORIGIN этой среды.');
      registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      serverState = sub ? await api('status', { endpoint: sub.endpoint }) : { registered: false };
      if (sub && (force || keyMismatch || !sameKey(sub) || !serverState.registered)) {
        // Only remove the current account's server record. Never transfer a foreign endpoint.
        if (serverState.owned || serverState.registered) await api('unsubscribe', { endpoint: sub.endpoint });
        if (!await sub.unsubscribe()) throw new Error('Браузер не сбросил старую подписку. Удалите разрешение уведомлений в настройках сайта и повторите подключение.');
        sub = null;
      }
      if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey() });
      const json = sub.toJSON();
      await api('subscribe', { endpoint: json.endpoint, keys: json.keys });
      await refresh();
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  }
  enable.addEventListener('click', () => connect(false));
  reset.addEventListener('click', () => connect(true));
  testButton.addEventListener('click', async () => {
    busy(true);
    status.textContent = 'Проверяем отправку Push на это устройство…';
    try {
      const sub = await registration?.pushManager.getSubscription();
      if (!sub || Notification.permission !== 'granted') { await refresh(); return; }
      const result = await api('test', { endpoint: sub.endpoint });
      if (!result.queued) { status.textContent = 'Тест уже запрошен в течение последней минуты. Повторите через минуту.'; return; }
      status.textContent = 'Тест в очереди. Ожидаем результат отправки…';
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        const state = await api('status', { endpoint: sub.endpoint });
        if (!state.registered) {
          await refresh();
          status.textContent = 'Подписка больше недействительна. Нажмите «Переподключить уведомления», затем отправьте тест повторно.';
          return;
        }
        const delivery = state.lastTest;
        if (!delivery || delivery.eventKey !== result.eventKey) continue;
        if (delivery.status === 'SENT') { status.textContent = 'Push-сервис принял тестовое уведомление. Если оно не появилось, проверьте настройки уведомлений браузера и ОС.'; return; }
        if (['FAILED', 'SKIPPED'].includes(delivery.status)) {
          const code = delivery.lastStatus;
          status.textContent = code === 403
            ? 'Push-сервис отклонил авторизацию. Переподключите уведомления. Если ошибка повторится — проверьте пару VAPID-ключей и время сервера.'
            : 'Не удалось отправить тест' + (code ? ' (код ' + code + ')' : '') + '. Переподключите уведомления и повторите проверку.';
          return;
        }
      }
      status.textContent = 'Тест пока в очереди. Убедитесь, что сервер запущен; при восстановлении соединения отправка повторится автоматически.';
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  });
  disable.addEventListener('click', async () => {
    busy(true); status.textContent = 'Отключаем уведомления…';
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
    if (config.origin && config.origin !== window.location.origin) {
      status.textContent = 'Адрес браузера не совпадает с настройками этого сервера. Откройте ' + config.origin + '/notifications или исправьте APP_ORIGIN для этой среды.';
      return;
    }
    registration = await navigator.serviceWorker.getRegistration('/');
    await refresh();
  } catch (error) { status.textContent = error.message; }
})();
