//! Muster desktop shell: owns the headless OpenCode harness.
//!
//! On startup it spawns the bundled `opencode` sidecar with every stateful
//! path redirected into `<appData>/muster/data` (share/config/state +
//! workspace), captures the per-boot `server password` from its stdout, and
//! hands it (plus the harness URL and workspace path) to the web UI through
//! the `harness_info` / `harness_token` commands. The child is killed when the
//! app exits so no orphan harness is left behind.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PASSWORD_PREFIX: &str = "server password ";

/// Origins the webview can have (tauri://localhost on Linux/macOS,
/// http(s)://tauri.localhost on Windows/Android) + the vite dev server.
const CORS_ORIGINS: [&str; 5] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:1420",
    "http://localhost:1420",
];

struct Harness {
    password: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
    /// Loopback port picked at startup — never a fixed one, so a dev harness
    /// on 4096 cannot be clobbered.
    port: u16,
    workspace: PathBuf,
    exited: AtomicBool,
    error: Mutex<Option<String>>,
}

fn pick_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(4096)
}

/// `<appData>/muster/data` + the four child dirs, all created.
fn data_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("muster")
        .join("data");
    let share = root.join("share");
    let config = root.join("config");
    let state = root.join("state");
    let workspace = root.join("workspace");
    for d in [&root, &share, &config, &state, &workspace] {
        std::fs::create_dir_all(d).map_err(|e| format!("mkdir {}: {e}", d.display()))?;
    }
    Ok((root, share, config, state, workspace))
}

/// Config root the harness reads `opencode.jsonc` from.
/// Dev: repo root (next to src-tauri). Release: bundled resources dir.
fn config_root(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "no parent dir".to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .map_err(|e| format!("resource_dir: {e}"))
    }
}

/// Workspace starter files (skills and the like) shipped with the app.
/// Points at `templates/workspace` so its contents land directly in the
/// datafolder workspace.
fn templates_root(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("templates").join("workspace"))
            .unwrap_or_default()
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .map(|p| p.join("templates").join("workspace"))
            .unwrap_or_default()
    }
}

/// Recursively copy files that do not exist in `dst` yet. Never overwrites —
/// the workspace belongs to the user once seeded.
fn copy_missing_tree(src: &Path, dst: &Path) {
    if !src.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(src) else { return };
    if std::fs::create_dir_all(dst).is_err() {
        return;
    }
    for entry in entries.flatten() {
        let to = dst.join(entry.file_name());
        let Ok(ty) = entry.file_type() else { continue };
        if ty.is_dir() {
            copy_missing_tree(&entry.path(), &to);
        } else if ty.is_file() && !to.exists() {
            let _ = std::fs::copy(entry.path(), &to);
        }
    }
}

fn kill_child(app: &AppHandle) {
    if let Some(state) = app.try_state::<Harness>() {
        if let Some(child) = state.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessInfo {
    base_url: String,
    workspace: String,
}

/// Where the web UI should talk and which workspace to pin sessions to.
#[tauri::command]
fn harness_info(state: State<'_, Harness>) -> Result<HarnessInfo, String> {
    Ok(HarnessInfo {
        base_url: format!("http://127.0.0.1:{}", state.port),
        workspace: state.workspace.to_string_lossy().into_owned(),
    })
}

/// Per-boot harness password for the web UI. Waits until the sidecar prints
/// it; fails immediately when the sidecar died on the way.
#[tauri::command]
async fn harness_token(state: State<'_, Harness>) -> Result<String, String> {
    for _ in 0..240 {
        if let Some(pw) = state.password.lock().unwrap().clone() {
            return Ok(pw);
        }
        if state.exited.load(Ordering::SeqCst) {
            let detail = state.error.lock().unwrap().clone();
            return Err(detail.unwrap_or_else(|| "harness exited before reporting a password".into()));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("harness did not report a password within 60s".into())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![harness_info, harness_token])
        .setup(|app| {
            let handle = app.handle().clone();
            let (_, _, _, _, workspace) = data_dirs(&handle)?;
            // Seed starter files (never overwrites what is already there).
            copy_missing_tree(&templates_root(&handle), &workspace);
            app.manage(Harness {
                password: Mutex::new(None),
                child: Mutex::new(None),
                port: pick_port(),
                workspace,
                exited: AtomicBool::new(false),
                error: Mutex::new(None),
            });
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_harness(&handle).await {
                    eprintln!("[muster] harness failed: {e}");
                    if let Some(state) = handle.try_state::<Harness>() {
                        state.exited.store(true, Ordering::SeqCst);
                        *state.error.lock().unwrap() = Some(e);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|win, ev| {
            if matches!(ev, WindowEvent::CloseRequested { .. }) {
                kill_child(&win.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Muster");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit) {
            kill_child(handle);
        }
    });
}

async fn run_harness(app: &AppHandle) -> Result<(), String> {
    let (_root, share, config, state, _workspace) = data_dirs(app)?;
    let cfg_root = config_root(app)?;
    let port = app.state::<Harness>().port;
    let db = share.join("opencode").join("opencode.db");
    if let Some(parent) = db.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir db dir: {e}"))?;
    }

    let mut args: Vec<String> = vec![
        "serve".into(),
        "--hostname".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
    ];
    for origin in CORS_ORIGINS {
        args.push("--cors".into());
        args.push(origin.into());
    }

    let (mut rx, child) = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| format!("sidecar: {e}"))?
        .args(args)
        .env("XDG_DATA_HOME", &share)
        .env("XDG_CONFIG_HOME", &config)
        .env("XDG_STATE_HOME", &state)
        .env("OPENCODE_DB", &db)
        .env("OPENCODE_DISABLE_PRUNE", "1")
        .current_dir(&cfg_root)
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;

    eprintln!("[muster] harness pid {:?} on port {port}", child.pid());
    app.state::<Harness>().child.lock().unwrap().replace(child);

    while let Some(evt) = rx.recv().await {
        match evt {
            // The shell plugin splits output into lines by default.
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(pw) = line.trim().strip_prefix(PASSWORD_PREFIX) {
                    eprintln!("[muster] harness ready on port {port}");
                    app.state::<Harness>()
                        .password
                        .lock()
                        .unwrap()
                        .replace(pw.trim().to_string());
                } else if !line.trim().is_empty() {
                    eprintln!("[muster:harness] {}", line.trim_end());
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if !line.trim().is_empty() {
                    eprintln!("[muster:harness] {}", line.trim_end());
                }
            }
            CommandEvent::Terminated(payload) => {
                let state = app.state::<Harness>();
                state.exited.store(true, Ordering::SeqCst);
                if state.password.lock().unwrap().is_none() {
                    *state.error.lock().unwrap() = Some(format!(
                        "harness exited early (code {:?}, signal {:?})",
                        payload.code, payload.signal
                    ));
                }
                break;
            }
            _ => {}
        }
    }
    Ok(())
}
