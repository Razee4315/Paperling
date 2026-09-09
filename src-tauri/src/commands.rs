use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::ipc::Response;
use thiserror::Error;

/// Hard ceiling on text-file content. 50 MB easily covers any sane markdown
/// document while keeping a single careless `read_file` from holding hundreds
/// of MB of UTF-8 in webview memory. Above this we fail fast with a clear
/// error so the user sees a toast instead of a frozen editor.
const MAX_TEXT_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Hard ceiling on a pasted image. Markdown editors get pasted screenshots
/// regularly; 25 MB is generous (a 4K PNG screenshot is ~5–10 MB) but blocks a
/// runaway clipboard payload from filling the user's disk.
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

/// Whitelist of allowed image extensions for `save_image`. Anything else is
/// refused — prevents a malicious caller from writing an arbitrary `.exe` /
/// `.dll` / `.lnk` into the user's documents folder under the cover of an
/// image-paste flow.
const ALLOWED_IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/// Error type for file operation commands
#[derive(Debug, Error)]
pub enum CommandError {
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Failed to read file: {0}")]
    ReadError(String),
    #[error("Failed to write file: {0}")]
    WriteError(String),
    #[error("File too large: {0}")]
    TooLarge(String),
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// File metadata returned when opening a file
#[derive(Debug, Serialize, Deserialize)]
pub struct FileData {
    pub path: String,
    pub name: String,
    pub content: String,
    pub size: u64,
    pub line_count: usize,
    /// Last-modified time, ms since the Unix epoch. Lets the frontend detect
    /// external edits (file changed on disk while open) on window focus.
    pub modified: u64,
}

/// Line-ending convention of a file.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Eol {
    Lf,
    Crlf,
}

/// Detect a file's dominant line ending by reading just its first chunk and
/// inspecting the first newline. `\r\n` → Crlf, a bare `\n` → Lf, and a file with
/// no newline at all (or that can't be read) falls back to Lf. Cheap: we never
/// read more than the first 64 KB regardless of file size. EOL-01.
async fn detect_file_eol(path: &str) -> Eol {
    use tokio::io::AsyncReadExt;
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return Eol::Lf,
    };
    let mut buf = vec![0u8; 64 * 1024];
    let n = match file.read(&mut buf).await {
        Ok(n) => n,
        Err(_) => return Eol::Lf,
    };
    for i in 0..n {
        if buf[i] == b'\n' {
            return if i > 0 && buf[i - 1] == b'\r' {
                Eol::Crlf
            } else {
                Eol::Lf
            };
        }
    }
    Eol::Lf
}

/// Re-apply a file's line ending to editor content (which CodeMirror always
/// normalises to `\n`). We first collapse any stray `\r\n`/`\r` to `\n` so a
/// CRLF target can't produce `\r\r\n`. EOL-01.
fn apply_eol(content: &str, eol: Eol) -> String {
    if eol == Eol::Lf && !content.contains('\r') {
        return content.to_string();
    }
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    match eol {
        Eol::Lf => normalized,
        Eol::Crlf => normalized.replace('\n', "\r\n"),
    }
}

/// Last-modified time in ms since the Unix epoch (0 when unavailable).
fn mtime_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ===== Mobile path containment (SECURITY-02) =====
//
// On the phone every path the frontend legitimately holds comes from one of
// two app-private roots: the notes folder under the app data dir, or the
// "open with" / document-picker copies under the cache dir. Enforcing that
// boundary HERE (Rust — the webview is not a trust boundary) keeps a
// compromised webview from aiming read_file / save_file at arbitrary
// locations. Desktop is a full-capability editor and deliberately has no such
// restriction; there the boundary is the OS user account (documented accepted
// risk).
//
// Canonicalization resolves symlinks before the containment check, so a
// symlink planted inside the notes folder can't smuggle a path out either.

/// The canonical form of `path`, when it resolves inside one of the app's
/// private roots; an error string describing the violation otherwise.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn ensure_mobile_path_allowed(
    app: &tauri::AppHandle,
    path: &std::path::Path,
) -> Result<PathBuf, String> {
    use tauri::Manager;

    // Resolve the deepest ancestor that exists: the file itself when present,
    // otherwise its parent directory (save targets are commonly new files).
    let resolved = if path.exists() {
        std::fs::canonicalize(path)
    } else {
        let parent = path.parent().ok_or("Invalid path")?;
        let name = path.file_name().ok_or("Invalid path")?;
        std::fs::canonicalize(parent).map(|p| p.join(name))
    }
    .map_err(|e| e.to_string())?;

    for root in [app.path().app_data_dir(), app.path().app_cache_dir()] {
        let root = root.map_err(|e| e.to_string())?;
        if let Ok(canon_root) = std::fs::canonicalize(&root) {
            if resolved.starts_with(&canon_root) {
                return Ok(resolved);
            }
        }
    }
    Err("Path is outside the app's private storage".to_string())
}

/// Read a markdown file from disk. Mobile builds first confine `path` to the
/// app's private storage (SECURITY-02); desktop accepts any path (by design).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn read_file(app: tauri::AppHandle, path: String) -> Result<FileData, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&path)).map_err(CommandError::ReadError)?;
    read_file_inner(path).await
}

