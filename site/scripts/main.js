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

let headerLastY = Math.max(0, window.scrollY);
let headerTravel = 0;

function revealHeader() {
  header?.classList.remove('is-hidden');
  headerLastY = Math.max(0, window.scrollY);
  headerTravel = 0;
}

function syncHeader() {
  if (!header) return;
  // Clamp overscroll so the iPhone bounce cannot reverse the header direction.
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const y = Math.max(0, Math.min(window.scrollY, maxY));
  const delta = y - headerLastY;
  headerLastY = y;
  header.classList.toggle('is-scrolled', y > 14);
  const focused = document.activeElement;
  const keyboardFocus = focused && header.contains(focused) && focused.matches(':focus-visible');
  if (y <= Math.max(header.offsetHeight, 96) || document.body.classList.contains('menu-open') || keyboardFocus) {
    header.classList.remove('is-hidden');
    headerTravel = 0;
    return;
  }
  if (!delta) return;
  // Accumulate movement in one direction; tiny touchpad movements do not flicker.
  headerTravel = Math.sign(delta) === Math.sign(headerTravel) ? headerTravel + delta : delta;
  if (headerTravel >= 12) {
    header.classList.add('is-hidden');
    headerTravel = 0;
  } else if (headerTravel <= -8) {
    header.classList.remove('is-hidden');
    headerTravel = 0;
  }
}
window.addEventListener('scroll', syncHeader, { passive: true });
window.addEventListener('pageshow', () => { revealHeader(); syncHeader(); });
header?.addEventListener('focusin', revealHeader);
syncHeader();

// Inert prevents keyboard focus reaching hidden controls; CSS handles transitions.
menuPanel.hidden = false;
menuPanel.inert = true;
menuPanel.setAttribute('aria-hidden', 'true');

function setMenuState(open, { returnFocus = false } = {}) {
  const wasOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  if (open === wasOpen) return;
  revealHeader();
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  menuPanel.classList.toggle('is-open', open);
  menuPanel.inert = !open;
  menuPanel.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('menu-open', open);
  if (open) {
    // The toggle remains keyboard-accessible. Focus the first navigation entry after opening.
    const firstLink = menuPanel.querySelector('nav a, nav button');
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
  previewTitle.textContent = name === 'Записаться' ? 'Контакты клуба' : name;
  previewText.textContent = 'Условия посещения можно уточнить в клубе. Контакты указаны внизу страницы.';
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
    if (restoreFocusTo?.isConnected && !restoreFocusTo.closest('[inert]')) restoreFocusTo.focus({ preventScroll: true });
    else menuToggle.focus({ preventScroll: true });
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
  const focusable = [menuToggle, ...menuPanel.querySelectorAll('a[href], button:not([disabled])')];
  const position = focusable.indexOf(document.activeElement);
  if (event.shiftKey && position <= 0) {
    event.preventDefault();
    focusable[focusable.length - 1].focus();
  } else if (!event.shiftKey && position === focusable.length - 1) {
    event.preventDefault();
    focusable[0].focus();
  }
});

// Real navigation participates in the same menu lifecycle as preview buttons.
menuPanel.addEventListener('click', event => {
  if (event.target.closest('a[href]')) setMenuState(false);
});
document.querySelectorAll('a[href="/trainers.html"], a[href="/about.html"], a[href="/shop.html"]').forEach(link => {
  if (location.pathname.endsWith(link.getAttribute('href'))) link.setAttribute('aria-current', 'page');
});
// Do not keep the desktop page locked after a responsive menu breakpoint change.
window.matchMedia('(min-width: 1181px)').addEventListener('change', event => {
  if (event.matches) setMenuState(false, { returnFocus: true });
});
