import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import { Modal } from "./Modal";
import { fileHistory, type Snapshot, type SnapshotReason } from "../utils/fileHistory";

interface FileHistoryDialogProps {
    isOpen: boolean;
    path: string;
    fileName: string;
    /** The live buffer: what a restore would replace. */
    current: string;
    onRestore: (content: string) => void;
    onClose: () => void;
}

const REASON_LABEL: Record<SnapshotReason, string> = {
    opened: "Opened",
    saved: "Saved",
    "before-restore": "Before a restore",
};

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const lineCount = (text: string) => (text === "" ? 0 : text.split("\n").length);

/** Read-only view of `current` with what `original` had marked inline. */
function VersionDiff({ original, current }: { original: string; current: string }) {
    const hostRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!hostRef.current) return;
        const view = new EditorView({
            parent: hostRef.current,
            state: EditorState.create({
                doc: current,
                extensions: [
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    EditorView.lineWrapping,
                    unifiedMergeView({ original, mergeControls: false }),
                    EditorView.theme({
                        "&": { height: "100%", color: "var(--text-primary)", backgroundColor: "var(--bg-editor)", fontSize: "12px" },
                        ".cm-scroller": { overflow: "auto", fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace" },
                        ".cm-gutters": { backgroundColor: "transparent", border: "none" },
                    }),
                ],
            }),
        });
        return () => view.destroy();
    }, [original, current]);
    return <div ref={hostRef} className="h-full" />;
}

/**
 * Earlier versions of the open file, each shown against the current text. A
 * restore puts the version in the editor as a normal edit: Ctrl+Z takes it back
 * and nothing reaches the disk until the file is saved. HIST-01.
 */
export function FileHistoryDialog({ isOpen, path, fileName, current, onRestore, onClose }: FileHistoryDialogProps) {
    const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setSnapshots(null);
        fileHistory.list(path).then(
            (list) => {
                if (cancelled) return;
                setSnapshots(list);
                setSelectedId(list.find((s) => s.content !== current)?.id ?? list[0]?.id ?? null);
            },
            () => { if (!cancelled) setSnapshots([]); },
        );
        return () => { cancelled = true; };
        // `current` only picks the first selection; the list doesn't depend on it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, path]);

    const selected = snapshots?.find((s) => s.id === selectedId) ?? null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            labelledBy="file-history-title"
            panelClassName="w-[min(920px,95vw)] h-[min(620px,90dvh)] flex flex-col"
        >
            <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                <h2 id="file-history-title" className="text-sm font-semibold text-[var(--text-primary)]">File history: {fileName}</h2>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Kept on this computer. Red is what the version had, green is what you've added since.</p>
            </div>

            {snapshots !== null && snapshots.length === 0 ? (
                <div className="flex-1 flex items-center justify-center px-8 text-center text-sm text-[var(--text-secondary)]">
                    No earlier versions yet. Paperling keeps a copy each time this file is opened or saved.
                </div>
            ) : (
                <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
                    <ul aria-label="Versions" className="sm:w-56 max-h-36 sm:max-h-none shrink-0 overflow-y-auto border-b sm:border-b-0 sm:border-r border-[var(--border)]">
                        {snapshots?.map((snapshot) => (
                            <li key={snapshot.id}>
                                <button
                                    type="button"
                                    aria-pressed={snapshot.id === selectedId}
                                    onClick={() => setSelectedId(snapshot.id ?? null)}
                                    className={`w-full px-3 py-2 text-left border-b border-[var(--border-subtle)] transition-colors ${snapshot.id === selectedId ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"}`}
                                >
                                    <span className="block text-xs text-[var(--text-primary)]">{whenFormat.format(snapshot.savedAt)}</span>
                                    <span className="block text-[11px] text-[var(--text-muted)]">
                                        {REASON_LABEL[snapshot.reason]} · {lineCount(snapshot.content)} lines{snapshot.content === current ? " · current" : ""}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="flex-1 min-w-0 min-h-0">
                        {selected && <VersionDiff original={selected.content} current={current} />}
                    </div>
                </div>
            )}

            <div className="px-4 py-3 border-t border-[var(--border)] shrink-0 flex items-center justify-end gap-2">
                {selected?.content === current && <span className="mr-auto text-xs text-[var(--text-muted)]">Same as your current text</span>}
                <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Close</button>
                <button
                    type="button"
                    disabled={!selected || selected.content === current}
                    onClick={() => { if (selected) onRestore(selected.content); }}
                    className="px-3 py-1.5 text-sm font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-text)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Restore this version
                </button>
            </div>
        </Modal>
    );
}
