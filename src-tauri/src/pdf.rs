//! Silent "Save as PDF" export.
//!
//! The previous PDF export drove the webview's print pipeline (`window.print()`),
//! which pops the OS print dialog — the user then has to pick "Save as PDF" and a
//! location inside that dialog. People expect "Export → PDF" to behave like
//! "Export → HTML": ask once where to save, then write the file.
//!
//! On Windows we render the export HTML in a hidden WebView2 and call its native
//! `PrintToPdf`, which writes a vector PDF straight to a path with no dialog (and
//! keeps selectable text, real Unicode and working links). macOS does the same
//! dance with WKWebView: an `NSPrintOperation` whose job disposition is "save to
//! URL" writes a paginated vector PDF with no panels. WKWebView has no JS
//! `window.print()` at all — wry only shims it for WebView2 — so the frontend's
//! iframe print fallback silently did nothing on macOS (#96). Linux keeps the
//! in-webview print flow, which WebKitGTK does implement, so this command is a
//! stub there.

#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(any(target_os = "windows", target_os = "macos"))]
static EXPORT_SEQ: AtomicU64 = AtomicU64::new(0);

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[tauri::command]
pub async fn export_pdf(app: tauri::AppHandle, html: String, path: String) -> Result<(), String> {
    use std::sync::{mpsc, Mutex};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let seq = EXPORT_SEQ.fetch_add(1, Ordering::Relaxed);

    // The native print engines render whatever the webview currently shows, so
    // we need an isolated webview displaying ONLY the export document — not the
    // editor UI. A data: URL would blow past WebView2's ~2 MB navigation cap
    // once images are inlined as base64, so stage the HTML in a temp file and
    // load that instead (macOS follows the same route for symmetry).
    //
    // The staging name is unguessable and claimed with create_new: a
    // predictable path in a shared temp directory would let a local process
    // pre-create or swap the HTML between write and load. The export webview
    // holds no IPC capabilities (its label is in no capability file), but it
    // still renders whatever is in that file — don't make planting content
    // cheap.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut staged: Option<std::path::PathBuf> = None;
    let mut stage_err: Option<std::io::Error> = None;
    for attempt in 0u8..3 {
        let mut candidate = std::env::temp_dir();
        candidate.push(format!(
            "paperling-export-{}-{}-{}-{attempt:x}.html",
            std::process::id(),
            seq,
            nanos,
        ));
        match std::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                use std::io::Write as _;
                match file.write_all(html.as_bytes()) {
                    Ok(()) => {
                        staged = Some(candidate);
                        break;
                    }
                    Err(e) => {
                        let _ = std::fs::remove_file(&candidate);
                        stage_err = Some(e);
                    }
                }
            }
            // Nanosecond collisions are vanishingly rare; retry with a new name.
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                stage_err = Some(e);
            }
            Err(e) => {
                stage_err = Some(e);
                break;
            }
        }
    }
    let temp = staged.ok_or_else(|| {
        format!(
            "Failed to stage export HTML: {}",
            stage_err
                .map(|e| e.to_string())
                .unwrap_or_else(|| "no writable name found".to_string())
        )
    })?;

    let url = tauri::Url::from_file_path(&temp)
        .map_err(|_| "Failed to build a URL for the export file".to_string())?;

    // Signalled once the hidden webview has finished loading the document.
    let (load_tx, load_rx) = mpsc::channel::<()>();
    // on_page_load is `Fn + Send + Sync` and fires for every load event, so the
    // sender lives behind a Mutex and is consumed on the first "Finished".
    let load_tx = Mutex::new(Some(load_tx));

    let label = format!("pdf-export-{seq}");
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .visible(false)
        .skip_taskbar(true)
        .title("")
        // ~US Letter at 96dpi so the on-screen layout settles before the print
        // engine re-flows to the real page size.
        .inner_size(816.0, 1056.0)
        .on_page_load(move |_w, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Ok(mut guard) = load_tx.lock() {
                    if let Some(tx) = guard.take() {
                        let _ = tx.send(());
                    }
                }
            }
        })
        .build()
        .map_err(|e| format!("Failed to create the export view: {e}"))?;

    // Wait for the document to load before printing so we never capture a blank
    // or half-rendered page. Bounded so a stuck load can't hang the export.
    if load_rx
        .recv_timeout(std::time::Duration::from_secs(30))
        .is_err()
    {
        cleanup(window, &temp);
        return Err("Timed out rendering the document for PDF export".into());
    }

    // The export CSS pulls no web fonts (system/local only) and images are
    // inlined, so a short settle is enough for layout to finalize.
    std::thread::sleep(std::time::Duration::from_millis(250));

    // The native print call must run on the UI thread that owns the webview
    // (WebView2's PrintToPdf pumps messages there; NSPrintOperation is
    // AppKit-main-thread only), so do the work inside with_webview and report
    // back.
    let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
    let target = path.clone();
    if let Err(e) = window.with_webview(move |platform| {
        let result = unsafe { print_to_pdf(platform, &target) };
        let _ = done_tx.send(result);
    }) {
        cleanup(window, &temp);
        return Err(format!("Failed to access the export view: {e}"));
    }

    let outcome = done_rx
        .recv_timeout(std::time::Duration::from_secs(120))
        .unwrap_or_else(|_| Err("Timed out writing the PDF".into()));

    // On Windows, print_to_pdf blocks until the file is written. On macOS it
    // only *starts* the save-to-URL print operation, which is allowed to finish
    // asynchronously — so wait for the PDF to actually land on disk before
    // declaring success (the frontend shows "Exported" on Ok).
    #[cfg(target_os = "macos")]
    let outcome = outcome.and_then(|()| wait_for_written_file(std::path::Path::new(&path)));

    cleanup(window, &temp);
    outcome
}

