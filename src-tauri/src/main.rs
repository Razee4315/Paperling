// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMABUF renderer crashes on some Wayland compositors
    // (GNOME/Mutter, NVIDIA), aborting startup with "Error 71 (Protocol error)
    // dispatching to Wayland display" — the window flashes then dies. Forcing
    // the renderer off falls back to the stable path. Must run before GTK and
    // WebKit initialise, so it lives here in main(). Honour an explicit user
    // override if one is already set in the environment.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    paperling_lib::run()
}
