import { useEffect } from "react";
import { keyboardInset } from "../utils/keyboardInset";

/**
 * Publishes the on-screen keyboard's height as the CSS variable
 * `--keyboard-inset` on `<html>`, and keeps focused fields visible while the
 * keyboard is up.
 *
 * Consumers apply it as PADDING (`padding-bottom: var(--keyboard-inset)`) —
 * never as a height. On devices where the WebView resizes the layout viewport
 * for the keyboard, `100dvh` already accounts for it and the measured inset
 * is 0, so nothing double-applies. See utils/keyboardInset.ts for the math.
 *
 * The `focusin`/`focusout` handlers scroll the focused element into view with
 * `block: 'nearest'` roughly 250 ms after focus: tapping a second field while
 * the keyboard is already open fires no viewport resize, and 'center' would
 * scroll further than needed — the surplus goes into scrolling the whole
 * shell, which is then pinned back so the header can't vanish.
 */
export function useKeyboardInset(): void {
    useEffect(() => {
        const root = document.documentElement;
        const visual = window.visualViewport;
        if (!visual) return;

        let keyboardOpen = false;

        const apply = () => {
            const inset = keyboardInset({
                layoutHeight: root.clientHeight,
                visualHeight: visual.height,
                offsetTop: visual.offsetTop,
                scale: visual.scale,
            });
            keyboardOpen = inset > 0;
            root.style.setProperty("--keyboard-inset", `${inset}px`);
            // Consumers key off this class to yield space to the IME (e.g. the
            // mobile bottom nav hides while composing).
            root.classList.toggle("kb-open", keyboardOpen);
        };

        const revealFocusedField = () => {
            if (!keyboardOpen) return;
            // The keyboard opening (or a second tap into another field) lands
            // after the focus event; give the IME a beat to settle first.
            window.setTimeout(() => {
                const active = document.activeElement;
                if (!(active instanceof HTMLElement)) return;
                if (!/(input|textarea)/i.test(active.tagName) && !active.isContentEditable) return;
                active.scrollIntoView({ block: "nearest" });
                // `scrollIntoView` walks every scrollable ancestor including
                // the root; on an exactly-sized shell the surplus would scroll
                // the whole app. Pin it back.
                root.scrollTop = 0;
                document.body.scrollTop = 0;
            }, 250);
        };

        apply();
        visual.addEventListener("resize", apply);
        visual.addEventListener("scroll", apply);
        window.addEventListener("resize", apply);
        window.addEventListener("focusin", revealFocusedField);

        return () => {
            visual.removeEventListener("resize", apply);
            visual.removeEventListener("scroll", apply);
            window.removeEventListener("resize", apply);
            window.removeEventListener("focusin", revealFocusedField);
            root.style.removeProperty("--keyboard-inset");
            root.classList.remove("kb-open");
        };
    }, []);
}
