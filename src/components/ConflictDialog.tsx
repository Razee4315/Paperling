import { useRef } from "react";
import { Modal } from "./Modal";
import mascotSad from "../assets/mascot/mascot-sad.png";

interface ConflictDialogProps {
    isOpen: boolean;
    /** Name of the file that changed on disk (title/body text). */
    fileName: string;
    /** Dismiss the dialog, keep editing; the next save overwrites the disk version. */
    onKeepMine: () => void;
    /** Discard the unsaved edits and reload the file from disk. */
    onLoadFromDisk: () => void;
    /** Write the current buffer to a new file the user picks; the conflicted
     *  file and the pending choice are left untouched ("keep both"). */
    onSaveCopy: () => void;
    /**
     * Intentionally inert: Escape/backdrop must NOT resolve this dialog.
     * Mapping dismissal onto "keep my version" armed an overwrite of the
     * external changes without the user ever choosing (EXT-02). The user must
     * pick one of the three actions.
     */
    onClose: () => void;
}

export function ConflictDialog({
    isOpen,
    fileName,
    onKeepMine,
    onLoadFromDisk,
    onSaveCopy,
    onClose,
}: ConflictDialogProps) {
    const keepMineButtonRef = useRef<HTMLButtonElement>(null);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            role="alertdialog"
            labelledBy="conflict-dialog-title"
            initialFocusRef={keepMineButtonRef}
            closeOnBackdrop={false}
            panelClassName="w-[460px] max-w-[calc(100vw-2rem)]"
        >
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
                <div className="flex items-center gap-3">
                    <img
                        src={mascotSad}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="w-12 h-12 object-contain select-none shrink-0"
                    />
                    <div>
                        <h2 id="conflict-dialog-title" className="text-base font-semibold text-[var(--text-primary)]">
                            File changed on disk
                        </h2>
                        <p className="text-sm text-[var(--text-secondary)]">
                            {fileName} was modified by another program
                        </p>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="px-5 pb-4">
                <p id="conflict-dialog-desc" className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    You have unsaved edits, and the file on disk is now different. Choose which version wins — until
                    you decide, autosave and manual save are paused. “Save a copy…” keeps your edits in a new file
                    without choosing.
                </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                <button
                    onClick={onSaveCopy}
                    className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                >
                    Save a copy…
                </button>
                <button
                    onClick={onLoadFromDisk}
                    className="px-4 py-2 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg transition-colors"
                >
                    Load from disk
                </button>
                <button
                    ref={keepMineButtonRef}
                    onClick={onKeepMine}
                    className="px-4 py-2 text-sm font-medium text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors"
                >
                    Keep my version
                </button>
            </div>
        </Modal>
    );
}
