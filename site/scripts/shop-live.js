"use strict";
(() => {
  const cards = [...document.querySelectorAll("[data-shop-reveal]")],
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (!("IntersectionObserver" in window) || reduced.matches) return;
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }),
    { rootMargin: "0px 0px -6% 0px" },
  );
  cards.forEach((card) => {
    card.classList.add("is-reveal-enabled");
    observer.observe(card);
    card.addEventListener("focusin", () => {
      card.classList.add("is-visible");
      observer.unobserve(card);
    });
  });
  reduced.addEventListener("change", (e) => {
    if (e.matches) {
      observer.disconnect();
      cards.forEach((card) => card.classList.remove("is-reveal-enabled"));
    }
  });
})();