/// The read_file body, app-handle-free so the unit tests can drive it without
/// a Tauri harness.
async fn read_file_inner(path: String) -> Result<FileData, CommandError> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(CommandError::FileNotFound(path));
    }

    // Stat first so we can refuse oversized files before pulling them into
    // memory. Without this, opening a multi-GB log accidentally renamed `.md`
    // would freeze the UI thread for tens of seconds.
    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;

    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(CommandError::TooLarge(format!(
            "File is {} MB; maximum is {} MB",
            metadata.len() / (1024 * 1024),
            MAX_TEXT_FILE_BYTES / (1024 * 1024),
        )));
    }

    let raw = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;

    // Hand the frontend LF-only content. CodeMirror normalises every line
    // break to `\n` anyway, so serving CRLF verbatim made the editor's first
    // doc-sync "change" the text and mark a freshly opened file dirty. The
    // on-disk convention is not lost: `save_file` re-detects it from the file
    // itself and writes CRLF back. EOL-01.
    let content = apply_eol(&raw, Eol::Lf);

    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    let line_count = content.lines().count();

    Ok(FileData {
        path,
        name,
        content,
        size: metadata.len(),
        line_count,
        modified: mtime_ms(&metadata),
    })
}

/// Save content to a file. Returns the new last-modified time (ms since epoch)
/// so the frontend can track external changes without a second stat call.
///
/// The write is ATOMIC: content goes to a temp file in the same directory,
/// which is then renamed over the target. A crash or power loss mid-write can
/// no longer truncate the user's document — the worst case is a leftover
/// `.paperling-tmp` file. (std/tokio rename replaces the target on Windows
/// via MoveFileEx + MOVEFILE_REPLACE_EXISTING, and is atomic on POSIX.)
///
/// Mobile builds first confine `path` to the app's private storage
/// (SECURITY-02); desktop accepts any path (by design).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<u64, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&path))
        .map_err(CommandError::WriteError)?;
    save_file_inner(path, content).await
}

/// The save_file body, app-handle-free so the unit tests can drive it without
/// a Tauri harness.
async fn save_file_inner(path: String, content: String) -> Result<u64, CommandError> {
    // Mirror the read-side limit. Refusing to write a >50 MB markdown file
    // protects the user from accidentally truncating something pasted from
    // another tool, and matches what `read_file` would refuse to load back.
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(CommandError::TooLarge(format!(
            "Document is {} MB; maximum is {} MB",
            content.len() / (1024 * 1024),
            MAX_TEXT_FILE_BYTES / (1024 * 1024),
        )));
    }

    // Preserve the on-disk file's line ending. The editor hands us `\n`-only
    // content; if the existing file uses CRLF we write CRLF back, so opening and
    // saving a Windows file doesn't rewrite every line and produce a noisy diff.
    // A brand-new file (save-as / new note) has no existing EOL, so we keep the
    // editor's LF. EOL-01.
    let file_exists = PathBuf::from(&path).exists();
    let content = if file_exists {
        apply_eol(&content, detect_file_eol(&path).await)
    } else {
        content
    };

    // Same directory as the target so the rename never crosses a filesystem
    // boundary (cross-device renames aren't atomic and can fail outright).
    let tmp = format!("{}.{}.paperling-tmp", path, std::process::id());

    // Write, then fsync BEFORE the rename. Without the sync, a crash right after
    // the rename can leave the (renamed) file present but empty/partial on disk,
    // because the directory entry can reach disk before the data does. An editor
    // whose whole job is not losing words should pay this cost. SAVE-02.
    {
        use tokio::io::AsyncWriteExt;
        let mut f = match tokio::fs::File::create(&tmp).await {
            Ok(f) => f,
            Err(e) => return Err(CommandError::WriteError(e.to_string())),
        };
        if let Err(e) = f.write_all(content.as_bytes()).await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CommandError::WriteError(e.to_string()));
        }
        if let Err(e) = f.sync_all().await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CommandError::WriteError(e.to_string()));
        }
    }

    if let Err(e) = tokio::fs::rename(&tmp, &path).await {
        // Don't leave the temp file behind on failure.
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(CommandError::WriteError(e.to_string()));
    }

    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    Ok(mtime_ms(&metadata))
}

/// Get just the file info without content (for status bar). Mobile builds
/// confine `path` to the app's private storage (SECURITY-02).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn get_file_info(app: tauri::AppHandle, path: String) -> Result<FileInfo, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&path))
        .map_err(CommandError::ReadError)?;

    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(CommandError::FileNotFound(path));
    }

    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;

    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    Ok(FileInfo {
        path,
        name,
        size: metadata.len(),
        modified: mtime_ms(&metadata),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Last-modified time, ms since the Unix epoch.
    pub modified: u64,
}

/// File entry for directory listing
#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List all markdown files in a directory. Mobile builds confine `directory`
/// to the app's private storage (SECURITY-02).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn list_directory_files(
    app: tauri::AppHandle,
    directory: String,
) -> Result<Vec<FileEntry>, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&directory))
        .map_err(CommandError::ReadError)?;

    let dir_path = PathBuf::from(&directory);

    if !dir_path.exists() {
        return Err(CommandError::FileNotFound(directory));
    }

    if !dir_path.is_dir() {
        return Err(CommandError::ReadError(
            "Path is not a directory".to_string(),
        ));
    }

    let mut entries = Vec::new();

    let mut read_dir = tokio::fs::read_dir(&dir_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?
    {
        let path = entry.path();

        let entry_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Skip hidden files and directories (starting with a dot)
        if entry_name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            // Add directories
            entries.push(FileEntry {
                name: entry_name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
            });
        } else if path.is_file() {
            // Only include .md files
            if let Some(ext) = path.extension() {
                if ext == "md" || ext == "markdown" {
                    entries.push(FileEntry {
                        name: entry_name,
                        path: path.to_string_lossy().to_string(),
                        is_dir: false,
                    });
                }
            }
        }
    }

    // Sort: Directories first, then alphabetically case-insensitive
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// A single matching line within a file.
#[derive(Debug, Serialize)]
pub struct SearchMatch {
    /// 1-based line number.
    pub line: u32,
    /// The trimmed (and possibly truncated) line text.
    pub text: String,
}

