//! Finding agentdeck-core (`adk`) on this machine.
//!
//! Where it looks, in order: `core` in settings.json; on macOS, the core
//! bundled inside AgentDeck.app (`Contents/Helpers/AgentDeck Core.app`); this
//! process's PATH and the usual install places; then the person's login
//! shell's PATH (an app opened from the Dock or a launcher doesn't get it).
//! A candidate counts only if `--version` says `adk …`: another program may
//! share the name.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(any(target_os = "macos", all(test, unix)))]
mod cli_link;

static BIN: Mutex<Option<PathBuf>> = Mutex::new(None);

#[cfg(target_os = "macos")]
pub fn install_cli_link() {
    if let Err(e) = std::thread::Builder::new().name("cli-link".into()).spawn(|| {
        let result = std::env::current_exe().and_then(|exe| cli_link::ensure(&crate::mods::home(), &exe));
        if let Err(e) = result {
            tracing::warn!("cannot install agentdeck CLI link: {e}");
        }
    }) {
        tracing::warn!("cannot start agentdeck CLI setup: {e}");
    }
}

/// The core the app runs (`adk` until one is found).
pub fn path() -> PathBuf {
    BIN.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone().unwrap_or_else(|| PathBuf::from(crate::brand::CORE_CLI))
}

/// Uses this core from now on, and puts its folder first on PATH so mods'
/// `hc()` and anything the app runs find the same one.
pub fn use_core(bin: PathBuf) {
    if let Some(dir) = bin.parent() {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs: Vec<PathBuf> = vec![dir.to_path_buf()];
        dirs.extend(std::env::split_paths(&path).filter(|d| d != dir));
        if let Ok(joined) = std::env::join_paths(dirs) {
            // SAFETY: set once at start, before other threads read the environment.
            unsafe { std::env::set_var("PATH", joined) };
        }
    }
    *BIN.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(bin);
}

/// Finder and Dock launches don't inherit the person's shell PATH.
#[cfg(target_os = "macos")]
pub fn fill_path() {
    if std::os::unix::process::parent_id() != 1 {
        return;
    }
    let home = crate::mods::home();
    let current = std::env::var_os("PATH").unwrap_or_default();
    if let Some(path) = merged_path(login_shell_path().as_deref(), &usual_dirs(&home)[..3], &current) {
        // SAFETY: called at startup, before other threads read the environment.
        unsafe { std::env::set_var("PATH", path) };
    }
}

#[cfg(any(target_os = "macos", test))]
fn merged_path(login: Option<&std::ffi::OsStr>, usual: &[PathBuf], current: &std::ffi::OsStr) -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = login.map(|path| dirs_on(path).collect()).unwrap_or_default();
    dirs.extend_from_slice(usual);
    dirs.extend(dirs_on(current));
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|dir| seen.insert(dir.clone()));
    std::env::join_paths(dirs).ok()
}

/// `adk X.Y.Z` if this binary is agentdeck-core and runs.
pub fn version(bin: &Path) -> Option<String> {
    let out = crate::spawn::command(bin).arg("--version").stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    (out.status.success() && text.starts_with(crate::brand::CORE_VERSION_PREFIX)).then_some(text)
}

/// The core bundled inside this app, if the given executable is inside a `.app`.
fn bundled_core(exe: &Path) -> Option<PathBuf> {
    let app_root = exe.ancestors().find(|a| a.extension().and_then(|e| e.to_str()) == Some("app"))?;
    Some(app_root.join("Contents/Helpers/AgentDeck Core.app/Contents/MacOS/agentdeck-core"))
}

/// The first agentdeck-core found, or None.
pub fn find(configured: Option<&str>) -> Option<PathBuf> {
    let home = crate::mods::home();
    let pick = |candidates: Vec<PathBuf>| candidates.into_iter().filter(|c| c.is_file()).find(|c| version(c).is_some());
    if let Some(found) = pick(configured.map(|c| vec![expand(c, &home)]).unwrap_or_default()) {
        return Some(found);
    }
    // Tests: HERDR_CORE_DIRS replaces every place Herdr would look.
    if let Some(dirs) = std::env::var_os("HERDR_CORE_DIRS") {
        return pick(std::env::split_paths(&dirs).flat_map(|d| names(&d)).collect());
    }
    // The core bundled inside AgentDeck.app itself.
    if cfg!(target_os = "macos") {
        if let Some(bundled) = std::env::current_exe().ok().and_then(|e| e.canonicalize().ok()).and_then(|e| bundled_core(&e)) {
            if let Some(found) = pick(vec![bundled]) {
                return Some(found);
            }
        }
    }
    // The quick places first; the login shell (slow) only if they have none.
    let path = std::env::var_os("PATH").unwrap_or_default();
    let quick: Vec<PathBuf> = dirs_on(&path).chain(usual_dirs(&home)).flat_map(|d| names(&d)).collect();
    pick(quick).or_else(|| pick(dirs_on(&login_shell_path()?).flat_map(|d| names(&d)).collect()))
}

