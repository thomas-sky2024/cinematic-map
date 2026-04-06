use map_engine::{compute_frames, interpolate_single, Keyframe, FrameCamera, Annotation};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RenderStage {
    Computing,
    Bundling,
    Encoding,
    Done,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderStatus {
    pub stage: RenderStage,
    pub encoded: u32,
    pub total: u32,
    pub fps: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
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

/// Return diagnostic info: where Rust is looking for the renderer.
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
    let resolved = resolve_renderer_path(&app);
    let resolved_exists = std::path::Path::new(&resolved).exists();

    serde_json::json!({
        "exe":              exe,
        "cwd":              cwd,
        "resource_dir":     resource_dir,
        "resolved_renderer": resolved,
        "renderer_exists":   resolved_exists,
    })
}

/// Validate a MapTiler API key (non-empty, looks like a valid token).
#[tauri::command]
fn cmd_validate_token(token: String) -> bool {
    let t = token.trim();
    !t.is_empty() && t.len() >= 16 && t.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
async fn cmd_start_render(
    app: AppHandle,
    keyframes: Vec<Keyframe>,
    fps: u32,
    _resolution: String,
    codec: String,
    _bitrate: u32,
    output_path: String,
    style_id: String,
    map_token: String,
    annotations: Vec<Annotation>,
    terrain_enabled: bool,
) -> Result<(), String> {
    emit_status(&app, RenderStage::Computing, 0, 0, 0.0, None, None);

    let frames = compute_frames(&keyframes, fps);
    let total_frames = frames.len() as u32;

    if total_frames == 0 {
        return Err("No frames to render".into());
    }

    emit_status(&app, RenderStage::Bundling, 0, total_frames, 0.0, None, None);

    let (width, height) = match _resolution.as_str() {
        "4K" => (3840, 2160),
        _ => (1920, 1080),
    };

    let config = serde_json::json!({
        "frames": frames,
        "annotations": annotations,
        "mapStyleId": style_id,
        "mapToken": map_token,
        "terrainEnabled": terrain_enabled,
        "fps": fps,
        "codec": codec,
        "width": width,
        "height": height,
        "bitrate": _bitrate,
    });
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    // Write config to temp file to avoid CLI length limits
    let cache_dir = app.path().app_cache_dir().map_err(|e| format!("Cache dir error: {e}"))?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Create cache dir error: {e}"))?;
    let config_file = cache_dir.join("render_config.json");
    std::fs::write(&config_file, &config_json).map_err(|e| format!("Write config file error: {e}"))?;

    // Ensure output parent directory exists
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let renderer_path = resolve_renderer_path(&app);
    
    let mut cmd = if renderer_path.ends_with(".ts") {
        let mut c = Command::new("pnpm");
        c.args(["-F", "@cinematic-map/renderer-remotion", "exec", "tsx", &renderer_path]);
        c
    } else {
        Command::new(&renderer_path)
    };

    let mut child = cmd
        .args([
            "--config-file", &config_file.to_string_lossy(),
            "--output", &output_path,
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn renderer: {}", e))?;

    let stderr = child.stderr.take().ok_or("Could not get stderr")?;

    let app_p = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(p) = serde_json::from_str::<serde_json::Value>(&line) {
                let stage = match p["stage"].as_str() {
                    Some("computing") => RenderStage::Computing,
                    Some("bundling")  => RenderStage::Bundling,
                    Some("encoding")  => RenderStage::Encoding,
                    Some("done")      => RenderStage::Done,
                    Some("error")     => RenderStage::Error,
                    _                 => RenderStage::Encoding, // Default for progress updates
                };
                let encoded = p["encoded"].as_u64().unwrap_or(0) as u32;
                let total   = p["total"].as_u64().unwrap_or(0) as u32;
                let fps     = p["fps"].as_f64().unwrap_or(0.0);
                
                emit_status(&app_p, stage, encoded, total, fps, None, None);
            } else {
                eprintln!("[remotion] {}", line);
            }
        }
    });

    let exit_status = child.wait().map_err(|e| format!("Renderer wait error: {e}"))?;

    if exit_status.success() {
        emit_status(&app, RenderStage::Done, total_frames, total_frames, 0.0, None, Some(output_path));
        Ok(())
    } else {
        let msg = format!("Renderer failed: {exit_status}");
        emit_status(&app, RenderStage::Error, 0, 0, 0.0, Some(msg.clone()), None);
        Err(msg)
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn emit_status(
    app: &AppHandle,
    stage: RenderStage, encoded: u32, total: u32, fps: f64,
    error: Option<String>, output_path: Option<String>,
) {
    let _ = app.emit("render-progress", RenderStatus {
        stage,
        encoded, total, fps, error, output_path,
    });
}

fn resolve_renderer_path(app: &AppHandle) -> String {
    if let Ok(res_dir) = app.path().resource_dir() {
        let p = res_dir.join("render-cli");
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }

    // Modern idiomatic path lookup using iterators
    if let Ok(exe) = std::env::current_exe() {
        let found = std::iter::successors(Some(exe.as_path()), |p| p.parent())
            .take(10)
            .find(|p| p.join("pnpm-workspace.yaml").exists())
            .and_then(|parent| {
                let renderer = parent
                    .join("packages")
                    .join("renderer-remotion")
                    .join("src")
                    .join("render-cli.ts");
                if renderer.exists() {
                    Some(renderer.to_string_lossy().into_owned())
                } else {
                    None
                }
            });

        if let Some(path) = found {
            return path;
        }
    }

    "render-cli.ts".to_string()
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
                // let window = app.get_webview_window("main").unwrap();
                // window.open_devtools(); // Disabled to prevent auto-opening on launch
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
