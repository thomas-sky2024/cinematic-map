use map_engine::{compute_frames, interpolate_single, Keyframe, FrameCamera};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderStatus {
    pub stage: String,
    pub encoded: u32,
    pub total: u32,
    pub fps: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SwiftProgress {
    encoded: u32,
    total: i64,
    fps: f64,
    stage: String,
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
fn cmd_compute_frames(keyframes: Vec<Keyframe>, fps: u32) -> Vec<FrameCamera> {
    compute_frames(&keyframes, fps)
}

#[tauri::command]
fn cmd_interpolate_at(keyframes: Vec<Keyframe>, time: f64) -> Option<FrameCamera> {
    interpolate_single(&keyframes, time)
}

#[tauri::command]
fn cmd_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Return diagnostic info: where Rust is looking for the Swift encoder.
/// Useful for debugging "encoder not found" errors.
/// From DevTools console: await window.__TAURI__.core.invoke('cmd_debug_paths')
#[tauri::command]
fn cmd_debug_paths(app: AppHandle) -> serde_json::Value {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "<unknown>".into());
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "<unknown>".into());
    let resource_dir = app.path().resource_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "<unavailable>".into());
    let resolved = resolve_encoder_path(&app);
    let resolved_exists = std::path::Path::new(&resolved).exists();

    serde_json::json!({
        "exe":              exe,
        "cwd":              cwd,
        "resource_dir":     resource_dir,
        "resolved_encoder": resolved,
        "encoder_exists":   resolved_exists,
    })
}

/// Validate a MapTiler API key (non-empty, looks like a valid token).
#[tauri::command]
fn cmd_validate_token(token: String) -> bool {
    let t = token.trim();
    // MapTiler keys are typically 24-32 alphanumeric chars
    !t.is_empty() && t.len() >= 16 && t.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

/// Start full render pipeline: compute frames → spawn Swift encoder → stream frames → emit progress.
#[tauri::command]
async fn cmd_start_render(
    app: AppHandle,
    keyframes: Vec<Keyframe>,
    fps: u32,
    resolution: String,
    codec: String,
    bitrate: u32,
    output_path: String,
    style_url: String,   
    _map_token: String,
) -> Result<(), String> {
    emit_status(&app, "initializing", 0, 0, 0.0, None, None);
    
    let (width, height) = match resolution.as_str() {
        "4K" => (3840, 2160),
        _ => (1920, 1080),
    };

    let encoder_path = resolve_encoder_path(&app);

    // Prepare JSON config for Swift
    let duration = keyframes.last().map(|k| k.time).unwrap_or(0.0);
    let config = serde_json::json!({
        "style": style_url,
        "points": keyframes,
        "duration": duration,
        "fps": fps,
        "width": width,
        "height": height,
        "codec": codec,
        "bitrate": bitrate,
    });
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    // Spawn Swift encoder which now handles RENDER + ENCODE
    let mut child = Command::new(&encoder_path)
        .args([
            "--config",     &config_json,
            "--output",     &output_path,
            "--width",      &width.to_string(),
            "--height",     &height.to_string(),
            "--fps",        &fps.to_string(),
            "--codec",      &codec,
            "--bitrate",    &bitrate.to_string(),
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn native renderer at '{}': {}", encoder_path, e))?;

    let stderr = child.stderr.take().ok_or("Could not get stderr")?;

    // Thread: relay Swift stderr progress → Tauri events
    let app_p = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            // Swift might output non-JSON logs too, try to parse
            if let Ok(p) = serde_json::from_str::<SwiftProgress>(&line) {
                emit_status(&app_p, &p.stage, p.encoded, p.total as u32, p.fps, None, None);
            } else {
                eprintln!("[swift] {}", line);
            }
        }
    });

    let exit_status = child.wait().map_err(|e| format!("Renderer wait error: {e}"))?;

    if exit_status.success() {
        emit_status(&app, "done", 0, 0, 0.0, None, Some(output_path));
        Ok(())
    } else {
        let msg = format!("Native renderer failed: {exit_status}");
        emit_status(&app, "error", 0, 0, 0.0, Some(msg.clone()), None);
        Err(msg)
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn emit_status(
    app: &AppHandle,
    stage: &str, encoded: u32, total: u32, fps: f64,
    error: Option<String>, output_path: Option<String>,
) {
    let _ = app.emit("render-progress", RenderStatus {
        stage: stage.to_string(),
        encoded, total, fps, error, output_path,
    });
}

fn resolve_encoder_path(app: &AppHandle) -> String {
    // 1. Bundled resource dir (production build)
    if let Ok(res_dir) = app.path().resource_dir() {
        let p = res_dir.join("map-capture");
        if p.exists() {
            eprintln!("[cinematic-map] encoder found (bundled): {}", p.display());
            return p.to_string_lossy().into_owned();
        }
    }

    // 2. Walk up from the Tauri executable to find the repo root.
    //    In dev: executable is somewhere under apps/desktop/src-tauri/target/…
    //    We look for the marker file "pnpm-workspace.yaml" which sits at repo root.
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.as_path();
        // Walk up at most 10 levels
        for _ in 0..10 {
            if let Some(parent) = dir.parent() {
                dir = parent;
                let marker = parent.join("pnpm-workspace.yaml");
                if marker.exists() {
                    // Found repo root
                    let encoder = parent
                        .join("packages")
                        .join("swift-encoder")
                        .join(".build")
                        .join("release")
                        .join("map-capture");
                    if encoder.exists() {
                        eprintln!("[cinematic-map] encoder found (repo root): {}", encoder.display());
                        return encoder.to_string_lossy().into_owned();
                    }
                    eprintln!("[cinematic-map] encoder NOT found at expected path: {}", encoder.display());
                    eprintln!("[cinematic-map] Run: cd packages/swift-encoder && swift build -c release");
                    // Return the expected path anyway — gives a clearer error
                    return encoder.to_string_lossy().into_owned();
                }
            }
        }
    }

    // 3. Relative paths fallback (covers some setups where CWD = repo root)
    for p in &[
        "packages/swift-encoder/.build/release/map-capture",
        "../packages/swift-encoder/.build/release/map-capture",
        "../../packages/swift-encoder/.build/release/map-capture",
    ] {
        if std::path::Path::new(p).exists() {
            eprintln!("[cinematic-map] encoder found (relative): {p}");
            return p.to_string();
        }
    }

    // 4. PATH fallback
    eprintln!("[cinematic-map] encoder not found anywhere — falling back to PATH lookup");
    "map-capture".to_string()
}

// ── App setup ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            cmd_compute_frames,
            cmd_interpolate_at,
            cmd_version,
            cmd_debug_paths,
            cmd_validate_token,
            cmd_start_render,
        ])
        .setup(|app| {
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
