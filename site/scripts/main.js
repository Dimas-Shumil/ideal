'use strict';
// IDEAL / MONO — navigation, microinteractions and demo dialogs.
// Hero reveal lives in hero-motion.js and runs independently.
const menuToggle = document.querySelector('#menu-toggle');
const menuPanel = document.querySelector('#mobile-menu');
const header = document.querySelector('.header');
const previewDialog = document.querySelector('#preview-dialog');
const previewTitle = document.querySelector('#preview-dialog-title');
const previewText = document.querySelector('#preview-dialog-description');
const dialogClose = document.querySelector('#preview-close');
const dialogOk = document.querySelector('#preview-dialog-ok');
const motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let modalCloseTimer;
let restoreFocusTo = null;

function syncHeader() {
  header.classList.toggle('is-scrolled', window.scrollY > 14);
}
window.addEventListener('scroll', syncHeader, { passive: true });
syncHeader();

// Inert prevents keyboard focus reaching hidden controls; CSS handles transitions.
menuPanel.hidden = false;
menuPanel.inert = true;
menuPanel.setAttribute('aria-hidden', 'true');

function setMenuState(open, { returnFocus = false } = {}) {
  const wasOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  if (open === wasOpen) return;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  menuPanel.classList.toggle('is-open', open);
  menuPanel.inert = !open;
  menuPanel.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('menu-open', open);
  if (open) {
    // The toggle remains keyboard-accessible. Focus the first navigation entry after opening.
    const firstLink = menuPanel.querySelector('nav button');
    if (firstLink) firstLink.focus({ preventScroll: true });
  } else if (returnFocus) {
    menuToggle.focus({ preventScroll: true });
  }
}

menuToggle.addEventListener('click', () => {
  setMenuState(menuToggle.getAttribute('aria-expanded') !== 'true', { returnFocus: true });
});

function openPreview(name, opener) {
  restoreFocusTo = opener;
  setMenuState(false);
  const isBooking = name === 'Записаться';
  const isMembership = name === 'Абонементы';
  previewTitle.textContent = isBooking ? 'Запись в клуб' : isMembership ? 'Абонементы' : name;
  previewText.textContent = isBooking
    ? 'Интерфейс записи подготовим вместе со страницей тренировок. Сейчас это демонстрация hero: заявки ещё не отправляются.'
    : isMembership
      ? 'Здесь откроются тарифы клуба и выбор абонемента. На этом этапе доступен только первый экран сайта.'
      : `Раздел «${name}» добавим на следующем этапе. Сейчас доступна интерактивная демонстрация первого экрана.`;
  clearTimeout(modalCloseTimer);
  previewDialog.showModal();
  requestAnimationFrame(() => previewDialog.classList.add('is-visible'));
}

function closePreview() {
  if (!previewDialog.open) return;
  previewDialog.classList.remove('is-visible');
  clearTimeout(modalCloseTimer);
  if (motionReduced.matches) {
    previewDialog.close();
    restoreFocusTo?.focus({ preventScroll: true });
    return;
  }
  modalCloseTimer = window.setTimeout(() => {
    previewDialog.close();
    if (restoreFocusTo?.isConnected && !restoreFocusTo.closest('[inert]')) {
      restoreFocusTo.focus({ preventScroll: true });
    } else {
      menuToggle.focus({ preventScroll: true });
    }
  }, 360);
}

document.querySelectorAll('[data-preview]').forEach((control) => {
  control.addEventListener('click', () => openPreview(control.dataset.preview, control));
});
dialogClose.addEventListener('click', closePreview);
dialogOk.addEventListener('click', closePreview);
previewDialog.addEventListener('click', (event) => {
  // A click on the native backdrop targets the dialog, outside its inner rectangle.
  if (event.target !== previewDialog) return;
  const rect = previewDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    closePreview();
  }
});
previewDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closePreview();
});
menuPanel.addEventListener('click', (event) => {
  if (event.target === menuPanel) setMenuState(false, { returnFocus: true });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    setMenuState(false, { returnFocus: true });
  }
  if (event.key !== 'Tab' || menuToggle.getAttribute('aria-expanded') !== 'true' || previewDialog.open) return;
  const focusable = [menuToggle, ...menuPanel.querySelectorAll('button:not([disabled])')];
  const position = focusable.indexOf(document.activeElement);
  if (event.shiftKey && position <= 0) {
    event.preventDefault();
    focusable[focusable.length - 1].focus();
  } else if (!event.shiftKey && position === focusable.length - 1) {
    event.preventDefault();
    focusable[0].focus();
  }
});
