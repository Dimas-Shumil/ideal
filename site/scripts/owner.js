// Progressive enhancement only. All forms, confirmations and navigation work without JS.
const error = document.querySelector(".panel__error");
if (error) error.focus();
for (const form of document.querySelectorAll('form[method="post"]')) {
  form.addEventListener("submit", (event) => {
    if (form.dataset.busy) {
      event.preventDefault();
      return;
    }
    form.dataset.busy = "true";
    for (const button of form.querySelectorAll("button"))
      button.disabled = true;
    document.querySelector(".panel__busy").textContent =
      "Сохраняем. Дождитесь завершения запроса…";
  });
}
window.addEventListener("pageshow", () => {
  for (const form of document.querySelectorAll("form")) {
    delete form.dataset.busy;
    for (const button of form.querySelectorAll("button"))
      button.disabled = false;
  }
  document.querySelector(".panel__busy").textContent = "";
});
