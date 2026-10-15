import { useEffect, useRef, type RefObject } from "react";
import { attachFocusTrap } from "../utils/focusTrap";
import { IS_MOBILE } from "../utils/platform";

/**
 * Keyboard behaviour shared by the docked side panels (files, outline,
 * backlinks). PANEL-01.
 *
 * On desktop these panels sit BESIDE the editor (the layout reserves their
 * width), so they must behave like a non-modal region, not a dialog:
 *  - Escape closes the panel only when focus is inside it. It used to close
 *    on Escape pressed anywhere, so leaving vim insert mode, closing the find
 *    bar or dismissing the slash menu also shut the outline.
 *  - Tab is not trapped on desktop; it is on the phone, where the panel is a
 *    full-screen sheet.
 *  - Focus moves into the panel when it opens (keyboard access) and returns
 *    to where it came from when it closes.
 */
export function useSidePanel(panelRef: RefObject<HTMLElement | null>, isOpen: boolean, onClose: () => void): void {
    // PANEL-02 (#225/#226): App supplies inline close callbacks. Typing changes
    // their identity; restarting this effect on each render pulled focus out
    // of Code/Reader and back into Files/Outline after the first character.
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        if (!isOpen) return;
        const panel = panelRef.current;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            const inside = !!panel && panel.contains(document.activeElement);
            if (!inside && !IS_MOBILE) return;
            e.preventDefault();
            closeRef.current();
        };
        document.addEventListener("keydown", handleKeyDown);
        const detach = attachFocusTrap(panel, { cycleTab: IS_MOBILE });
        panel?.focus();
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            detach();
        };
    }, [panelRef, isOpen]);
}
