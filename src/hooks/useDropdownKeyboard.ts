import { useEffect, type RefObject } from "react";
import { attachFocusTrap } from "../utils/focusTrap";

// Mirrors focusTrap's notion of "focusable", minus links (menus here are all
// buttons/inputs) so Arrow navigation lands only on actionable items.
const FOCUSABLE = [
    "button:not([disabled])",
    "input:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keyboard support for a custom dropdown/menu panel. When it opens, focus moves
 * into the panel and Tab is trapped inside; closing returns focus to the trigger
 * (via attachFocusTrap). The returned handler adds roving Arrow/Home/End
 * navigation across the panel's focusable items and closes on Escape, so the
 * menu is fully usable without a mouse.
 *
 * `panelRef` must point at the menu panel itself (not the outer wrapper) so the
 * focusable query is scoped to the menu items.
 */
export function useDropdownKeyboard<T extends HTMLElement>(
    isOpen: boolean,
    panelRef: RefObject<T | null>,
    onClose: () => void,
): (e: React.KeyboardEvent) => void {
    useEffect(() => {
        if (!isOpen) return;
        const panel = panelRef.current;
        if (!panel) return;
        const detach = attachFocusTrap(panel);
        // Land on the first item so Arrow keys have a starting point and screen
        // readers announce the menu contents immediately.
        panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
        return detach;
    }, [isOpen, panelRef]);

    return (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
            return;
        }
        const panel = panelRef.current;
        if (!panel) return;
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        e.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        let next: number;
        if (e.key === "Home") next = 0;
        else if (e.key === "End") next = items.length - 1;
        else if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
        else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        items[next].focus();
    };
}
