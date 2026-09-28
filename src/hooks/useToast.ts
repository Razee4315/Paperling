import { useCallback, useRef, useState } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
    /** Time (ms) the toast stays fully visible before fading out. */
    duration: number;
}

// Errors get more time on screen than confirmations — a failed save message is
// useless if it vanishes before it can be read.
const DURATION: Record<ToastType, number> = {
    success: 2000,
    info: 2600,
    error: 5000,
};

// Cap the stack so a burst of failures can't bury the UI; the oldest drops off.
const MAX_TOASTS = 3;

/** Toast notification state + show/dismiss helpers. Toasts stack (newest at the
 *  bottom) and each carries its own auto-dismiss duration. */
export function useToast() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(0);

    const showToast = useCallback((message: string, type: ToastType = "success") => {
        const id = nextId.current++;
        setToasts((prev) => {
            const next = [...prev, { id, message, type, duration: DURATION[type] }];
            return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
        });
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return { toasts, showToast, dismissToast };
}
