import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { normalizeMarkdownFileName } from "../utils/mobileFiles";
import { downloadsSaveAvailable } from "../utils/nativePicker";

export interface SaveAsChoice {
    /** notes = the app-private notes folder; downloads = the shared Downloads folder. */
    destination: "notes" | "downloads";
    name: string;
}

interface SaveAsNameModalProps {
    isOpen: boolean;
    /** The buffer's current (untitled) name, used as the starting value. */
    defaultName?: string | null;
    /** Full path the note will get in the notes folder, shown to the user. */
    notesPath?: string | null;
    /** Resolves with the chosen destination (already normalized name), or null on cancel. */
    onConfirm: (choice: SaveAsChoice | null) => void;
}

/**
 * Mobile Save As. The OS save panel is unusable on Android (it returns a SAF
 * URI the Rust file commands can't read), so saving an untitled buffer asks
 * for a NAME and a DESTINATION; the caller owns the writing (and the note
 * content — this modal never sees it):
 *   - notes: written into the app-private notes folder (the caller builds the
 *     path via joinNotesPath) — the folder the in-app Files browser lists.
 *   - downloads: written to the user-visible Downloads folder through the
 *     native MediaStore bridge and mirrored into the app cache, so the note
 *     still ends up with a real path (recents, autosave).
 * The notes path is shown in full because "where did my file go" was the
 * number-one confusion in on-device testing.
 */
export function SaveAsNameModal({ isOpen, defaultName, notesPath, onConfirm }: SaveAsNameModalProps) {
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    // Re-seed each open so a second untitled buffer doesn't inherit the last name.
    useEffect(() => {
        if (isOpen) {
            setValue(defaultName ?? "");
            // Let the field mount before focusing; the keyboard should come up
            // right away — naming the note IS the task on this screen.
            window.setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 50);
        }
    }, [isOpen, defaultName]);

    const normalized = normalizeMarkdownFileName(value);
    const valid = value.trim().length > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => onConfirm(null)}
            labelledBy="saveas-title"
            panelClassName="w-[min(420px,calc(100vw-1.5rem))]"
        >
            <div className="px-5 pt-5 pb-4">
                <h2 id="saveas-title" className="text-base font-semibold text-[var(--text-primary)]">
                    Save note
                </h2>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                    Pick a name and where it should live.
                </p>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && valid) onConfirm({ destination: "notes", name: normalized });
                        if (e.key === "Escape") onConfirm(null);
                    }}
                    placeholder="Note name"
                    aria-label="Note name"
                    enterKeyHint="done"
                    className="mt-3 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                {valid && normalized !== value && (
                    <p className="text-xs text-[var(--text-muted)] mt-1.5">Will save as “{normalized}”</p>
                )}
                {notesPath && (
                    <div className="mt-3 text-xs text-[var(--text-muted)]">
                        <span className="font-medium text-[var(--text-secondary)]">Notes folder:</span>
                        <code className="block mt-1 px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] font-mono text-[11px] break-all select-text">
                            {notesPath}
                        </code>
                    </div>
                )}
                {downloadsSaveAvailable() && (
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                        Or put a copy into this device’s <span className="font-medium text-[var(--text-secondary)]">Downloads</span> folder, where any file manager can see it.
                    </p>
                )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[var(--bg-secondary)] border-t border-[var(--border)] flex-wrap">
                <button
                    onClick={() => onConfirm(null)}
                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                >
                    Cancel
                </button>
                {downloadsSaveAvailable() && (
                    <button
                        onClick={() => valid && onConfirm({ destination: "downloads", name: normalized })}
                        disabled={!valid}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Save to Downloads
                    </button>
                )}
                <button
                    onClick={() => valid && onConfirm({ destination: "notes", name: normalized })}
                    disabled={!valid}
                    className="px-4 py-2 text-sm font-medium text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Save to Notes
                </button>
            </div>
        </Modal>
    );
}
