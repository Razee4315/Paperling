/**
 * Focus trap helper — when active, Tab/Shift+Tab cycles within the container
 * instead of escaping. Used by sidebar panels and dialogs.
 */

const FOCUSABLE = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

export function attachFocusTrap(
    container: HTMLElement | null,
    // false: only remember and restore focus (non-modal side panels on
    // desktop must not hold Tab hostage). PANEL-01.
    { cycleTab = true }: { cycleTab?: boolean } = {},
): () => void {
    if (!container) return () => { };

    // Remember what had focus before the trap engaged so we can return focus
    // there on detach — keyboard/screen-reader users land back on the control
    // that opened the dialog instead of at the top of the document. Call this
    // BEFORE moving focus into the dialog so we capture the trigger, not the
    // dialog's own first field. UX-01.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handler = (e: KeyboardEvent) => {
        if (e.key !== "Tab" || !cycleTab) return;
        const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && active === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    };

    container.addEventListener("keydown", handler);
    return () => {
        container.removeEventListener("keydown", handler);
        if (
            previouslyFocused &&
            typeof previouslyFocused.focus === "function" &&
            document.contains(previouslyFocused)
        ) {
            previouslyFocused.focus();
        }
    };
}