/// All matches for one file.
#[derive(Debug, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub matches: Vec<SearchMatch>,
}

// Bounds so a search over a huge or pathological folder stays responsive and
// can't balloon webview memory. Hit caps degrade gracefully (partial results).
const SEARCH_MAX_FILES: usize = 5000; // markdown files scanned
const SEARCH_MAX_RESULTS: usize = 300; // files returned with at least one match
const SEARCH_MAX_MATCHES_PER_FILE: usize = 50;
const SEARCH_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024; // skip very large files
const SEARCH_SNIPPET_CHARS: usize = 240; // truncate long matching lines

/// Search the text of every markdown file under `directory` (recursively) for
/// `query`. Case-insensitive unless `case_sensitive`. Returns per-file matches
/// with 1-based line numbers so the UI can jump straight to a hit. Skips hidden
/// directories plus `node_modules` / `target`, and is bounded by the caps above.
/// Mobile builds confine `directory` to the app's private storage (SECURITY-02).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn search_files(
    app: tauri::AppHandle,
    directory: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<FileSearchResult>, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&directory))
        .map_err(CommandError::ReadError)?;

    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root = PathBuf::from(&directory);
    if !root.is_dir() {
        return Err(CommandError::FileNotFound(directory));
    }

    // The walk is blocking I/O; keep it off the async runtime's worker threads.
    tokio::task::spawn_blocking(move || Ok(search_markdown_tree(root, &q, case_sensitive)))
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?
}

/// Find markdown files under `directory` that link to `target_file` using
/// either Paperling wikilinks (`[[Note]]`) or relative markdown links
/// (`[label](Note.md)`). Both paths are canonicalized before the scan so the
/// command cannot be used to inspect files outside the open document folder.
/// Mobile builds additionally confine `directory` to the app's private
/// storage (SECURITY-02).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn find_backlinks(
    app: tauri::AppHandle,
    directory: String,
    target_file: String,
) -> Result<Vec<FileSearchResult>, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&directory))
        .map_err(CommandError::ReadError)?;

    let root = tokio::fs::canonicalize(&directory)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    if !root.is_dir() {
        return Err(CommandError::ReadError(
            "Backlink search root is not a directory".to_string(),
        ));
    }

    let target = tokio::fs::canonicalize(&target_file)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    if !target.is_file() || !target.starts_with(&root) {
        return Err(CommandError::ReadError(
            "Backlink target must be inside the search folder".to_string(),
        ));
    }

    tokio::task::spawn_blocking(move || Ok(find_backlinks_in_tree(root, target)))
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?
}

/// Synchronous, bounded recursive search used by `search_files`. Pulled out so
/// it can be unit-tested without a Tauri/async harness. `query` is assumed
/// non-empty and already trimmed.
fn search_markdown_tree(root: PathBuf, query: &str, case_sensitive: bool) -> Vec<FileSearchResult> {
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut files_scanned = 0usize;
    let mut stack = vec![root];

    while let Some(dir) = stack.pop() {
        if results.len() >= SEARCH_MAX_RESULTS || files_scanned >= SEARCH_MAX_FILES {
            break;
        }
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // unreadable dir — skip, don't fail the whole search
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name == "node_modules" || name == "target" {
                        continue;
                    }
                }
                stack.push(path);
                continue;
            }
            let is_md = path
                .extension()
                .map(|e| e == "md" || e == "markdown")
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            files_scanned += 1;
            if files_scanned > SEARCH_MAX_FILES {
                break;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.len() > SEARCH_MAX_FILE_BYTES {
                    continue;
                }
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue, // binary / non-UTF8 — skip
            };
            let mut matches = Vec::new();
            for (i, line) in content.lines().enumerate() {
                let haystack = if case_sensitive {
                    line.to_string()
                } else {
                    line.to_lowercase()
                };
                if haystack.contains(&needle) {
                    let trimmed = line.trim();
                    // Char-boundary-safe truncation (byte slicing could panic on
                    // multibyte UTF-8).
                    let text = if trimmed.chars().count() > SEARCH_SNIPPET_CHARS {
                        let mut s: String = trimmed.chars().take(SEARCH_SNIPPET_CHARS).collect();
                        s.push('…');
                        s
                    } else {
                        trimmed.to_string()
                    };
                    matches.push(SearchMatch {
                        line: (i + 1) as u32,
                        text,
                    });
                    if matches.len() >= SEARCH_MAX_MATCHES_PER_FILE {
                        break;
                    }
                }
            }
            if !matches.is_empty() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string();
                results.push(FileSearchResult {
                    path: path.to_string_lossy().to_string(),
                    name,
                    matches,
                });
                if results.len() >= SEARCH_MAX_RESULTS {
                    break;
                }
            }
        }
    }

    results.sort_by_key(|r| r.name.to_lowercase());
    results
}

