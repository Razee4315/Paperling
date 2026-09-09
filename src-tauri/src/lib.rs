mod ai;
mod commands;
mod pdf;

use commands::{
    exit_app, find_backlinks, get_ai_key, get_file_info, get_incoming_file, get_notes_dir,
    list_directory_files, read_file, read_image_file, save_file, save_image, search_files,
    set_ai_key,
};
use std::sync::Mutex;
// Both traits are only exercised by the desktop single-instance closure
// (window lookup + event emit); on mobile they would be unused imports.
#[cfg(desktop)]
use tauri::{Emitter, Manager};

/// File path passed on the command line (double-clicking a .md in the OS).
/// Held until the frontend asks for it via `get_cli_file`.
struct CliFile(Mutex<Option<String>>);

/// First markdown path among the process arguments (skipping argv[0]).
fn md_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.ends_with(".md") || a.ends_with(".markdown"))
        .cloned()
}

/// PULL model for the OS-opened file. The old design pushed an event after a
/// fixed 500 ms sleep, which raced the webview: on slow cold starts the event
/// fired before the JS listener existed and was silently lost, so the
/// last-session restore won and the app showed the previous file instead of
/// the one the user double-clicked. Now the frontend asks for the path when
/// it is actually ready, before deciding whether to restore the last session.
/// `take()` so a webview reload doesn't re-open it.
#[tauri::command]
fn get_cli_file(state: tauri::State<CliFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_file = md_arg(&std::env::args().collect::<Vec<_>>());

    // Desktop reassigns `builder` twice below (single-instance, window-state);
    // both blocks are compiled out on mobile, where the plain chain needs no
    // mut — hence the target-conditional lint allowance.
    #[cfg_attr(not(desktop), allow(unused_mut))]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // Desktop only: forward a second launch's argv to the running instance.
    // A second launch (double-clicking another .md while Paperling runs)
    // forwards its argv here and exits; we surface the window and hand
    // the path to the existing frontend listener. Android launches one
    // activity per app — there is no second process to forward from.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = md_arg(&argv) {
                    let _ = window.emit("file-open-from-cli", path);
                }
            }
        }));
    }

    // Remembers where the window was and how big it was across launches.
    // Geometry ONLY — the plugin's default flag set is all(), and three of
    // those flags fight code we already have:
    //   VISIBLE     restore_state ends in `show() + set_focus()`, which fires
    //               at window-ready and so undoes `visible: false` in
    //               tauri.conf.json. That flag plus revealMainWindow() is what
    //               kills the white startup flash on the dark theme.
    //   FULLSCREEN  useFullscreen tracks fullscreen in a ref because
    //               isFullscreen() lies on frameless windows (FULLSCREEN-01).
    //               Reopening fullscreen behind its back desyncs the title bar
    //               and eats the first F11 press.
    //   DECORATIONS meaningless for a window that is always decorations:false.
    //
    // Filtered to "main" as well, because the plugin manages EVERY window and
    // PDF export spins up its own (pdf.rs, label "pdf-export-{seq}"). Those are
    // deliberately hidden and deliberately sized to US Letter at 96dpi; letting
    // the plugin persist and then re-apply their geometry would mean a stale
    // saved size silently overriding the size pdf.rs asks for. A denylist can't
    // express this since the labels carry a counter.
    #[cfg(desktop)]
    {
        use tauri_plugin_window_state::StateFlags;
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_filter(|label| label == "main")
                .build(),
        );
    }

    builder
        .setup(|_app| {
            // Updater (GitHub latest.json) + process (relaunch after install)
            // are desktop-only plugins, hence registered here behind cfg
            // instead of in the unconditional plugin chain above. The closure
            // param carries the conventional underscore prefix: on mobile both
            // cfg blocks below vanish and the param would otherwise be flagged
            // as unused there.
            #[cfg(desktop)]
            {
                _app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                _app.handle().plugin(tauri_plugin_process::init())?;
            }
            // UI-automation bridge for the Tauri MCP server. Desktop debug
            // builds only; bound to localhost so nothing on the network can
            // drive the app. (The crate is a desktop-only dependency too —
            // gating both sides keeps `cargo check --target aarch64-linux-android`
            // clean without pulling a WebSocket stack onto the phone.)
            #[cfg(all(debug_assertions, desktop))]
            {
                _app.handle().plugin(
                    tauri_plugin_mcp_bridge::Builder::new()
                        .bind_address("127.0.0.1")
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(CliFile(Mutex::new(cli_file)))
        .manage(ai::AiCancel::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            get_file_info,
            list_directory_files,
            search_files,
            find_backlinks,
            save_image,
            read_image_file,
            get_ai_key,
            set_ai_key,
            get_notes_dir,
            get_incoming_file,
            exit_app,
            get_cli_file,
            pdf::export_pdf,
            ai::ai_request,
            ai::ai_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::md_arg;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn md_arg_skips_argv0_and_finds_markdown() {
        assert_eq!(md_arg(&v(&["paperling.exe", "C:\\notes\\a.md"])), Some("C:\\notes\\a.md".into()));
        assert_eq!(md_arg(&v(&["paperling.exe", "C:\\notes\\b.markdown"])), Some("C:\\notes\\b.markdown".into()));
    }

    #[test]
    fn md_arg_ignores_non_markdown_and_flags() {
        assert_eq!(md_arg(&v(&["paperling.exe"])), None);
        assert_eq!(md_arg(&v(&["paperling.exe", "--flag", "notes.txt"])), None);
        // argv[0] itself never matches, even if the exe path looked odd
        assert_eq!(md_arg(&v(&["weird.md"])), None);
    }

    #[test]
    fn md_arg_takes_first_markdown_among_args() {
        assert_eq!(
            md_arg(&v(&["paperling.exe", "--verbose", "x.md", "y.md"])),
            Some("x.md".into())
        );
    }
}
