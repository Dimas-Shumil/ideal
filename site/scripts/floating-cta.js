// Public CTA only: no new booking endpoint or private data.
(() => {
  const cta = document.querySelector('[data-floating-cta]');
  const footer = document.querySelector('.ideal-footer');
  if (!cta || !footer) return;

  let footerVisible = false;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const bounds = footer.getBoundingClientRect();
    // Hide before the buttons overlap the footer, also without IntersectionObserver.
    const nearFooter = footerVisible || bounds.top <= innerHeight - 8;
    const show = scrollY > Math.min(120, innerHeight * 0.15) &&
      !nearFooter && !document.body.classList.contains('menu-open');
    cta.classList.toggle('is-visible', show);
    cta.inert = !show;
    cta.setAttribute('aria-hidden', String(!show));
    if (!show && cta.contains(document.activeElement)) document.activeElement.blur();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      footerVisible = entries[0]?.isIntersecting ?? false;
      schedule();
    }, { threshold: 0 });
    observer.observe(footer);
  }
  const menuObserver = new MutationObserver(schedule);
  menuObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  addEventListener('pageshow', schedule);
  schedule();
})();