/// Poll until `path` exists, is non-empty, and its size has stopped changing —
/// i.e. the print operation has finished writing it. Errors out after 60s.
#[cfg(target_os = "macos")]
fn wait_for_written_file(path: &std::path::Path) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    let mut last_len: Option<u64> = None;
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let len = match std::fs::metadata(path) {
            Ok(meta) if meta.len() > 0 => meta.len(),
            _ => continue,
        };
        // Two consecutive polls with the same non-zero size = write finished.
        if last_len == Some(len) {
            return Ok(());
        }
        last_len = Some(len);
    }
    Err("Timed out writing the PDF".into())
}

/// Close the hidden export window and delete its staged HTML file. Best-effort:
/// a failure to clean up must never mask the export result.
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn cleanup(window: tauri::WebviewWindow, temp: &std::path::Path) {
    let _ = window.close();
    let _ = std::fs::remove_file(temp);
}

/// Drive WebView2's native `PrintToPdf` to `path` and block (pumping the message
/// loop) until it finishes. Must be called on the UI thread.
///
/// # Safety
/// Calls into the WebView2 COM interfaces; the controller must belong to a live
/// webview on the current (UI) thread.
#[cfg(target_os = "windows")]
unsafe fn print_to_pdf(
    platform: tauri::webview::PlatformWebview,
    path: &str,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2PrintSettings, ICoreWebView2_7};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING, PCWSTR};

    let webview = platform
        .controller()
        .CoreWebView2()
        .map_err(|e| format!("WebView2 unavailable: {e}"))?;
    // PrintToPdf arrived in ICoreWebView2_7 (WebView2 Runtime 87+); every
    // currently shipping Evergreen runtime is far newer, but fail clearly if a
    // machine somehow has an ancient one.
    let webview7: ICoreWebView2_7 = webview
        .cast()
        .map_err(|e| format!("This WebView2 runtime is too old to export PDF: {e}"))?;

    let path_h = HSTRING::from(path);

    PrintToPdfCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            // None = default print settings (portrait, default page size/margins,
            // which the document's @page CSS overrides).
            webview7
                .PrintToPdf(
                    PCWSTR(path_h.as_ptr()),
                    None::<&ICoreWebView2PrintSettings>,
                    &handler,
                )
                .map_err(Into::into)
        }),
        Box::new(|result, is_success| {
            result?;
            if is_success {
                Ok(())
            } else {
                Err(windows::core::Error::new(
                    windows::core::HRESULT(-1),
                    "WebView2 reported the PDF export failed",
                ))
            }
        }),
    )
    .map_err(|e| format!("PDF export failed: {e}"))
}

