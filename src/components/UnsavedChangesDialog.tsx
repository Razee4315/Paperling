import { useRef } from "react";
import { Modal } from "./Modal";
import mascotSad from "../assets/mascot/mascot-sad.png";
import { useI18n } from "../i18n";

interface UnsavedChangesDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onDiscard: () => void;
    onSave: () => void;
    /** Names of the files with unsaved changes. When more than one is present the
     *  dialog lists them and the buttons read "Save all" / "Discard all". Omit or
     *  pass a single name for the original single-file wording. */
    dirtyNames?: string[];
}

export function UnsavedChangesDialog({
    isOpen,
    onClose,
    onDiscard,
    onSave,
    dirtyNames,
}: UnsavedChangesDialogProps) {
    const { t } = useI18n();
    const saveButtonRef = useRef<HTMLButtonElement>(null);
    const many = (dirtyNames?.length ?? 0) > 1;
    // With several tabs open, "You have unsaved changes" didn't say WHICH
    // file the answer applies to. DLG-01.
    const single = !many && dirtyNames?.[0] ? dirtyNames[0] : null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            role="alertdialog"
            labelledBy="unsaved-dialog-title"
            initialFocusRef={saveButtonRef}
            panelClassName="w-[min(380px,calc(100vw-1.5rem))]"
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
                        <h2 id="unsaved-dialog-title" className="text-base font-semibold text-[var(--text-primary)]">
                            {t("dialog.unsavedTitle")}
                        </h2>
                        <p className="text-sm text-[var(--text-secondary)]">
                            {many ? t("dialog.filesUnsaved", { count: dirtyNames!.length }) : t("dialog.changesLost")}
                        </p>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="px-5 pb-4">
                <p id="unsaved-dialog-desc" className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {many
                        ? t("dialog.saveThem")
                        : single
                            ? <>{t("dialog.saveOneBefore")}<strong className="font-semibold text-[var(--text-primary)] break-words">{single}</strong>{t("dialog.saveOneAfter")}</>
                            : t("dialog.saveThemOne")}
                </p>
                {many && (
                    <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
                        {dirtyNames!.map((name, i) => (
                            <li key={`${name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-primary)]">
                                <span className="material-symbols-outlined text-[14px] text-[var(--accent)] shrink-0">circle</span>
                                <span className="truncate">{name}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                >
                    {t("common.cancel")}
                </button>
                <button
                    onClick={onDiscard}
                    className="px-4 py-2 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg transition-colors"
                >
                    {many ? t("dialog.discardAll") : t("dialog.dontSave")}
                </button>
                <button
                    ref={saveButtonRef}
                    onClick={onSave}
                    className="px-4 py-2 text-sm font-medium text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors"
                >
                    {many ? t("dialog.saveAll") : t("common.save")}
                </button>
            </div>
        </Modal>
    );
}
