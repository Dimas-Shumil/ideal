'use strict';
(() => {
  const products = window.IdealProducts;
  if (!products) return;
  const known = id => products.find(item => item.id === id);
  const key = 'ideal-demo-cart-v1';
  const limit = 99;
  let rows = [], memoryOnly = false, repaired = false;
  function normalize(value) {
    if (!Array.isArray(value)) { repaired = true; return []; }
    const result = [];
    value.slice(0, 500).forEach(row => {
      if (!row || !known(row.id) || !Number.isInteger(row.quantity) || row.quantity < 1) { repaired = true; return; }
      const quantity = Math.min(limit, row.quantity);
      if (quantity !== row.quantity) repaired = true;
      const existing = result.find(item => item.id === row.id);
      if (existing) { existing.quantity = Math.min(limit, existing.quantity + quantity); repaired = true; }
      else result.push({ id: row.id, quantity });
    });
    return result;
  }
  function read() {
    try { const raw = localStorage.getItem(key); rows = raw === null ? [] : normalize(JSON.parse(raw)); }
    catch (error) { rows = []; if (error instanceof SyntaxError) repaired = true; else memoryOnly = true; }
  }
  function storageNotice() {
    document.querySelectorAll('[data-cart-storage]').forEach(el => {
      el.textContent = memoryOnly ? 'Сохранение недоступно. Корзина работает только на этой странице до перезагрузки; при переходе на другую страницу содержимое может быть потеряно.' : repaired ? 'Некорректные данные корзины исправлены. Сохраняются только идентификаторы и количества демо-примеров.' : 'Демо-корзина сохраняется в этом браузере. Персональные данные не собираются.';
    });
  }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(rows)); }
    catch { memoryOnly = true; }
    storageNotice();
  }
  function announce(text) { document.querySelectorAll('[data-cart-feedback]').forEach(el => { el.textContent = text; }); }
  function validQuantity(value) { return Number.isInteger(value) && value >= 1 && value <= limit; }
  function add(id, quantity) {
    if (!known(id) || !validQuantity(quantity)) return false;
    const row = rows.find(item => item.id === id);
    const old = row?.quantity || 0;
    if (row) row.quantity = Math.min(limit, old + quantity);
    else rows.push({ id, quantity });
    persist(); render();
    announce(`${known(id).name}: ${Math.min(limit, old + quantity)} в демо-корзине. ${old + quantity >= limit ? 'Достигнут технический предел 99, это не остаток склада.' : 'Покупка не оформляется.'}`);
    return true;
  }
  window.IdealCart = Object.freeze({ add });
  const create = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  function render() {
    const list = document.querySelector('[data-cart-list]');
    if (!list) return;
    list.replaceChildren();
    rows.forEach(row => {
      const item = known(row.id), li = create('li', '', 'cart__item');
      const image = create('img'); image.src = item.image; image.alt = `Концепт упаковки: ${item.name}, не фото товара клуба`; image.width = 130; image.height = 170;
      const body = create('div'), heading = create('h3'), link = create('a', item.name);
      link.href = `/product.html?id=${item.id}`; heading.append(link);
      body.append(heading, create('p', `Демо-пример. Фасовка: ${item.packaging}. Стоимость: ${item.price}.`));
      const label = create('label', 'Количество демо-примеров');
      const input = create('input'); input.type = 'number'; input.min = '1'; input.max = String(limit); input.step = '1'; input.value = String(row.quantity); input.id = `quantity-${item.id}`; label.htmlFor = input.id;
      input.addEventListener('change', () => {
        const value = input.valueAsNumber;
        if (!validQuantity(value)) { input.value = String(row.quantity); announce('Введите целое количество от 1 до 99. Это технический предел демонстрации.'); return; }
        row.quantity = value; persist(); announce(`${item.name}: количество ${value}.`);
      });
      const remove = create('button', 'Удалить пример'); remove.type = 'button'; remove.setAttribute('aria-label', `Удалить демо-пример: ${item.name}`);
      remove.addEventListener('click', () => {
        const index = rows.indexOf(row); rows = rows.filter(entry => entry !== row); persist(); render();
        const next = list.querySelectorAll('input')[Math.min(index, rows.length - 1)];
        (next || document.querySelector('[data-cart-heading]')).focus(); announce(`${item.name}: удалено.`);
      });
      body.append(label, input, remove); li.append(image, body); list.append(li);
    });
    document.querySelector('[data-cart-empty]').hidden = rows.length > 0;
    document.querySelector('[data-cart-clear]').hidden = rows.length === 0;
  }
  read(); persist();
  document.querySelectorAll('[data-demo-add]').forEach(button => {
    if (!known(button.dataset.demoAdd)) return;
    button.disabled = false; button.addEventListener('click', () => add(button.dataset.demoAdd, 1));
  });
  const placeholder = document.querySelector('[data-product-placeholder]');
  if (placeholder) {
    const params = new URLSearchParams(location.search);
    const item = params.getAll('id').length === 1 ? known(params.get('id')) : null;
    if (!item) placeholder.querySelector('h2').textContent = 'Демо-пример не выбран или не найден';
    else {
      const content = document.querySelector('[data-product-content]');
      ['name','category','packaging','price','description','characteristics'].forEach(field => { content.querySelector(`[data-product-${field}]`).textContent = item[field]; });
      const image = content.querySelector('[data-product-image]'); image.src = item.image; image.alt = `Концепт упаковки: ${item.name}. Не фотография товара клуба.`;
      const button = content.querySelector('[data-product-add]'), input = content.querySelector('input');
      button.disabled = false;
      button.addEventListener('click', () => {
        if (!validQuantity(input.valueAsNumber)) { announce('Введите целое количество от 1 до 99.'); input.focus(); return; }
        add(item.id, input.valueAsNumber);
      });
      placeholder.hidden = true; content.hidden = false;
    }
  }
  const view = document.querySelector('[data-cart-view]');
  if (view) { view.hidden = false; render(); }
  document.querySelector('[data-cart-clear]')?.addEventListener('click', () => {
    rows = []; persist(); render(); document.querySelector('[data-cart-heading]').focus(); announce('Демо-корзина очищена.');
  });
  if (typeof openPreview === 'function') document.querySelectorAll('[data-cart-explain]').forEach(button => { button.disabled = false; });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    if (memoryOnly) return;
    read(); storageNotice(); render(); announce('Демо-корзина обновлена в другой вкладке.');
  });
})();
