import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSidePanel } from "../hooks/useSidePanel";
import { IS_MOBILE } from "../utils/platform";
import { openSystemFilePicker } from "../utils/nativePicker";
import { errMessage } from "../utils/errors";
import { saveTextFile } from "../utils/fileIO";
import { TabContextMenu } from "./TabContextMenu";
import { samePath } from "../utils/tabsModel";
import mascotCarry from "../assets/mascot/mascot-carry.png";
import mascotShrug from "../assets/mascot/mascot-shrug.png";

interface FileEntry {
    name: string;
    path: string;
    is_dir: boolean;
}

interface FileExplorerProps {
    isOpen: boolean;
    currentFilePath: string | null;
    /** Directory to browse when no file is open (the mobile notes root). */
    fallbackDirectory?: string | null;
    onFileSelect: (path: string) => void;
    onClose: () => void;
    /** A file or folder was renamed/moved to the trash (newPath null): the
     *  shell re-points open tabs. FILES-01. */
    onPathChanged?: (oldPath: string, newPath: string | null) => void;
    onNotify?: (message: string, type: "success" | "error" | "info") => void;
}

/** Inline name editor state: creating a note/folder, or renaming an entry. */
type NameEdit =
    | { mode: "note"; value: string }
    | { mode: "folder"; value: string }
    | { mode: "rename"; entry: FileEntry; value: string };

/** A note name gets `.md` unless it already has a note extension. */
export function withNoteExtension(name: string): string {
    return /\.(md|markdown|txt|text)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
}

