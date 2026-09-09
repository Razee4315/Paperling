import { useEffect, useMemo, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSkippedUpdateVersion, setSkippedUpdateVersion } from "../utils/persistence";
import { attachFocusTrap } from "../utils/focusTrap";

type Phase = "available" | "downloading" | "installed" | "error";

/**
 * The GitHub release body is what `update.body` carries. Older releases shipped
 * a generic install blurb ("A minimal… markdown editor" + an Installation list
 * + a CHANGELOG link); newer ones inject the actual changelog section. This
 * strips the boilerplate either way so the dialog only ever shows real changes,
 * degrading gracefully on old releases instead of dumping raw text at the user.
 */
function cleanReleaseNotes(raw: string): string {
    let s = raw.replace(/\r\n/g, "\n").trim();
    // Cut the generic install instructions (and everything after) if present.
    const inst = s.search(/^#{1,6}\s+Installation\b/im);
    if (inst >= 0) s = s.slice(0, inst).trim();
    // The dialog header already names the version, so drop a redundant leading
    // "## What's new…" / "## Paperling vX" title line.
    s = s.replace(/^#{1,6}\s+(What's new|Paperling)\b.*\n+/i, "");
    // Drop the marketing tagline and the "see the changelog" footer line.
    s = s.replace(/^A minimal,? distraction-free markdown editor\.?\s*$/im, "");
    s = s.replace(/^See the \[CHANGELOG\].*$/im, "");
    return s.trim();
}

// Compact, theme-aware renderers for the release notes. No rehype-raw, so any
// HTML in the notes is inert — and links open in the OS browser, not the
// webview. Headings collapse to small section labels; list items get an accent
// dot. Kept module-level for a stable component identity.
const NOTES_COMPONENTS: Components = {
    h1: ({ children }) => <p className="mt-3 mb-1 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{children}</p>,
    h2: ({ children }) => <p className="mt-3 mb-1 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{children}</p>,
    h3: ({ children }) => <p className="mt-3 mb-1 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{children}</p>,
    h4: ({ children }) => <p className="mt-3 mb-1 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{children}</p>,
    p: ({ children }) => <p className="my-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">{children}</p>,
    ul: ({ children }) => <ul className="my-1 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 space-y-1 list-decimal pl-5 text-[12px] text-[var(--text-secondary)]">{children}</ol>,
    li: ({ children }) => (
        <li className="relative pl-4 text-[12px] leading-relaxed text-[var(--text-secondary)] before:absolute before:left-0 before:top-[8px] before:h-1 before:w-1 before:rounded-full before:bg-[var(--accent)]">
            {children}
        </li>
    ),
    strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
    code: ({ children }) => <code className="rounded bg-[var(--bg-hover)] px-1 py-0.5 font-mono text-[11px] text-[var(--text-primary)]">{children}</code>,
    a: ({ children, href }) => (
        <button
            type="button"
            onClick={() => { if (href) openUrl(href).catch(() => {/* opener unavailable */}); }}
            className="text-[var(--accent)] hover:underline"
        >
            {children}
        </button>
    ),
};

/**
 * Checks GitHub Releases (latest.json) once on startup and, if a newer signed
 * build exists, offers Update / Skip-this-version / Later. "Skip" is remembered
 * per version; "Later" just dismisses until the next launch. The check is
 * silent on failure — dev builds and offline machines must never see an error
 * popup they can't act on.
 */
export function UpdateDialog() {
    const [update, setUpdate] = useState<Update | null>(null);
    const [phase, setPhase] = useState<Phase>("available");
    // 0..1 once the content length is known; -1 = indeterminate.
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const dialogRef = useRef<HTMLDivElement>(null);

    const busy = phase === "downloading" || phase === "installed";

    // Boilerplate-stripped release notes. Empty when the body is only the
    // generic install blurb (old releases) — the dialog then just shows the
    // version line, never a wall of raw markdown.
    const notes = useMemo(() => (update?.body ? cleanReleaseNotes(update.body) : ""), [update]);

    // Escape dismisses like "Later", and Tab stays inside the dialog — the
    // same keyboard contract as the Settings modal. Disabled while busy: a
    // download/install in flight can't be cancelled, so dismissal would only
    // hide a process the user still has to wait out.
    useEffect(() => {
        if (!update || busy) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setUpdate(null);
            }
        };
        document.addEventListener("keydown", onKey);
        const detach = attachFocusTrap(dialogRef.current);
        return () => {
            document.removeEventListener("keydown", onKey);
            detach();
        };
    }, [update, busy]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const upd = await check();
                if (cancelled || !upd) return;
                if (getSkippedUpdateVersion() === upd.version) return;
                setUpdate(upd);
            } catch {
                /* offline / dev build without updater config — stay silent */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (!update) return null;

    const dismiss = () => setUpdate(null);

    const skipVersion = () => {
        setSkippedUpdateVersion(update.version);
        dismiss();
    };

    const install = async () => {
        setPhase("downloading");
        let total = 0;
        let received = 0;
        try {
            await update.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    total = event.data.contentLength ?? 0;
                    setProgress(total ? 0 : -1);
                } else if (event.event === "Progress") {
                    received += event.data.chunkLength;
                    if (total) setProgress(Math.min(received / total, 1));
                } else if (event.event === "Finished") {
                    setProgress(1);
                }
            });
            setPhase("installed");
            await relaunch();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setPhase("error");
        }
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Update available">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : dismiss} aria-hidden="true" />

            <div ref={dialogRef} className="relative z-10 w-[440px] max-w-[92vw] max-h-[90vh] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl animate-fade-in">
                <div className="px-5 pt-5 pb-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 shrink-0 rounded-[var(--radius-md)] bg-[var(--bg-hover)] flex items-center justify-center">
                            <span className="material-symbols-outlined text-[22px] text-[var(--accent)]">system_update_alt</span>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold text-[var(--text-primary)]">Update available</h2>
                            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                                Paperling <span className="font-semibold text-[var(--text-primary)]">v{update.version}</span> is ready (you're on v{update.currentVersion}).
                            </p>
                        </div>
                    </div>

                    {notes && phase === "available" && (
                        <div className="mt-4">
                            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                <span className="material-symbols-outlined text-[14px] text-[var(--accent)]">auto_awesome</span>
                                What's new
                            </div>
                            <div className="max-h-52 overflow-y-auto pr-1 -mr-1">
                                <Markdown remarkPlugins={[remarkGfm]} components={NOTES_COMPONENTS}>
                                    {notes}
                                </Markdown>
                            </div>
                        </div>
                    )}

                    {busy && (
                        <div className="mt-4">
                            <div className="h-1.5 w-full rounded-full bg-[var(--bg-hover)] overflow-hidden">
                                <div
                                    className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ${progress < 0 ? "w-full animate-pulse" : ""}`}
                                    style={progress >= 0 ? { width: `${Math.round(progress * 100)}%` } : undefined}
                                />
                            </div>
                            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                                {phase === "installed"
                                    ? "Installed, restarting…"
                                    : progress >= 0
                                        ? `Downloading… ${Math.round(progress * 100)}%`
                                        : "Downloading…"}
                            </p>
                        </div>
                    )}

                    {phase === "error" && (
                        <p className="mt-3 text-[12px] text-[var(--danger)] break-words">
                            Update failed: {error}
                        </p>
                    )}
                </div>

                {!busy && (
                <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                    {phase === "available" && (
                        <>
                            <button
                                type="button"
                                onClick={skipVersion}
                                className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                            >
                                Skip this version
                            </button>
                            <button
                                type="button"
                                onClick={dismiss}
                                className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                onClick={install}
                                // Landing focus here engages the focus trap and lets
                                // Enter accept / Tab reach Skip & Later — the dialog
                                // appears unprompted at launch, so without this the
                                // keyboard is still in the editor behind it.
                                autoFocus
                                className="px-3.5 py-1.5 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 transition-opacity"
                            >
                                Update now
                            </button>
                        </>
                    )}
                    {phase === "error" && (
                        <button
                            type="button"
                            onClick={dismiss}
                            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                            Close
                        </button>
                    )}
                </div>
                )}
            </div>
        </div>
    );
}