/// Bounded recursive backlink scan. This deliberately shares the same caps and
/// ignored-directory rules as global search so opening the panel cannot turn a
/// large workspace into an unbounded read.
fn find_backlinks_in_tree(root: PathBuf, target: PathBuf) -> Vec<FileSearchResult> {
    let target_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let target_stem = target
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let target_parent = target.parent().map(PathBuf::from);

    let mut results = Vec::new();
    let mut files_scanned = 0usize;
    let mut stack = vec![root];

    while let Some(dir) = stack.pop() {
        if results.len() >= SEARCH_MAX_RESULTS || files_scanned >= SEARCH_MAX_FILES {
            break;
        }
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(read_dir) => read_dir,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name == "node_modules" || name == "target" {
                        continue;
                    }
                }
                stack.push(path);
                continue;
            }
            let is_markdown = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| {
                    extension.eq_ignore_ascii_case("md")
                        || extension.eq_ignore_ascii_case("markdown")
                })
                .unwrap_or(false);
            if !is_markdown || path == target {
                continue;
            }

            files_scanned += 1;
            if files_scanned > SEARCH_MAX_FILES {
                break;
            }
            if entry
                .metadata()
                .map(|metadata| metadata.len() > SEARCH_MAX_FILE_BYTES)
                .unwrap_or(true)
            {
                continue;
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };

            let mut matches = Vec::new();
            for (index, line) in content.lines().enumerate() {
                if line_links_to_target(
                    line,
                    &path,
                    &target,
                    target_parent.as_deref(),
                    &target_name,
                    &target_stem,
                ) {
                    let trimmed = line.trim();
                    let text = if trimmed.chars().count() > SEARCH_SNIPPET_CHARS {
                        let mut snippet: String =
                            trimmed.chars().take(SEARCH_SNIPPET_CHARS).collect();
                        snippet.push('…');
                        snippet
                    } else {
                        trimmed.to_string()
                    };
                    matches.push(SearchMatch {
                        line: (index + 1) as u32,
                        text,
                    });
                    if matches.len() >= SEARCH_MAX_MATCHES_PER_FILE {
                        break;
                    }
                }
            }
            if !matches.is_empty() {
                results.push(FileSearchResult {
                    name: path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    matches,
                });
                if results.len() >= SEARCH_MAX_RESULTS {
                    break;
                }
            }
        }
    }

    results.sort_by_key(|result| result.name.to_ascii_lowercase());
    results
}

fn line_links_to_target(
    line: &str,
    source: &std::path::Path,
    target: &std::path::Path,
    target_parent: Option<&std::path::Path>,
    target_name: &str,
    target_stem: &str,
) -> bool {
    // Wikilinks resolve beside their source file in Paperling. Support aliases
    // and heading fragments while avoiding prefix matches such as [[Notebook]].
    let mut wikilink_rest = line;
    while let Some(start) = wikilink_rest.find("[[") {
        wikilink_rest = &wikilink_rest[start + 2..];
        let Some(end) = wikilink_rest.find("]]") else {
            break;
        };
        let raw_target = wikilink_rest[..end]
            .split('|')
            .next()
            .unwrap_or_default()
            .split('#')
            .next()
            .unwrap_or_default()
            .trim();
        let normalized = raw_target.to_ascii_lowercase();
        if !raw_target.contains('/')
            && !raw_target.contains('\\')
            && source.parent() == target_parent
            && (normalized == target_name || normalized == target_stem)
        {
            return true;
        }
        wikilink_rest = &wikilink_rest[end + 2..];
    }

    // Markdown links may point through subdirectories or `..`, so resolve each
    // candidate from the source file and compare canonical paths. Images are
    // excluded (`![alt](...)`) because they are embeds, not note backlinks.
    let mut markdown_rest = line;
    while let Some(start) = markdown_rest.find("](") {
        let prefix = &markdown_rest[..start];
        let is_image = prefix
            .rfind('[')
            .is_some_and(|open| open > 0 && prefix.as_bytes()[open - 1] == b'!');
        markdown_rest = &markdown_rest[start + 2..];
        let Some(end) = markdown_rest.find(')') else {
            break;
        };
        if !is_image {
            let raw_destination = markdown_rest[..end].trim();
            let wrapped_destination = raw_destination
                .strip_prefix('<')
                .and_then(|value| value.strip_suffix('>'));
            let destination = wrapped_destination.unwrap_or_else(|| {
                raw_destination
                    .split_whitespace()
                    .next()
                    .unwrap_or_default()
            });
            let destination = destination.split(['#', '?']).next().unwrap_or_default();
            let is_markdown = std::path::Path::new(destination)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| {
                    extension.eq_ignore_ascii_case("md")
                        || extension.eq_ignore_ascii_case("markdown")
                })
                .unwrap_or(false);
            if is_markdown && !destination.contains("://") {
                if let Some(parent) = source.parent() {
                    if let Ok(resolved) = std::fs::canonicalize(parent.join(destination)) {
                        if resolved == target {
                            return true;
                        }
                    }
                }
            }
        }
        markdown_rest = &markdown_rest[end + 1..];
    }

    false
}

