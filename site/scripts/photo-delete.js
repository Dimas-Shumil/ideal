'use strict';
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.matches('form[action^="/shop-panel/images/"][action$="/remove"]')) return;
  if (!window.confirm('Удалить эту фотографию товара? Сам товар останется в каталоге.')) {
    event.preventDefault();
  }
});
