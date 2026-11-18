//! Brand constants for AgentDeck Core.

/// Config directory name (and Windows pipe prefix).
pub const DIR: &str = "agentdeck-core";

/// State and runtime directory name. Short: macOS caps socket paths at 103
/// bytes, and the socket sits under the state dir there.
pub const STATE_DIR: &str = "adk";

/// CLI command name.
pub const CLI: &str = "adk";

/// How `--version` starts: `adk X.Y.Z`.
pub const VERSION_PREFIX: &str = "adk ";

/// Executable name.
pub const EXE: &str = "agentdeck-core";

/// Session name environment variable.
pub const SESSION_VAR: &str = "ADK_SESSION";

/// Socket path environment variable.
pub const SOCKET_VAR: &str = "ADK_SOCKET";

/// Terminal ID environment variable.
pub const TERMINAL_ID_VAR: &str = "ADK_TERMINAL_ID";

/// Terminal socket environment variable.
pub const TERMINAL_SOCKET_VAR: &str = "ADK_TERMINAL_SOCKET";

/// Compatibility terminal ID for OSC 7501 reporters.
pub const COMPAT_TERMINAL_ID_VAR: &str = "HC_TERMINAL_ID";

/// Never inherited by a terminal: the core sets its own, and Herdr's would
/// point at another core.
pub const NOT_INHERITED: &[&str] =
    &[TERMINAL_ID_VAR, TERMINAL_SOCKET_VAR, COMPAT_TERMINAL_ID_VAR, "HC_TERMINAL_SOCKET", "HC_SESSION"];

/// Bundle identifier for macOS.
pub const BUNDLE_ID: &str = "io.github.khambampati-subhash.agentdeck.core";

/// Bundle name for macOS.
pub const BUNDLE_NAME: &str = "AgentDeck Core.app";

/// Launchd temporary file prefix.
pub const LAUNCHD_TMP_PREFIX: &str = "adk-launchd-";

/// Launchd label prefix (derived from BUNDLE_ID).
pub const LAUNCHD_LABEL_PREFIX: &str = "io.github.khambampati-subhash.agentdeck.core.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launchd_label_prefix_matches_bundle_id() {
        assert_eq!(LAUNCHD_LABEL_PREFIX, format!("{BUNDLE_ID}."));
    }
}