/// Strip any path components from a filename so it can't traverse outside the
/// images directory. Rejects empty / dot-only names and names with separators,
/// drive letters, or NUL bytes. Also enforces an extension whitelist so the
/// "image paste" command can't be used to drop a `.exe` / `.dll` / `.lnk`
/// into the user's documents folder under cover of a markdown image flow.
/// Returns just the basename when valid.
fn sanitize_image_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(CommandError::WriteError(
            "Invalid image filename".to_string(),
        ));
    }
    if trimmed.contains('\0') {
        return Err(CommandError::WriteError(
            "Invalid image filename".to_string(),
        ));
    }
    // Reject both path separators explicitly, on every platform. On Unix a
    // backslash is a legal filename character, so the Path::file_name() check
    // below would let a Windows-style "..\foo.png" traversal payload through;
    // rejecting separators up front keeps the behavior identical cross-platform.
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(CommandError::WriteError(
            "Invalid image filename".to_string(),
        ));
    }
    // Reject any path-like input — only a bare basename is allowed.
    let basename = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| CommandError::WriteError("Invalid image filename".to_string()))?;
    if basename != trimmed {
        return Err(CommandError::WriteError(
            "Invalid image filename".to_string(),
        ));
    }
    // Enforce extension whitelist (case-insensitive). A name with no extension,
    // or one whose extension isn't a known image type, is rejected — this is
    // a defense-in-depth check on top of the basename validation above.
    let ext = std::path::Path::new(basename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext {
        Some(e) if ALLOWED_IMAGE_EXTS.contains(&e.as_str()) => Ok(basename.to_string()),
        _ => Err(CommandError::WriteError(
            "Image filename must end in .png/.jpg/.jpeg/.gif/.webp/.bmp/.svg".to_string(),
        )),
    }
}

/// Save image data to a file in the images subdirectory
/// Returns the relative path to use in markdown. Mobile builds confine the
/// document's directory to the app's private storage BEFORE creating the
/// images subfolder, so no directories are ever created outside it
/// (SECURITY-02).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn save_image(
    app: tauri::AppHandle,
    md_file_path: String,
    image_data: Vec<u8>,
    image_name: String,
) -> Result<String, CommandError> {
    if image_data.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::TooLarge(format!(
            "Image is {} MB; maximum is {} MB",
            image_data.len() / (1024 * 1024),
            MAX_IMAGE_BYTES / (1024 * 1024),
        )));
    }
    let safe_name = sanitize_image_name(&image_name)?;
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&md_file_path))
        .map_err(CommandError::WriteError)?;
    let md_path = PathBuf::from(&md_file_path);

    // Get the directory containing the markdown file
    let parent_dir = md_path
        .parent()
        .ok_or_else(|| CommandError::WriteError("Cannot determine parent directory".to_string()))?;

    // Create images subdirectory
    let images_dir = parent_dir.join("images");
    if !images_dir.exists() {
        tokio::fs::create_dir_all(&images_dir).await.map_err(|e| {
            CommandError::WriteError(format!("Failed to create images directory: {}", e))
        })?;
    }

    // Full path for the image (basename only, no traversal possible).
    let image_path = images_dir.join(&safe_name);

    // Write the image data
    tokio::fs::write(&image_path, &image_data)
        .await
        .map_err(|e| CommandError::WriteError(format!("Failed to write image: {}", e)))?;

    // Return relative path for markdown (./images/filename.png)
    Ok(format!("./images/{}", safe_name))
}

/// Reject a relative image path that tries to escape the document folder or name
/// an absolute location. Mirrors the front-end `isUnsafeRelativePath` guard so the
/// boundary is enforced in Rust too — the front-end is not a trust boundary.
fn validate_rel_path(rel: &str) -> Result<(), CommandError> {
    if rel.is_empty() || rel.contains('\0') {
        return Err(CommandError::ReadError("Invalid image path".to_string()));
    }
    // Reject Windows drive-letter prefixes (e.g. "C:/...") explicitly — on a
    // non-Windows host they don't parse as an absolute Prefix component, so the
    // checks below would miss them.
    let b = rel.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return Err(CommandError::ReadError(
            "Image path must be relative".to_string(),
        ));
    }
    let p = std::path::Path::new(rel);
    if p.is_absolute() {
        return Err(CommandError::ReadError(
            "Image path must be relative".to_string(),
        ));
    }
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(CommandError::ReadError(
                    "Image path escapes the document folder".to_string(),
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Read an image that lives under `base_dir` (the open markdown file's directory)
/// and return its raw bytes. Replaces the front-end's `plugin-fs` readFile so we
/// no longer need a broad `fs:allow-read **` capability (SECURITY-02). Validates
/// the relative path, enforces the image size cap, and canonicalizes both base
/// and target to guarantee the resolved file is still inside `base_dir` — which
/// also blocks symlinked escapes (SECURITY-05). Mobile builds additionally
/// confine `base_dir` itself to the app's private storage, so even a
/// hand-crafted IPC call can't aim the base at a folder outside the sandbox.
/// Bytes are returned via `tauri::ipc::Response` so large images skip
/// JSON-array serialization.
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(unused_variables))]
#[tauri::command]
pub async fn read_image_file(
    app: tauri::AppHandle,
    base_dir: String,
    rel_path: String,
) -> Result<Response, CommandError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    ensure_mobile_path_allowed(&app, std::path::Path::new(&base_dir))
        .map_err(CommandError::ReadError)?;

    validate_rel_path(&rel_path)?;
    let base = PathBuf::from(&base_dir);
    let full = base.join(&rel_path);

    let metadata = tokio::fs::metadata(&full)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err(CommandError::TooLarge(format!(
            "Image is {} MB; maximum is {} MB",
            metadata.len() / (1024 * 1024),
            MAX_IMAGE_BYTES / (1024 * 1024),
        )));
    }

    // canonicalize() resolves symlinks; the containment check then guarantees the
    // real file is inside the document folder.
    let canon_base = tokio::fs::canonicalize(&base)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    let canon_full = tokio::fs::canonicalize(&full)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    if !canon_full.starts_with(&canon_base) {
        return Err(CommandError::ReadError(
            "Image path escapes the document folder".to_string(),
        ));
    }

    let data = tokio::fs::read(&canon_full)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    Ok(Response::new(data))
}

