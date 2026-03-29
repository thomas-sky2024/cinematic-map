use map_engine::{compute_frames, interpolate_single, Keyframe, FrameCamera};
// use serde::{Deserialize, Serialize};
use tauri::Manager;

// ── Commands ───────────────────────────────────────────────────────────────

/// Compute all frame cameras for the full render.
/// Called by TypeScript before starting render or preview.
#[tauri::command]
fn cmd_compute_frames(keyframes: Vec<Keyframe>, fps: u32) -> Vec<FrameCamera> {
    compute_frames(&keyframes, fps)
}

/// Interpolate a single point in time (used for live scrubbing preview).
#[tauri::command]
fn cmd_interpolate_at(keyframes: Vec<Keyframe>, time: f64) -> Option<FrameCamera> {
    interpolate_single(&keyframes, time)
}

/// Get app version.
#[tauri::command]
fn cmd_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── App setup ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cmd_compute_frames,
            cmd_interpolate_at,
            cmd_version,
        ])
        .setup(|app| {
            // Open DevTools in debug builds
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