fn expand(p: &str, home: &Path) -> PathBuf {
    match p.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(p),
    }
}

fn names(dir: &Path) -> [PathBuf; 2] {
    let exe = std::env::consts::EXE_SUFFIX;
    [dir.join(format!("agentdeck-core{exe}")), dir.join(format!("{}{exe}", crate::brand::CORE_CLI))]
}

fn dirs_on(path: &std::ffi::OsStr) -> impl Iterator<Item = PathBuf> + '_ {
    std::env::split_paths(path)
}

/// Where agentdeck-core gets installed: its own installer and Herdr 1.x's
/// (~/.local/bin), Homebrew, mise, Nix, cargo.
fn usual_dirs(home: &Path) -> Vec<PathBuf> {
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| home.join("AppData/Local"));
        return vec![local.join("Programs/agentdeck-core"), home.join(".cargo/bin")];
    }
    let mut dirs = vec![
        home.join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".local/share/mise/shims"),
        home.join(".nix-profile/bin"),
        PathBuf::from("/run/current-system/sw/bin"),
        home.join(".cargo/bin"),
    ];
    if cfg!(target_os = "macos") {
        dirs.push(home.join(".local/share/agentdeck-core/current/Contents/MacOS"));
        // Older installers placed the bundle directly in agentdeck-core.
        dirs.push(home.join(".local/share/agentdeck-core/AgentDeck Core.app/Contents/MacOS"));
    }
    dirs
}

