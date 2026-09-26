// WEB-02: visible HTML is the default, including when JS fails.
export function initMotion(): void {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let observer: IntersectionObserver | undefined;
  const stop = () => {
    observer?.disconnect();
    document
      .querySelectorAll<HTMLElement>("[data-reveal]")
      .forEach((el) => el.classList.remove("reveal-wait"));
  };
  if (!preference.matches && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove("reveal-wait");
            observer?.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add("reveal-wait");
        observer!.observe(el);
      }
    });
  }
  preference.addEventListener("change", stop);
  window.addEventListener("beforeprint", stop);
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof Element)
      e.target.closest("[data-reveal]")?.classList.remove("reveal-wait");
  });
}
