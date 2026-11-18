# Upstream

AgentDeck is a fork of Herdr (Apache-2.0, see [NOTICE.md](../NOTICE.md)):

- `app/` is [herdr-app](https://github.com/herdrdev/herdr-app), imported with its history at `0ac92e4`.
- `core/` is [herdr-core](https://github.com/herdrdev/herdr-core), imported with its history at `ce81486`.

Both imports are subtree merges, so upstream commits keep their hashes and
authors here, and later upstream fixes can be merged in (the process is
written in P4, `docs/plan.md`).

## Upstream files we changed

As the Apache License 2.0 asks, every upstream file AgentDeck modifies is listed
here with why. Files we only added aren't upstream's and aren't listed.

| Files | Why |
| --- | --- |
| `app/assets/icons/Herdr.icns`, `herdr-app.ico`, `herdr-ui-icon-clean.png`, `herdr-ui-icon-clean.svg`, `app/defaults/frame/welcome/herdr.png` | AgentDeck's own window-stack icon instead of Herdr's logo. |
| `core/crates/herdr-core/tests/foreground.rs` | Tests wait for the agent's report before checking it is kept (flaky on macOS). |
| `app/src/update.rs`, `update_notes.rs`, `core_bin.rs`, `setup.rs`, `app/distribution/install.sh`, `install.ps1`, `app/scripts/test_distribution.py`, `core/crates/herdr-core/src/releases.rs`, `machines.rs`, `core/crates/herdr-core/tests/distribution.rs`, `update.rs`, `core/distribution/install.sh`, `install.ps1`, `core/scripts/manifest` | P1: no update checks, downloads or installers from herdr.dev unless `HERDR_RELEASES_URL` names a release server. |
| `app/src/telemetry.rs`, `feedback.rs`, `app/defaults/herdr.d.ts`, `app/defaults/frame/feedback/main.js`, `app/defaults/frame/settings/main.js` | P1: telemetry and feedback send only to an endpoint the person configures. |
| `app/defaults/layouts/main.json`, `app/defaults/mods/tabs/main.js`, `app/defaults/frame/welcome/main.js`, `app/defaults/AGENTS.md`, `app/justfile` | The Pull requests panel (`prboard`, `prdiff` mods): a third panel beside Files and Changes, its tab bar button and welcome card, the mod guide, and its tests in `just test`. |
| `app/src/mods/render_tests.rs` | The shipped-mods render test answers `gh` and `glab` (the PR panel's CLIs) as signed out. |
| `app/defaults/mods/worktree/main.js`, `app/defaults/AGENTS.md` | The worktree dialog: `task` prop and an agent picker when task is given without argv. With a `task`, a `branch` prop no longer creates the worktree on load; it waits for Enter. |
| `app/defaults/mods/menu/main.js`, `app/defaults/AGENTS.md`, `app/justfile` | The space menu's "Open pull request" on git spaces opens the `propen` dialog (also the Pull requests panel's ＋); the mod guide, and its tests in `just test`. |
| `app/defaults/mods/worktree/main.js`, `app/defaults/mods/menu/main.js`, `app/defaults/AGENTS.md` | The worktree dialog's `clean` action (its pure parts in our own `worktree/clean.js`) and the space menu's "Clean up worktrees" on git spaces, opened 560×480; the mod guide. |
| `app/defaults/mods/spaces/main.js`, `app/defaults/AGENTS.md` | With no space on a repo's main checkout, its worktree spaces nest under its first space instead of each standing alone. |
| `app/scripts/spaces.test.ts` | The git grouping test resolves its temp folder (macOS links `/var` to `/private/var`), and covers the nesting above. |
| `app/src/macos.rs`, `main.rs`, `setup.rs`, `window.rs`, `commands.rs`, `control.rs`, `keys.rs`, `feedback.rs`, `mod_files.rs`, `src/mods/render_tests.rs`, `app/defaults/frame/{welcome,settings,palette,feedback,whatsnew}/main.js`, `app/defaults/mods/{workspace-chrome,menu,machine-add,win98}/…` | P2 (started 2026-11-18): user-visible text says AgentDeck instead of Herdr. Technical names (binaries, paths, env vars, keymap contexts) are unchanged. |
| `core/distribution/macos-Info.plist`, `core/crates/herdr-core/src/platform/macos_bundle.rs`, `tests/macos.rs` | The core bundle can be `AgentDeck Core.app` (inside AgentDeck.app), and its privacy prompt names and texts say AgentDeck. `scripts/install-mac-app` builds it. |
| `core/crates/herdr-core/Cargo.toml`, `build.rs`, `src/{lib,paths,cli,cli/update,client,config,exec,machines,input,releases,templates,rpc,api/run,api/types}.rs`, `src/platform/{mod,unix,windows,systemd,macos_bundle,macos_launchd}.rs`, `src/help.txt`, `src/SKILL.md`, `skills/herdr-core/SKILL.md`, the CLI docs and schema, `scripts/mac-bundle`, `mac-sign`, `package`, `install-local.sh`, `distribution/install.sh`, `macos-signing.md`, and the tests that name them | P2 rename (2026-11-18): binary `agentdeck-core`, CLI `adk`, config `~/.config/agentdeck-core`, state and sockets `…/adk` (short for macOS's 103-byte socket limit), variables `ADK_SESSION`, `ADK_SOCKET`, `ADK_TERMINAL_ID`, `ADK_TERMINAL_SOCKET` (no fallback to `HC_*`), bundle id `io.github.khambampati-subhash.agentdeck.core` signed ad hoc, launchd `/tmp/adk-launchd-*`. Panes still get `HC_TERMINAL_ID` for OSC 7501 reporters, with `HC_TERMINAL_SOCKET` naming our socket so a stock `hc` knows the id isn't its own. Names are in our own `src/brand.rs`. Kept: crate and module names, labels, internal `HC_*` knobs, `--hc-launchd`, and `hc` in some runtime hints. |
| `app/Cargo.toml`, `THIRD-PARTY-NOTICES` (Cargo.toml hash), `src/{main,mods,core_bin,control,hc,setup,settings,window,update,macos_check,…}.rs`, `src/mods/lifecycle_tests.rs`, `src/SKILL.md`, `defaults/herdr.d.ts` → `agentdeck.d.ts`, `defaults/AGENTS.md`, `defaults/frame/{settings,welcome}/main.js`, `defaults/mods/{machine-add,win98}/…`, `tests/{commands,skill}.rs`, `tests/fixtures/core-bin/*` | P2 rename: binary `agentdeck` (a `[[bin]]`; the package stays `herdr-app`), home `~/.config/agentdeck` (`AGENTDECK_HOME`), `agentdeck.sock`, mod module `"agentdeck"` with `"herdr"` as an alias, mods' `hc()` runs the app's own core. Names are in our own `src/brand.rs`. Kept: the core document key `"herdr-app"`, icon file names. |