/// Start an `NSPrintOperation` on the WKWebView that saves a paginated PDF to
/// `path` with no print or progress panel. Returns once the operation has been
/// kicked off; the caller polls for the written file. Must be called on the
/// main thread (with_webview guarantees that).
///
/// # Safety
/// Calls into the AppKit/WebKit Objective-C runtime; the pointers must belong
/// to a live webview on the current (main) thread.
#[cfg(target_os = "macos")]
unsafe fn print_to_pdf(
    platform: tauri::webview::PlatformWebview,
    path: &str,
) -> Result<(), String> {
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{NSObjectProtocol, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    let webview = (platform.inner() as *mut WKWebView)
        .as_ref()
        .ok_or("WKWebView unavailable")?;
    let ns_window = (platform.ns_window() as *mut NSWindow)
        .as_ref()
        .ok_or("Export window unavailable")?;

    // printOperationWithPrintInfo: arrived in macOS 11; guard so an unsupported
    // OS fails with a clear message instead of an unrecognized-selector crash.
    if !webview.respondsToSelector(objc2::sel!(printOperationWithPrintInfo:)) {
        return Err("PDF export requires macOS 11 or later".into());
    }

    // Fresh print info (NOT sharedPrintInfo — mutating that would leak the
    // save-to-file disposition into every later print in the process). The
    // "save" disposition + saving URL is what makes this silent: the print
    // engine writes the PDF itself, no dialog involved.
    let print_info = NSPrintInfo::new();
    print_info.setJobDisposition(NSPrintSaveJob);
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let url_obj: &AnyObject = &url;
    print_info
        .dictionary()
        .setObject_forKey(url_obj, ProtocolObject::from_ref(NSPrintJobSavingURL));

    // WKWebView's print pipeline ignores the document's @page CSS, so mirror
    // the export stylesheet's `@page { margin: 18mm 16mm }` here.
    const MM_TO_PT: f64 = 72.0 / 25.4;
    print_info.setTopMargin(18.0 * MM_TO_PT);
    print_info.setBottomMargin(18.0 * MM_TO_PT);
    print_info.setLeftMargin(16.0 * MM_TO_PT);
    print_info.setRightMargin(16.0 * MM_TO_PT);
    // Scale content to the page width, paginate vertically.
    print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);

    let op = webview.printOperationWithPrintInfo(&print_info);
    op.setShowsPrintPanel(false);
    op.setShowsProgressPanel(false);
    // WKWebView hands the operation a zero-sized print view, which renders as
    // blank pages; give it the webview's bounds so content actually lays out.
    if let Some(view) = op.view() {
        view.setFrame(webview.frame());
    }

    // With both panels disabled nothing modal is actually shown; this just runs
    // the operation against the (hidden) export window. The delegate-less form
    // may complete asynchronously — the caller waits for the file.
    op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
        ns_window,
        None,
        None,
        std::ptr::null_mut(),
    );

    Ok(())
}

/// Linux falls back to the in-webview print flow handled in the frontend
/// (WebKitGTK implements `window.print()`); this command should never be called
/// there. Kept so `generate_handler!` resolves on every platform.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
pub async fn export_pdf(
    _app: tauri::AppHandle,
    _html: String,
    _path: String,
) -> Result<(), String> {
    Err("Direct PDF export is only available on Windows and macOS".into())
}
