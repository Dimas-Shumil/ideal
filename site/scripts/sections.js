'use strict';

// IDEAL / MONO — только секции после hero.
// Переход фона перенесён из «Этики волос»: clamp → lerp → mixColor →
// getScrollProgress → requestAnimationFrame(updateBackground).
// В CSS не используем :root / custom properties.
(() => {
  const wrapper = document.querySelector('[data-ideal-flow]');
  const memberships = document.querySelector('.memberships');
  if (!wrapper || !memberships) return;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const lerp = (start, end, progress) => start + (end - start) * progress;
  const mixColor = (from, to, progress) =>
    from.map((channel, index) => Math.round(lerp(channel, to[index], progress)));

  // Один фон на весь поток секций, как в «Этике волос».
  // Направления → абонементы → магазин: без фоновых накладок на секции.
  const lightColor = [246, 246, 243]; // #f6f6f3
  const darkColor = [17, 19, 21]; // #111315
  const shopColor = [247, 247, 245]; // #f7f7f5
  const nutrition = wrapper.querySelector('.nutrition');
  const trainerCTA = wrapper.querySelector('.trainer-cta');
  const trainerColor = [27, 29, 31]; // совпадает с существующим footer
  const nutritionShell = nutrition?.querySelector('.nutrition__shell');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Прогресс перехода привязан к расстоянию в viewport, не к скорости колёсика.
  function getScrollProgress(element, startRatio, endRatio) {
    const rect = element.getBoundingClientRect();
    const viewport = window.innerHeight;
    const start = viewport * startRatio;
    const end = viewport * endRatio;
    return clamp((start - rect.top) / (start - end), 0, 1);
  }

  const ease = (value) => value * value * (3 - 2 * value);
  let targetDark = 0;
  let targetLight = 0;
  let targetTrainer = 0;
  let currentTrainer = 0;
  let currentDark = 0;
  let currentLight = 0;
  let frame = 0;
  let lastFrameTime = 0;
  let lastColor = '';

  // Обе секции остаются прозрачными: у .memberships больше нет
  // резкого включения собственного background-color во время прокрутки.
  function renderBackground() {
    const enteredDark = mixColor(lightColor, darkColor, currentDark);
    const shopBackground = mixColor(enteredDark, shopColor, currentLight);
    const [r, g, b] = mixColor(shopBackground, trainerColor, currentTrainer);
    const color = `rgb(${r}, ${g}, ${b})`;

    if (lastColor !== color) {
      wrapper.style.backgroundColor = color;
      lastColor = color;
    }

    if (trainerCTA) {
      trainerCTA.style.color = `rgb(${mixColor([25, 28, 30], [247, 247, 245], currentTrainer).join(', ')})`;
    }

    // Магазин проявляется по мере осветления единого фона.
    // Прозрачность также привязана к прокрутке и полностью обратима.
    if (nutritionShell) {
      const visibility = ease(clamp((currentLight - 0.27) / 0.55, 0, 1));
      nutritionShell.style.opacity = String(visibility);
    }
  }

  // Небольшая инерция исключает скачки при резком вращении колеса,
  // тачпаде или перетаскивании системной полосы прокрутки.
  function animateBackground(time) {
    const dt = lastFrameTime ? Math.min(time - lastFrameTime, 64) : 16;
    lastFrameTime = time;
    const follow = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 190);
    currentTrainer += (targetTrainer - currentTrainer) * follow;
    if (Math.abs(targetTrainer - currentTrainer) < 0.0005) currentTrainer = targetTrainer;
    currentDark += (targetDark - currentDark) * follow;
    currentLight += (targetLight - currentLight) * follow;

    if (Math.abs(targetDark - currentDark) < 0.0005) currentDark = targetDark;
    if (Math.abs(targetLight - currentLight) < 0.0005) currentLight = targetLight;
    renderBackground();

    if (currentDark !== targetDark || currentLight !== targetLight || currentTrainer !== targetTrainer) {
      frame = requestAnimationFrame(animateBackground);
    } else {
      frame = 0;
      lastFrameTime = 0;
    }
  }

  function measureBackground() {
    // Начинаем затемнение, когда предыдущая секция уже покинула viewport.
    targetTrainer = trainerCTA ? getScrollProgress(trainerCTA, 0.32, 0.05) : 0;
    targetDark = getScrollProgress(memberships, 0.96, 0.14);
    targetLight = nutrition ? getScrollProgress(nutrition, 0.98, 0.06) : 0;
    if (!frame) frame = requestAnimationFrame(animateBackground);
  }

  // При загрузке сразу показываем цвет, соответствующий текущей позиции.
  // Это важно для обновления страницы с восстановленным scrollY.
  targetDark = currentDark = getScrollProgress(memberships, 0.96, 0.14);
  targetLight = currentLight = nutrition ? getScrollProgress(nutrition, 0.98, 0.06) : 0;
  targetTrainer = currentTrainer = trainerCTA ? getScrollProgress(trainerCTA, 0.32, 0.05) : 0;
  renderBackground();
  window.addEventListener('scroll', measureBackground, { passive: true });
  window.addEventListener('resize', measureBackground);
  reducedMotion.addEventListener('change', measureBackground);

  // Reveal подключается только при поддержке браузера; без JS контент виден.
  if (trainerCTA && 'IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      trainerCTA.classList.add('is-visible');
      observer.disconnect();
    }, { threshold: 0, rootMargin: '0px 0px -22% 0px' });
    trainerCTA.classList.add('is-reveal-enabled');
    observer.observe(trainerCTA);
    trainerCTA.addEventListener('focusin', () => {
      trainerCTA.classList.add('is-visible');
      observer.disconnect();
    });
    reducedMotion.addEventListener('change', event => {
      if (event.matches) { trainerCTA.classList.remove('is-reveal-enabled'); observer.disconnect(); }
    });
  }

  // Пункты уже существующего header / hero теперь ведут к новым разделам.
  // Старые main.js и hero-motion.js не изменяем. Перехватываем только
  // уже реализованные ссылки, остальные демо-кнопки работают как прежде.
  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-preview]');
    if (!control) return;
    const name = control.dataset.preview;
    const target = name === 'Направления'
      ? document.getElementById('next')
      : name === 'Абонементы'
        ? document.getElementById('memberships')
        : name === 'Магазин'
          ? document.getElementById('nutrition')
          : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle?.getAttribute('aria-expanded') === 'true') menuToggle.click();
    target.scrollIntoView({behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start'});
  }, true);

  // Карусель как на car.html (Трансфер19): кнопки на ПК,
  // удержание/drag мышью, свайпы на телефоне, стрелки клавиатуры.
  // Для карточек используется CSS scroll-snap — без сторонних плагинов.
  const tabs = [...document.querySelectorAll('[data-plan-tab]')];
  const views = [...document.querySelectorAll('[data-plans-panel]')];
  const prev = document.querySelector('[data-plans-prev]');
  const next = document.querySelector('[data-plans-next]');
  const counter = document.querySelector('[data-plans-counter]');
  const extras = [...document.querySelectorAll('[data-plans-extra]')];
  let current = tabs.find(tab => tab.classList.contains('is-active'))?.dataset.planTab || 'gym';
  // With no JS both categories remain visible and readable.
  views.forEach(panel => { panel.hidden = panel.dataset.plansPanel !== current; });

  const currentTrack = () => document.querySelector(`[data-plans-track="${current}"]`);
  const cardsOf = (track) => [...track.querySelectorAll('.membership-card')];
  const getCurrentIndex = (track) => {
    const cards = cardsOf(track);
    const left = track.scrollLeft;
    let closest = 0;
    cards.forEach((card, index) => {
      if (Math.abs(card.offsetLeft - cards[0].offsetLeft - left) <
          Math.abs(cards[closest].offsetLeft - cards[0].offsetLeft - left)) closest = index;
    });
    return closest;
  };
  function updateNav() {
    const track = currentTrack();
    if (!track) return;
    const cards = cardsOf(track);
    const count = cards.length;
    const index = getCurrentIndex(track);
    if (counter) counter.textContent = `${String(count ? index + 1 : 0).padStart(2,'0')} / ${String(count).padStart(2,'0')}`;
    if (prev) prev.disabled = track.scrollLeft <= 4;
    if (next) next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
  }
  function snapNearest(track) {
    const cards = cardsOf(track);
    if (!cards.length) return;
    const first = cards[0].offsetLeft;
    const chosen = cards[getCurrentIndex(track)];
    const left = chosen.offsetLeft - first;
    track.scrollTo({left, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
  }
  function step(direction) {
    const track = currentTrack();
    if (!track) return;
    const cards = cardsOf(track);
    if (!cards.length) return;
    const from = getCurrentIndex(track);
    const to = clamp(from + direction, 0, cards.length - 1);
    track.scrollTo({left: cards[to].offsetLeft - cards[0].offsetLeft,
      behavior: reducedMotion.matches ? 'instant' : 'smooth'});
  }

  // Native touch scroll provides friction and momentum on phones. The swipe
  // threshold/direction follows the example from car.js, but instead of
  // exchanging one photo, scroll-snap aligns the card after a gesture.
  views.forEach((panel) => {
    const track = panel.querySelector('.memberships__track');
    if (!track) return;
    let dragging = false, dragged = false, startX = 0, startY = 0, startScroll = 0;
    track.tabIndex = 0;
    track.setAttribute('role', 'region');
    track.setAttribute('aria-label', 'Листайте карточки абонементов');
    track.addEventListener('dragstart', (event) => event.preventDefault());
    track.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 ||
          event.target.closest('button, a')) return;
      dragging = true; dragged = false;
      startX = event.clientX; startY = event.clientY;
      startScroll = track.scrollLeft;
      track.classList.add('is-dragging');
      track.setPointerCapture?.(event.pointerId);
    });
    track.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 5) dragged = true;
      if (!dragged) return;
      track.scrollLeft = startScroll - dx;
    });
    const release = (event) => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-dragging');
      if (track.hasPointerCapture?.(event.pointerId)) track.releasePointerCapture(event.pointerId);
      if (dragged) {
        track.dataset.justDragged = 'true';
        window.setTimeout(() => { delete track.dataset.justDragged; }, 80);
        snapNearest(track);
      }
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    track.addEventListener('click', event => {
      if (!track.dataset.justDragged) return;
      event.preventDefault(); event.stopPropagation();
    }, true);
    track.addEventListener('keydown', (event) => {
      if (event.target.closest('button, a')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1);
      }
    });
    track.addEventListener('scroll', () => { if (track === currentTrack()) requestAnimationFrame(updateNav); }, {passive:true});
    // На touch-устройствах нативный горизонтальный свайп с snap; вертикальная
    // прокрутка страницы остаётся свободной, не перехватываем touchstart.
  });

  // На десктопе короткое нажатие = одна карточка;
  // удержание кнопки = непрерывная прокрутка с мягкой остановкой.
  [[prev,-1],[next,1]].forEach(([button,direction]) => {
    if (!button) return;
    let timer = null, frame = 0, wasHolding = false, startTime = 0, last = 0;
    const stop = () => {
      clearTimeout(timer); timer = null;
      cancelAnimationFrame(frame); frame = 0;
      if (wasHolding) {
        const track = currentTrack();
        if (track) { track.classList.remove('is-holding'); snapNearest(track); }
      }
    };
    const tick = (time) => {
      const track = currentTrack();
      if (!track) return;
      if (last) track.scrollLeft += direction * Math.min(time - last, 40) * .68;
      last = time;
      frame = requestAnimationFrame(tick);
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || button.disabled) return;
      wasHolding = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        wasHolding = true; last = 0;
        currentTrack()?.classList.add('is-holding');
        frame = requestAnimationFrame(tick);
      }, 310);
    });
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('click', event => {
      if (wasHolding) { event.preventDefault(); wasHolding = false; return; }
      step(direction);
    });
  });

  tabs.forEach(tab => tab.addEventListener('click', () => {
    const category = tab.dataset.planTab;
    if (!category || category === current) return;
    current = category;
    tabs.forEach(item => {
      const active = item.dataset.planTab === category;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    views.forEach(panel => { panel.hidden = panel.dataset.plansPanel !== category; });
    extras.forEach(item => { item.hidden = item.dataset.plansExtra !== category; });
    const track = currentTrack();
    if (track) track.scrollLeft = 0;
    requestAnimationFrame(updateNav);
  }));
  window.addEventListener('resize', () => requestAnimationFrame(updateNav));
  requestAnimationFrame(updateNav);

  // Preview UI без обещаний настоящей оплаты: backend подключим позже.
  const purchaseDialog = document.getElementById('purchase-dialog');
  const purchaseName = purchaseDialog?.querySelector('[data-purchase-name]');
  const purchasePrice = purchaseDialog?.querySelector('[data-purchase-price]');
  const purchaseTerms = purchaseDialog?.querySelector('[data-purchase-terms]');
  let returnFocus = null;

  document.querySelectorAll('[data-buy-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!purchaseDialog) return;
      returnFocus = button;
      purchaseName.textContent = button.dataset.buyPlan || '';
      purchasePrice.textContent = button.dataset.buyPrice || '';
      if (purchaseTerms) purchaseTerms.textContent = button.dataset.buyDetails || '';
      purchaseDialog.showModal();
    });
  });
  purchaseDialog?.querySelectorAll('[data-purchase-close]').forEach((button) => {
    button.addEventListener('click', () => purchaseDialog.close());
  });
  purchaseDialog?.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  });
  purchaseDialog?.addEventListener('click', (event) => {
    if (event.target !== purchaseDialog) return;
    const rect = purchaseDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) purchaseDialog.close();
  });
})();
