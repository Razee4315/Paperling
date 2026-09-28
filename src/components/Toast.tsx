import { useEffect, useState } from 'react';
import iconCheckBadge from '../assets/mascot/icon-check-badge.png';
import type { ToastItem, ToastType } from '../hooks/useToast';

// Re-exported for the handful of call sites that import the type from here.
export type { ToastType };

function icon(type: ToastType) {
    switch (type) {
        case 'success':
            return <img src={iconCheckBadge} alt="" aria-hidden="true" draggable={false} className="w-5 h-5 object-contain select-none" />;
        case 'error':
            return (
                <svg className="w-4 h-4 text-[var(--danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            );
        default:
            return (
                <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            );
    }
}

// A single toast row: fades in on mount, fades out after its duration, then asks
// the stack to drop it. Each row owns its timers so toasts dismiss independently.
function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const enter = requestAnimationFrame(() => setShown(true));
        const fade = window.setTimeout(() => setShown(false), toast.duration);
        const remove = window.setTimeout(() => onDismiss(toast.id), toast.duration + 200);
        return () => {
            cancelAnimationFrame(enter);
            clearTimeout(fade);
            clearTimeout(remove);
        };
    }, [toast.id, toast.duration, onDismiss]);

    return (
        <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            className={`px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]
                shadow-lg text-[var(--text-primary)] text-sm font-medium
                transition-all duration-200 ease-out
                ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        >
            <div className="flex items-center gap-2">
                {icon(toast.type)}
                {toast.message}
            </div>
        </div>
    );
}

/** Bottom-center stack of active toasts (newest lowest). */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
    if (toasts.length === 0) return null;
    return (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
            {toasts.map((t) => (
                <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