/// The PATH the person's login shell sets up, or None if it doesn't answer quickly.
fn login_shell_path() -> Option<std::ffi::OsString> {
    if cfg!(windows) {
        return None;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut child = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // A slow or interactive shell profile must not hold up the app.
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        if child.try_wait().ok()?.is_some() {
            break;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    Some(out.into())
}

/// Installs the core's latest release with its own installer (into
/// ~/.local/bin, or HC_INSTALL_DIR), then finds it. Err: what went wrong.
pub fn install() -> Result<PathBuf, String> {
    let releases = crate::update::releases().ok_or_else(|| {
        "AgentDeck has no release server. Build the core (just build), then choose core/target/debug/agentdeck-core.".to_owned()
    })?;
    let mut cmd = if cfg!(windows) {
        let mut c = crate::spawn::command("powershell");
        c.args(["-NoProfile", "-Command", &format!("irm {releases}/core/install.ps1 | iex")]);
        c
    } else {
        let mut c = crate::spawn::command("sh");
        c.args(["-c", &format!("curl -fsSL {releases}/core/install.sh | sh")]);
        c
    };
    let out = cmd.stdin(Stdio::null()).output().map_err(|e| format!("cannot run the installer: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        return Err(if err.is_empty() { "the installer failed".into() } else { err });
    }
    let home = crate::mods::home();
    let dir = std::env::var_os("HC_INSTALL_DIR").map(PathBuf::from).unwrap_or_else(|| {
        if cfg!(windows) {
            usual_dirs(&home).remove(0)
        } else {
            home.join(".local/bin")
        }
    });
    let bin = dir.join(format!("agentdeck-core{}", std::env::consts::EXE_SUFFIX));
    version(&bin).map(|_| bin).ok_or_else(|| "installed, but agentdeck-core doesn't run".into())
}

/// Updates the core to its latest release (`adk update`: same generation only,
/// terminals kept). Ok: the version it runs now. Err: what it said, e.g.
/// "belongs to Homebrew: brew upgrade agentdeck-core".
pub fn update() -> Result<String, String> {
    update_to(None)
}

/// `adk update --version X`: at least X (a newer core stays). Cores before 0.1.5 lack it.
pub fn update_to(at_least: Option<&str>) -> Result<String, String> {
    // The core found may be an upstream install, which defaults to upstream's release server.
    if crate::update::releases().is_none() {
        return Err(crate::update::NO_SERVER.into());
    }
    let mut cmd = crate::spawn::command(path());
    cmd.args(["update", "--json"]);
    if let Some(v) = at_least {
        cmd.args(["--version", v]);
    }
    let out = cmd.stdin(Stdio::null()).output().map_err(|e| format!("cannot run adk update: {e}"))?;
    let reply: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    if out.status.success() {
        return Ok(reply.get("now").and_then(|v| v.as_str()).unwrap_or("the latest").to_owned());
    }
    let err: serde_json::Value = serde_json::from_slice(&out.stderr).unwrap_or_default();
    let message = err.pointer("/error/message").and_then(|v| v.as_str()).map(str::to_owned);
    let hint = err.pointer("/error/hint").and_then(|v| v.as_str()).map(|h| format!(" ({h})")).unwrap_or_default();
    Err(message.map(|m| m + &hint).unwrap_or_else(|| String::from_utf8_lossy(&out.stderr).trim().to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_without_release_server_says_how_to_build() {
        assert!(crate::update::releases().is_none(), "run without HERDR_RELEASES_URL");
        let error = install().unwrap_err();
        assert!(error.contains("just build"), "{error}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_independent_core_bundle_is_a_discovery_fallback() {
        let home = Path::new("/Users/test");
        let dir = home.join(".local/share/agentdeck-core/current/Contents/MacOS");
        let legacy = home.join(".local/share/agentdeck-core/AgentDeck Core.app/Contents/MacOS");
        let dirs = usual_dirs(home);
        assert_eq!(&dirs[dirs.len() - 2..], &[dir.clone(), legacy]);
        assert_eq!(names(&dir)[0], dir.join("agentdeck-core"));
    }

    #[cfg(unix)]
    #[test]
    fn setup_can_replace_an_unusable_core_before_reconnecting() {
        const CHILD: &str = "HERDR_TEST_RESELECT_CORE";
        if std::env::var_os(CHILD).is_none() {
            let output = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "core_bin::tests::setup_can_replace_an_unusable_core_before_reconnecting", "--nocapture"])
                .env(CHILD, "1").output().unwrap();
            assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            return;
        }
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("agentdeck-core-reselect-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let bad = root.join("bad-hc");
        std::fs::write(&bad, "#!/bin/sh\nif [ \"$1\" = --version ]; then echo adk 0.1.18; exit; fi\nread hello\necho unusable >&2\nexit 1\n").unwrap();
        std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o755)).unwrap();
        for replacement in ["chosen", "installed"] {
            use_core(find(Some(bad.to_str().unwrap())).unwrap());
            assert!(crate::hc::Core::connect().is_err());
            let good = root.join(replacement);
            let hello = serde_json::json!({"result": {"selected": replacement}});
            std::fs::write(&good, format!("#!/bin/sh\nread hello\necho '{hello}'\n")).unwrap();
            std::fs::set_permissions(&good, std::fs::Permissions::from_mode(0o755)).unwrap();
            use_core(good.clone());
            let core = crate::hc::Core::connect().unwrap_or_else(|e| panic!("{replacement}: {e:#}"));
            assert_eq!(path(), good);
            assert_eq!(core.hello["selected"], replacement);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_path_keeps_shell_order_and_falls_back_to_usual_dirs() {
        let usual = [PathBuf::from("/home/test/.local/bin"), PathBuf::from("/opt/homebrew/bin")];
        let current = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let login = std::env::join_paths(["/custom/bin", "/opt/homebrew/bin", "/usr/bin"]).unwrap();
        let merged = merged_path(Some(&login), &usual, &current).unwrap();
        assert_eq!(std::env::split_paths(&merged).collect::<Vec<_>>(), ["/custom/bin", "/opt/homebrew/bin", "/usr/bin", "/home/test/.local/bin", "/bin"].map(PathBuf::from));
        let fallback = merged_path(None, &usual, &current).unwrap();
        assert_eq!(std::env::split_paths(&fallback).collect::<Vec<_>>(), ["/home/test/.local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    }

    // Fakes the binary with a shell script.
    #[cfg(unix)]
    #[test]
    fn only_a_binary_that_says_adk_counts() {
        // Runtime writes can leave a writer fd in a parallel fork, causing ETXTBSY.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/core-bin");
        assert_eq!(version(&dir.join("adk")), None);
        let real = dir.join("agentdeck-core");
        assert_eq!(version(&real).as_deref(), Some("adk 0.1.1"));
        assert_eq!(find(Some(real.to_str().unwrap())), Some(real));
    }

    #[cfg(unix)]
    #[test]
    fn bundled_core_follows_the_bundle() {
        let app_exe = Path::new("/Applications/My Apps/Deck.app/Contents/MacOS/AgentDeck");
        let expected = PathBuf::from("/Applications/My Apps/Deck.app/Contents/Helpers/AgentDeck Core.app/Contents/MacOS/agentdeck-core");
        assert_eq!(bundled_core(app_exe), Some(expected));
    }

    #[cfg(unix)]
    #[test]
    fn no_bundled_core_outside_an_app() {
        let plain_exe = Path::new("/x/target/debug/agentdeck");
        assert_eq!(bundled_core(plain_exe), None);
    }
}
