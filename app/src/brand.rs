//! AgentDeck's names where they differ from Herdr's.

/// The module mods import; `"herdr"` stays an alias so Herdr's mods load.
pub const MODULE: &str = "agentdeck";
pub const MODULE_ALIAS: &str = "herdr";

/// The macOS app bundle and the executable inside it (`scripts/bundle-mac-app`).
pub const APP_BUNDLE: &str = "AgentDeck.app";
pub const APP_EXE: &str = "AgentDeck";

/// The core's command line, beside `agentdeck-core`.
pub const CORE_CLI: &str = "adk";

/// How the core's `--version` starts.
pub const CORE_VERSION_PREFIX: &str = "adk ";
