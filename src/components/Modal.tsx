import { useEffect, useRef } from "react";
import { attachFocusTrap } from "../utils/focusTrap";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** id of the element labelling the dialog (aria-labelledby). */
    labelledBy?: string;
    /** Fallback accessible name when there's no visible title element. */
    ariaLabel?: string;
    /** "dialog" (default) or "alertdialog" for confirmation prompts. */
    role?: "dialog" | "alertdialog";
    /** Tailwind sizing/layout classes for the panel. */
    panelClassName?: string;
    /** Element to focus on open; defaults to the first focusable in the panel. */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    /** Close when the backdrop is clicked (default true). */
    closeOnBackdrop?: boolean;
    children: React.ReactNode;
}

/**
 * Shared modal primitive — standardizes the dialog contract across the app:
 * fixed backdrop, centered panel, role + aria-modal, Escape-to-close, a focus
 * trap, and focus-restore to the triggering element on close (via
 * attachFocusTrap). UX-01/02. Components with bespoke layouts (Settings,
 * Command Palette) keep their own markup but follow the same a11y contract.
 */
export function Modal({
    isOpen,
    onClose,
    labelledBy,
    ariaLabel,
    role = "dialog",
    panelClassName = "",
    initialFocusRef,
    closeOnBackdrop = true,
    children,
}: ModalProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        // Trap first so it captures the trigger element for focus-restore, then
        // move focus into the panel.
        const detach = attachFocusTrap(panelRef.current);
        const focusTarget =
            initialFocusRef?.current ??
            panelRef.current?.querySelector<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
        focusTarget?.focus();

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            detach();
        };
    }, [isOpen, onClose, initialFocusRef]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={closeOnBackdrop ? onClose : undefined}
                aria-hidden="true"
            />
            <div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-label={ariaLabel}
                className={`relative z-10 bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in ${panelClassName}`}
            >
                {children}
            </div>
        </div>
    );
}
