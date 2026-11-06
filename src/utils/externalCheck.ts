/**
 * When to look for files changed on disk by something else. Window focus
 * alone (EXT-01) missed the side-by-side case: Paperling visible next to a
 * terminal or agent that edits the open notes never refreshed until the user
 * clicked away and back. So we also re-check on a short interval while the
 * window is visible. One stat per open file per tick is cheap, and needs no
 * native watcher. EXT-07.
 */
export const EXTERNAL_CHECK_INTERVAL_MS = 1500;

export type ExternalCheckTrigger = "focus" | "interval";

/** Run `check` on window focus and on an interval while the page is visible. */
export function subscribeExternalChecks(
  check: (trigger: ExternalCheckTrigger) => void,
  intervalMs: number = EXTERNAL_CHECK_INTERVAL_MS,
): () => void {
  const onFocus = () => check("focus");
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") check("interval");
  }, intervalMs);
  window.addEventListener("focus", onFocus);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}