// ===== AI API key — OS keychain (SECURITY-01) =====
//
// Desktop: stored in the platform credential store instead of plaintext
// localStorage. Mobile (Android/iOS): keyring has no backend there, so the key
// lives in an app-private data file with an atomic temp+rename write — inside
// the app sandbox this is the same threat class as the localStorage the app
// already uses for every non-secret setting.
//
// The front end keeps endpoint + model in localStorage (non-secret) and routes
// only the key through these commands, with a localStorage fallback on the JS
// side when no keychain is available (e.g. a headless Linux box).
//
// NOTE: the service name stays "marklite" (the app's pre-rename name) on
// purpose — changing it would orphan every existing user's stored API key.
// Same reasoning as the bundle identifier in tauri.conf.json.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const AI_KEY_SERVICE: &str = "marklite";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const AI_KEY_ACCOUNT: &str = "ai-api-key";

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn get_ai_key() -> Result<String, String> {
    let entry = keyring::Entry::new(AI_KEY_SERVICE, AI_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(p),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn set_ai_key(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(AI_KEY_SERVICE, AI_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    if key.is_empty() {
        // Empty key == "clear it". A missing entry is already the desired state.
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(&key).map_err(|e| e.to_string())
    }
}

// --- Mobile variants: app-private file, no keyring. Same JS contract. ---

#[cfg(any(target_os = "android", target_os = "ios"))]
fn mobile_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai-key"))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn get_ai_key(app: tauri::AppHandle) -> Result<String, String> {
    let path = mobile_key_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(key) => Ok(key.trim().to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn set_ai_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = mobile_key_path(&app)?;
    if key.is_empty() {
        // Empty key == "clear it". A missing file is already the desired state.
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    // Atomic write (SAVE-02 discipline): a kill mid-write must never leave a
    // truncated secret file — temp + rename keeps the previous key readable.
    let tmp = path.with_extension("paperling-tmp");
    std::fs::write(&tmp, &key).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ===== "Open with" handoff (Android intent → frontend) =====
//
// The Kotlin side (CI patch: scripts/patch-android-open-with.mjs) copies a
// file opened from another app into the app cache and writes incoming.json
// there. The frontend pulls it once through this command — the marker is
// deleted on read, mirroring get_cli_file's take semantics so a webview
// reload doesn't re-open the same file.

/// The pending intent-opened file handed over by the Android side.
/// Deserialize: the command also parses the incoming.json marker into it.
#[derive(Debug, Serialize, Deserialize)]
pub struct IncomingFile {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub async fn get_incoming_file(app: tauri::AppHandle) -> Result<Option<IncomingFile>, String> {
    use tauri::Manager;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Could not resolve the cache dir: {e}"))?;
    let marker = cache.join("incoming.json");
    if !marker.exists() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&marker)
        .await
        .map_err(|e| format!("Could not read the handoff marker: {e}"))?;
    // Take semantics: delete the marker before parsing so a malformed file
    // can't wedge every future launch into the same error.
    let _ = tokio::fs::remove_file(&marker).await;
    let parsed: IncomingFile = serde_json::from_str(&raw)
        .map_err(|e| format!("Corrupted handoff marker: {e}"))?;
    Ok(Some(parsed))
}

// ===== Mobile notes root =====
//
// Android scoped storage makes OS-picked files untrustworthy for std::fs
// (SAF hands back URI-form identifiers), so the mobile shell works inside one
// app-private folder. This command resolves and creates it, seeding a first
// note so a brand-new install has something to tap. Desktop ignores it.

/// The notes root returned by `get_notes_dir`.
#[derive(Debug, Serialize)]
pub struct NotesDir {
    pub path: String,
    /// True when the folder had to be created (first launch).
    pub created: bool,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
const NOTES_WELCOME_MD: &str = r#"# Welcome to Paperling

This is your notes folder. Everything here lives **on this device**, in the
app's private storage. No account, no sync, works offline.

## Try it
- Tap **Edit** in the bottom bar to write, **Read** to preview
- Open **Files** in the bottom bar to browse, or **New** to create a note
- Use the **menu (top left)** for save, find, export and more
- Add an AI endpoint in **Settings** to chat about your notes

## Markdown in 30 seconds
**bold**, *italic*, `inline code`, and [links](https://github.com/Razee4315/Paperling)

- bullet lists
- [x] and task lists

```rust
fn main() {
    println!("code blocks render too");
}
```

> Quotes, tables, math like $x^2$, and mermaid diagrams all render in Read mode.

Delete or rewrite this note whenever you like. It is yours.
"#;

#[tauri::command]
pub async fn get_notes_dir(app: tauri::AppHandle) -> Result<NotesDir, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    let dir = base.join("notes");
    let created = !dir.exists();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Could not create notes folder: {e}"))?;

    // Seed a first note only on a genuinely fresh folder, mobile only — the
    // command exists cross-platform, but desktop sessions never call it.
    // This MUST be a #[cfg] attribute block, not `if created && cfg!(...)`:
    // cfg!() compiles BOTH branches at runtime-bool cost, so the desktop build
    // would reference the mobile-only NOTES_WELCOME_MD and fail E0425 (exactly
    // what desktop CI caught after the merge, hidden from android CI, which
    // compiles only the mobile cfg).
    #[cfg(any(target_os = "android", target_os = "ios"))]
    if created {
        let welcome = dir.join("Welcome.md");
        if !welcome.exists() {
            tokio::fs::write(&welcome, NOTES_WELCOME_MD)
                .await
                .map_err(|e| format!("Could not write the welcome note: {e}"))?;
        }
    }

    Ok(NotesDir {
        path: dir.to_string_lossy().into_owned(),
        created,
    })
}

// ===== Leave the app (mobile close flow) =====
//
// The unsaved-changes dialog's "discard / save and close" outcomes have no
// window to destroy on a phone: window controls are OS chrome there and the
// window capability is intentionally absent from mobile.json, so the frontend
// needs one guaranteed way out once the user has made an explicit choice
// (buffers were either saved or consciously abandoned). Desktop destroys the
// window instead and never calls this; the command is defined (and
// registered) cross-platform because the handler list is shared.

/// Terminate the process. Only the mobile shell invokes it.
#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::{
        apply_eol, find_backlinks_in_tree, read_file_inner, sanitize_image_name, save_file_inner,
        search_markdown_tree, validate_rel_path, Eol,
    };

    #[test]
    fn search_finds_matches_recursively_and_case_insensitively() {
        let dir = std::env::temp_dir().join(format!("paperling-search-{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(dir.join("a.md"), "Hello World\nsecond line").unwrap();
        std::fs::write(sub.join("b.md"), "nothing here\nanother WORLD ref").unwrap();
        std::fs::write(dir.join("c.txt"), "world but not markdown").unwrap();

        let results = search_markdown_tree(dir.clone(), "world", false);

        // Two markdown files match; the .txt is ignored.
        assert_eq!(results.len(), 2);
        let a = results.iter().find(|r| r.name == "a.md").unwrap();
        assert_eq!(a.matches.len(), 1);
        assert_eq!(a.matches[0].line, 1);
        assert_eq!(a.matches[0].text, "Hello World");
        let b = results.iter().find(|r| r.name == "b.md").unwrap();
        assert_eq!(b.matches[0].line, 2);

        // Case-sensitive search misses the lowercase/uppercase variants.
        let cs = search_markdown_tree(dir.clone(), "world", true);
        assert!(cs.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn search_skips_hidden_and_ignored_dirs() {
        let dir =
            std::env::temp_dir().join(format!("paperling-search-skip-{}", std::process::id()));
        let hidden = dir.join(".git");
        let modules = dir.join("node_modules");
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::create_dir_all(&modules).unwrap();
        std::fs::write(dir.join("keep.md"), "needle").unwrap();
        std::fs::write(hidden.join("x.md"), "needle").unwrap();
        std::fs::write(modules.join("y.md"), "needle").unwrap();

        let results = search_markdown_tree(dir.clone(), "needle", false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "keep.md");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backlinks_match_exact_wikilinks_and_relative_markdown_links() {
        let dir = std::env::temp_dir().join(format!("paperling-backlinks-{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let target = dir.join("Target Note.md");
        std::fs::write(&target, "# Target\n[[Target Note]]").unwrap();
        std::fs::write(
            dir.join("wiki.md"),
            "[[Target Note|alias]]\n[[Target Note#Heading]]\n[[Target Notebook]]",
        )
        .unwrap();
        std::fs::write(
            sub.join("relative.md"),
            "[target](<../Target Note.md#section>)\n![image](<../Target Note.md>)",
        )
        .unwrap();
        std::fs::write(sub.join("not-sibling.md"), "[[Target Note]]").unwrap();

        let results = find_backlinks_in_tree(
            std::fs::canonicalize(&dir).unwrap(),
            std::fs::canonicalize(&target).unwrap(),
        );

        assert_eq!(results.len(), 2);
        let wiki = results
            .iter()
            .find(|result| result.name == "wiki.md")
            .unwrap();
        assert_eq!(wiki.matches.len(), 2);
        let relative = results
            .iter()
            .find(|result| result.name == "relative.md")
            .unwrap();
        assert_eq!(relative.matches.len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_file_writes_atomically_and_returns_mtime() {
        // Plain current-thread runtime: tokio's "fs" feature doesn't include
        // the macros feature, so no #[tokio::test] here.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("paperling-test-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("doc.md").to_string_lossy().to_string();

            let mtime = save_file_inner(path.clone(), "hello".into()).await.unwrap();
            assert!(mtime > 0);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");

            // Overwrite must replace the existing file (rename-over semantics).
            let mtime2 = save_file_inner(path.clone(), "world".into()).await.unwrap();
            assert!(mtime2 >= mtime);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "world");

            // No temp file left behind.
            let leftovers: Vec<_> = std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().contains("paperling-tmp"))
                .collect();
            assert!(leftovers.is_empty());

            std::fs::remove_dir_all(&dir).ok();
        });
    }

    #[test]
    fn apply_eol_converts_and_normalizes() {
        // LF stays LF.
        assert_eq!(apply_eol("a\nb\nc", Eol::Lf), "a\nb\nc");
        // LF content → CRLF on save.
        assert_eq!(apply_eol("a\nb\nc", Eol::Crlf), "a\r\nb\r\nc");
        // Never doubles up if some \r slipped in.
        assert_eq!(apply_eol("a\r\nb", Eol::Crlf), "a\r\nb");
        assert_eq!(apply_eol("a\r\nb", Eol::Lf), "a\nb");
    }

    #[test]
    fn read_file_normalizes_crlf_to_lf() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir =
                std::env::temp_dir().join(format!("paperling-read-eol-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("crlf.md").to_string_lossy().to_string();

            // A CRLF file must come back LF-only, matching what CodeMirror
            // will hold — otherwise a freshly opened file reads as dirty.
            std::fs::write(&path, "one\r\ntwo\r\n").unwrap();
            let fd = read_file_inner(path).await.unwrap();
            assert_eq!(fd.content, "one\ntwo\n");

            std::fs::remove_dir_all(&dir).ok();
        });
    }

    #[test]
    fn save_file_preserves_crlf_line_endings() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("paperling-eol-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("crlf.md").to_string_lossy().to_string();

            // Seed a CRLF file, then "edit" it with LF-only content (as the editor
            // would hand us) and confirm the CRLF convention survives the save.
            std::fs::write(&path, "one\r\ntwo\r\n").unwrap();
            save_file_inner(path.clone(), "one\ntwo\nthree".into())
                .await
                .unwrap();
            assert_eq!(
                std::fs::read_to_string(&path).unwrap(),
                "one\r\ntwo\r\nthree"
            );

            // A brand-new file keeps the editor's LF.
            let lf_path = dir.join("new.md").to_string_lossy().to_string();
            save_file_inner(lf_path.clone(), "a\nb".into()).await.unwrap();
            assert_eq!(std::fs::read_to_string(&lf_path).unwrap(), "a\nb");

            std::fs::remove_dir_all(&dir).ok();
        });
    }

    #[test]
    fn rel_path_accepts_safe_relatives() {
        assert!(validate_rel_path("images/foo.png").is_ok());
        assert!(validate_rel_path("foo.png").is_ok());
        assert!(validate_rel_path("a/b/c.webp").is_ok());
    }

    #[test]
    fn rel_path_rejects_escapes_and_absolutes() {
        assert!(validate_rel_path("").is_err());
        assert!(validate_rel_path("../foo.png").is_err());
        assert!(validate_rel_path("images/../../secret").is_err());
        assert!(validate_rel_path("/etc/passwd").is_err());
        assert!(validate_rel_path("\0").is_err());
        // Windows absolute / drive-prefixed paths.
        assert!(validate_rel_path("C:/Windows/system.ini").is_err());
    }

    #[test]
    fn accepts_basename() {
        assert_eq!(sanitize_image_name("foo.png").unwrap(), "foo.png");
        assert_eq!(
            sanitize_image_name("image-1234-abc.jpg").unwrap(),
            "image-1234-abc.jpg"
        );
    }

    #[test]
    fn rejects_traversal() {
        assert!(sanitize_image_name("../foo.png").is_err());
        assert!(sanitize_image_name("..\\foo.png").is_err());
        assert!(sanitize_image_name("foo/bar.png").is_err());
        assert!(sanitize_image_name("foo\\bar.png").is_err());
        assert!(sanitize_image_name("..").is_err());
        assert!(sanitize_image_name(".").is_err());
        assert!(sanitize_image_name("").is_err());
        assert!(sanitize_image_name("\0").is_err());
    }

    #[test]
    fn rejects_non_image_extensions() {
        assert!(sanitize_image_name("malware.exe").is_err());
        assert!(sanitize_image_name("script.lnk").is_err());
        assert!(sanitize_image_name("payload.dll").is_err());
        assert!(sanitize_image_name("noext").is_err());
        assert!(sanitize_image_name("trailing.").is_err());
        // Extension matching is case-insensitive — uppercase OK.
        assert!(sanitize_image_name("photo.PNG").is_ok());
        assert!(sanitize_image_name("photo.JpG").is_ok());
    }

    #[test]
    fn accepts_all_whitelisted_extensions() {
        for ext in &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] {
            let name = format!("img.{}", ext);
            assert!(sanitize_image_name(&name).is_ok(), "rejected {}", name);
        }
    }
}
