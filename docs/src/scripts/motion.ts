// WEB-02: visible HTML is the default, including when JS fails.
// WEB-07: reveals fade up with a short stagger; smooth wheel scrolling is
// desktop-only and loads on demand, so phones and reduced-motion users keep
// native scrolling and never download Lenis.
import type Lenis from "lenis";

const REVEAL_MS = 1400;

export function initMotion(): void {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let observer: IntersectionObserver | undefined;
  let lenis: Lenis | undefined;
  const settle = (el: Element) => {
    el.classList.remove("reveal-wait");
    // Drop the slow reveal transition afterwards so hover effects stay snappy.
    window.setTimeout(() => {
      el.classList.remove("reveal");
      (el as HTMLElement).style.removeProperty("--reveal-delay");
    }, REVEAL_MS);
  };
  const stop = () => {
    observer?.disconnect();
    lenis?.destroy();
    lenis = undefined;
    document
      .querySelectorAll<HTMLElement>("[data-reveal]")
      .forEach((el) => el.classList.remove("reveal-wait", "reveal"));
  };
  if (!preference.matches && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            settle(entry.target);
            observer?.unobserve(entry.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      if (el.getBoundingClientRect().top <= window.innerHeight) return;
      // Siblings in a grid arrive one after another instead of all at once.
      const siblings = el.parentElement
        ? [...el.parentElement.children].filter((c) =>
            c.hasAttribute("data-reveal"),
          )
        : [el];
      const order = siblings.indexOf(el) % 4;
      el.style.setProperty("--reveal-delay", order * 90 + "ms");
      el.classList.add("reveal", "reveal-wait");
      observer!.observe(el);
    });
    initSmoothScroll().then((instance) => (lenis = instance));
  }
  preference.addEventListener("change", stop);
  window.addEventListener("beforeprint", stop);
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof Element) {
      const el = e.target.closest("[data-reveal]");
      if (el) settle(el);
    }
  });
}

async function initSmoothScroll(): Promise<Lenis | undefined> {
  // Touch screens already scroll smoothly; only mice and trackpads get Lenis.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  try {
    const { default: Lenis } = await import("lenis");
    return new Lenis({
      lerp: 0.1,
      autoRaf: true,
      allowNestedScroll: true,
      // Lenis honours scroll-padding-top, so headings already clear the sticky header.
      anchors: true,
    });
  } catch {
    return undefined; // Native scrolling is a fine fallback.
  }
}