export function FileExplorer({
    isOpen,
    currentFilePath,
    fallbackDirectory,
    onFileSelect,
    onClose,
    onPathChanged,
    onNotify,
}: FileExplorerProps) {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentViewDir, setCurrentViewDir] = useState<string | null>(null);
    const panelRef = useRef<HTMLElement>(null);
    const [nameEdit, setNameEdit] = useState<NameEdit | null>(null);
    const [menu, setMenu] = useState<{ entry: FileEntry; x: number; y: number } | null>(null);

    // Get directory from current file path
    const getDirectory = (filePath: string | null): string | null => {
        if (!filePath) return null;
        const normalized = filePath.replace(/\\/g, "/");
        const lastSlash = normalized.lastIndexOf("/");
        return lastSlash > 0 ? filePath.substring(0, lastSlash) : null;
    };

    // Initialize the view directory when opening the panel, and FOLLOW the
    // active note: switching tabs (or opening a note elsewhere) moves the
    // list to that note's folder and refreshes it, so a note just created by
    // Save As shows up too. It used to keep showing the folder it opened
    // with until the panel was closed and reopened. FILES-02. Manual
    // navigation (up / into folders) is kept until the active note changes.
    const activeDir = getDirectory(currentFilePath);
    useEffect(() => {
        if (isOpen) {
            // Falls back to the provided root (e.g. the mobile notes folder)
            // when there is no open file to derive a directory from.
            setCurrentViewDir((prev) => activeDir ?? prev ?? fallbackDirectory ?? null);
        } else {
            // Reset view when closed so it snaps back to the active file next time
            setCurrentViewDir(null);
        }
    }, [isOpen, activeDir, currentFilePath, fallbackDirectory]);

    // Load files whenever the view directory changes, and re-list the same
    // folder when the active note changes inside it (new/renamed files).
    useEffect(() => {
        if (isOpen && currentViewDir) {
            loadFiles(currentViewDir);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, currentViewDir, currentFilePath]);

    // Keep the active note's row in view after a switch.
    useEffect(() => {
        if (!isOpen) return;
        panelRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    }, [isOpen, currentFilePath, files]);

    // Refresh when the window regains focus — files may have been created or
    // deleted in another app while the explorer sat open. Mirrors App's
    // external-change-on-focus detection so the list never goes stale.
    useEffect(() => {
        if (!isOpen || !currentViewDir) return;
        const onFocus = () => loadFiles(currentViewDir);
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [isOpen, currentViewDir]);

    // Escape / focus behaviour for a docked, non-modal panel. PANEL-01.
    useSidePanel(panelRef, isOpen, onClose);

    // Which folder `files` currently lists. A refresh of the SAME folder keeps
    // the list on screen (no "Loading..." swap, no replayed entrance
    // animation), so window focus or a tab switch doesn't make it flash.
    // FILES-02.
    const listedDirRef = useRef<string | null>(null);
    const [animateList, setAnimateList] = useState(true);
    // Only the latest listing may land (quick folder/tab switches). FILES-02.
    const loadSeqRef = useRef(0);
    const loadFiles = async (directory: string) => {
        const seq = ++loadSeqRef.current;
        const sameFolder = listedDirRef.current === directory;
        if (!sameFolder) setIsLoading(true);
        setError(null);
        try {
            const entries = await invoke<FileEntry[]>("list_directory_files", {
                directory,
            });
            if (seq !== loadSeqRef.current) return;
            setAnimateList(!sameFolder);
            listedDirRef.current = directory;
            setFiles((prev) =>
                sameFolder && prev.length === entries.length && prev.every((f, i) => f.path === entries[i].path && f.is_dir === entries[i].is_dir)
                    ? prev
                    : entries,
            );
        } catch (err) {
            if (seq !== loadSeqRef.current) return;
            console.error("Failed to load directory:", err);
            setError("Failed to load files");
        } finally {
            if (seq === loadSeqRef.current) setIsLoading(false);
        }
    };

    const joinPath = (dir: string, name: string) => {
        const sep = dir.includes("\\") ? "\\" : "/";
        return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
    };

    // Commit the inline name editor: create a note / folder, or rename.
    // Enter commits, and so does the blur that follows when the field
    // unmounts — one commit per edit.
    const committingRef = useRef(false);
    const commitNameEdit = async () => {
        const edit = nameEdit;
        if (!edit || !currentViewDir || committingRef.current) return;
        committingRef.current = true;
        try {
            await runNameEdit(edit, currentViewDir);
        } finally {
            committingRef.current = false;
        }
    };
    const runNameEdit = async (edit: NameEdit, currentViewDir: string) => {
        const raw = edit.value.trim();
        if (!raw) {
            setNameEdit(null);
            return;
        }
        try {
            if (edit.mode === "note") {
                const name = withNoteExtension(raw);
                const path = joinPath(currentViewDir, name);
                // Never overwrite: an existing file is opened instead.
                const exists = await invoke("get_file_info", { path }).then(() => true, () => false);
                if (!exists) await saveTextFile(path, "");
                setNameEdit(null);
                await loadFiles(currentViewDir);
                onFileSelect(path);
                onClose();
                return;
            }
            if (edit.mode === "folder") {
                await invoke<string>("create_folder", { parent: currentViewDir, name: raw });
                setNameEdit(null);
                await loadFiles(currentViewDir);
                return;
            }
            const entry = edit.entry;
            const newName = entry.is_dir ? raw : withNoteExtension(raw);
            if (newName === entry.name) {
                setNameEdit(null);
                return;
            }
            const newPath = await invoke<string>("rename_path", { path: entry.path, newName });
            setNameEdit(null);
            onPathChanged?.(entry.path, newPath);
            await loadFiles(currentViewDir);
        } catch (err) {
            onNotify?.(errMessage(err) || "That didn't work", "error");
        }
    };

    const trashEntry = async (entry: FileEntry) => {
        if (!currentViewDir) return;
        const what = entry.is_dir ? `the folder "${entry.name}" and everything in it` : `"${entry.name}"`;
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const ok = await ask(`Move ${what} to the .trash folder? You can restore it from there.`, {
            title: "Delete",
            kind: "warning",
        }).catch(() => window.confirm(`Move ${what} to the .trash folder?`));
        if (!ok) return;
        try {
            await invoke<string>("trash_path", { path: entry.path });
            onPathChanged?.(entry.path, null);
            onNotify?.(`Moved "${entry.name}" to .trash`, "success");
            await loadFiles(currentViewDir);
        } catch (err) {
            onNotify?.(errMessage(err) || "Could not delete", "error");
        }
    };

    const handleEntryClick = (entry: FileEntry) => {
        if (entry.is_dir) {
            // Navigate into the folder
            setCurrentViewDir(entry.path);
        } else {
            // Select the file and close
            onFileSelect(entry.path);
            onClose();
        }
    };
    
    const parentDir = currentViewDir ? getDirectory(currentViewDir) : null;

    const handleGoUp = () => {
        if (parentDir) setCurrentViewDir(parentDir);
    };

    // System document picker (mobile): the in-app browser is rooted where the
    // Rust file commands can read — on Android that's the app-private notes
    // area — so "go up" dead-ends in app data. Opening a note from anywhere
    // else on the phone goes through the SAF bridge (see nativePicker.ts).
    const handleOpenFromDevice = () => {
        if (!openSystemFilePicker()) {
            setError("System file picker isn't available in this build");
        }
    };

    const directoryName = currentViewDir
        ? currentViewDir.replace(/\\/g, "/").split("/").pop()
        : "Files";

    return (
        <aside
            ref={panelRef}
            role="navigation"
            aria-label="File explorer"
            tabIndex={-1}
            data-panel="left"
            className={`fixed left-0 top-12 bottom-7 w-72 bg-[var(--bg-secondary)] border-r border-[var(--border)] z-50 shadow-2xl flex flex-col overflow-hidden transition-transform duration-200 ease-out ${
                isOpen ? "translate-x-0" : "-translate-x-full"
            }`}
        >
            {/* Header */}
            <div className="h-10 shrink-0 px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select">
                    <button
                        onClick={handleGoUp}
                        disabled={!parentDir}
                        aria-label="Go up one folder"
                        title="Go up"
                        className="btn-press flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors mr-1 disabled:opacity-40 disabled:pointer-events-none"
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            arrow_upward
                        </span>
                    </button>
                    <span className="material-symbols-outlined text-[18px]">
                        folder_open
                    </span>
                    <span className="truncate max-w-[140px]" title={directoryName}>{directoryName}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setNameEdit({ mode: "note", value: "" })}
                        disabled={!currentViewDir}
                        aria-label="New note in this folder"
                        title="New note"
                        className="btn-press flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[18px]">note_add</span>
                    </button>
                    <button
                        onClick={() => setNameEdit({ mode: "folder", value: "" })}
                        disabled={!currentViewDir}
                        aria-label="New folder"
                        title="New folder"
                        className="btn-press flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[18px]">create_new_folder</span>
                    </button>
                    <button
                        onClick={() => currentViewDir && loadFiles(currentViewDir)}
                        aria-label="Refresh file list"
                        title="Refresh"
                        className="btn-press flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            refresh
                        </span>
                    </button>
                    <button
                        onClick={onClose}
                        aria-label="Close file explorer"
                        className="btn-press flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            close
                        </span>
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {/* System document picker (mobile). A labeled row, not a header
                    icon — on-device testing showed an ambiguous icon got
                    confused with the folder browser itself. The in-app list is
                    rooted where the Rust file commands can read (the notes
                    folder / the open file's directory); this reaches the rest
                    of the device through the SAF bridge. */}
                {IS_MOBILE && (
                    <button
                        onClick={handleOpenFromDevice}
                        className="btn-press w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border-b border-[var(--border-subtle)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">drive_file_move</span>
                        Open from device…
                    </button>
                )}
                {nameEdit && nameEdit.mode !== "rename" && (
                    <NameInput
                        icon={nameEdit.mode === "folder" ? "folder" : "description"}
                        value={nameEdit.value}
                        placeholder={nameEdit.mode === "folder" ? "Folder name" : "Note name"}
                        onChange={(value) => setNameEdit({ ...nameEdit, value })}
                        onCommit={commitNameEdit}
                        onCancel={() => setNameEdit(null)}
                    />
                )}
                {isLoading ? (
                    <div className="flex items-center justify-center h-32 text-[var(--text-secondary)] text-sm">
                        Loading...
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm" role="alert">
                        <img src={mascotShrug} alt="" aria-hidden="true" draggable={false} className="w-20 h-20 object-contain select-none opacity-90" />
                        <span className="text-[var(--danger)]">{error}</span>
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-[var(--text-secondary)]">
                        <img src={mascotCarry} alt="" aria-hidden="true" draggable={false} className="w-20 h-20 object-contain select-none opacity-90" />
                        <span>Folder is empty</span>
                    </div>
                ) : (
                    <ul className="py-2" role="listbox" aria-label="Files and folders">
                        {files.map((file, index) => {
                            const isActive = !file.is_dir && samePath(file.path, currentFilePath);
                            if (nameEdit?.mode === "rename" && nameEdit.entry.path === file.path) {
                                return (
                                    <li key={file.path}>
                                        <NameInput
                                            icon={file.is_dir ? "folder" : "description"}
                                            value={nameEdit.value}
                                            placeholder="New name"
                                            onChange={(value) => setNameEdit({ ...nameEdit, value })}
                                            onCommit={commitNameEdit}
                                            onCancel={() => setNameEdit(null)}
                                        />
                                    </li>
                                );
                            }
                            return (
                                <li
                                    key={file.path}
                                    className={`group/entry relative ${animateList ? "stagger-item" : ""}`}
                                    style={animateList ? { animationDelay: `${Math.min(index, 15) * 0.03}s` } : undefined}
                                >
                                    <button
                                        onClick={() => handleEntryClick(file)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            setMenu({ entry: file, x: e.clientX, y: e.clientY });
                                        }}
                                        onKeyDown={(e) => {
                                            // F2 renames, Delete trashes — the usual file-manager keys.
                                            if (e.key === "F2") { e.preventDefault(); setNameEdit({ mode: "rename", entry: file, value: file.name }); }
                                            else if (e.key === "Delete") { e.preventDefault(); void trashEntry(file); }
                                        }}
                                        role="option"
                                        aria-selected={isActive}
                                        className={`btn-press w-full pl-4 pr-9 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                                            isActive
                                                ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            {file.is_dir ? "folder" : "description"}
                                        </span>
                                        <span className="truncate">{file.name}</span>
                                    </button>
                                    <button
                                        aria-label={`More actions for ${file.name}`}
                                        title="More"
                                        onClick={(e) => {
                                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            setMenu({ entry: file, x: r.left, y: r.bottom });
                                        }}
                                        className={`absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded ${IS_MOBILE ? "opacity-100" : "opacity-0 group-hover/entry:opacity-100 focus:opacity-100"} ${isActive ? "text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">more_horiz</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            {menu && (
                <TabContextMenu
                    x={menu.x}
                    y={menu.y}
                    onClose={() => setMenu(null)}
                    actions={[
                        ...(!menu.entry.is_dir
                            ? [{ label: "Open", icon: "open_in_new", onClick: () => handleEntryClick(menu.entry) }]
                            : []),
                        {
                            label: "Rename",
                            icon: "edit",
                            onClick: () => setNameEdit({ mode: "rename", entry: menu.entry, value: menu.entry.name }),
                        },
                        {
                            label: "Move to trash",
                            icon: "delete",
                            dividerBefore: true,
                            onClick: () => void trashEntry(menu.entry),
                        },
                    ]}
                />
            )}
        </aside>
    );
}

/** Inline name field for new notes/folders and renames: Enter commits,
 *  Escape cancels without closing the explorer, blur commits. */
function NameInput({
    icon,
    value,
    placeholder,
    onChange,
    onCommit,
    onCancel,
}: {
    icon: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        // Select the stem so typing replaces the name but keeps ".md".
        const dot = el.value.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }, []);
    return (
        <div className="px-3 py-1.5 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[var(--text-secondary)]">{icon}</span>
            <input
                ref={ref}
                value={value}
                placeholder={placeholder}
                aria-label={placeholder}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); onCommit(); }
                    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onCancel(); }
                }}
                onBlur={onCommit}
                className="flex-1 min-w-0 px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--accent)] rounded-[var(--radius-sm)] text-[var(--text-primary)] outline-none"
            />
        </div>
    );
}
