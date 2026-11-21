# Upstream

AgentDeck is a fork of Herdr (Apache-2.0, see [NOTICE.md](../NOTICE.md)):

- `app/` is [herdr-app](https://github.com/herdrdev/herdr-app), imported with its history at `0ac92e4`.
- `core/` is [herdr-core](https://github.com/herdrdev/herdr-core), imported with its history at `ce81486`.

Both imports are subtree merges, so upstream commits keep their hashes and
authors here, and later upstream fixes can be merged in. The sync procedure
is below (`## Syncing`, `## Conflict rules`, `## Sync log`).

## Upstream files we changed

As the Apache License 2.0 asks, every upstream file AgentDeck modifies is listed
here with why. Files we only added aren't upstream's and aren't listed.

| Files | Why |
| --- | --- |
| `app/assets/icons/Herdr.icns`, `herdr-app.ico`, `herdr-ui-icon-clean.png`, `herdr-ui-icon-clean.svg`, `app/defaults/frame/welcome/herdr.png` | AgentDeck's own window-stack icon instead of Herdr's logo. |
| `app/src/update.rs`, `update_notes.rs`, `core_bin.rs`, `setup.rs`, `app/distribution/install.sh`, `install.ps1`, `app/scripts/test_distribution.py`, `core/crates/herdr-core/src/releases.rs`, `machines.rs`, `core/crates/herdr-core/tests/distribution.rs`, `update.rs`, `core/distribution/install.sh`, `install.ps1`, `core/scripts/manifest` | P1: no update checks, downloads or installers from herdr.dev unless `HERDR_RELEASES_URL` names a release server. |
| `app/src/telemetry.rs`, `feedback.rs`, `app/defaults/herdr.d.ts`, `app/defaults/frame/feedback/main.js`, `app/defaults/frame/settings/main.js` | P1: telemetry and feedback send only to an endpoint the person configures. |
| `app/defaults/layouts/main.json`, `app/defaults/mods/tabs/main.js`, `app/defaults/frame/welcome/main.js`, `app/defaults/AGENTS.md`, `app/justfile` | The Pull requests panel (`prboard`, `prdiff` mods): a third panel beside Files and Changes, its tab bar button and welcome card, the mod guide, and its tests in `just test`. |
| `app/src/mods/render_tests.rs` | The shipped-mods render test answers `gh` and `glab` (the PR panel's CLIs) as signed out. |
| `app/defaults/mods/worktree/main.js`, `app/defaults/AGENTS.md` | The worktree dialog: `task` prop and an agent picker when task is given without argv. With a `task`, a `branch` prop no longer creates the worktree on load; it waits for Enter. |
| `app/defaults/mods/menu/main.js`, `app/defaults/AGENTS.md`, `app/justfile` | The space menu's "Open pull request" on git spaces opens the `propen` dialog (also the Pull requests panel's ＋); the mod guide, and its tests in `just test`. |
| `app/defaults/keys.json`, `app/defaults/keys.macos.json`, `app/defaults/AGENTS.md`, `app/justfile` | The agent inbox (`inbox` mod): Cmd-Shift-I (Ctrl-Shift-I elsewhere) opens it, the mod guide lists it, and its tests run in `just test`. |
| `app/defaults/mods/agents/main.js`, `app/scripts/agents.test.ts` | The Agents list's "Needs you" section shows its count as a badge and an inbox button (`mod.open` `inbox`), and a blocked agent's row shows its report message (`blockedMsg`, on one line) under its name. It also stamps pane-less sub-agents and publishes when each blocked one started waiting (shared `agents.blocked`) for the inbox. |
| `app/defaults/frame/palette/main.js`, `app/scripts/palette.test.ts` | The palette's "Open inbox" row (`mod.open` `inbox`, Agent group). |
| `app/defaults/mods/worktree/main.js`, `app/defaults/mods/menu/main.js`, `app/defaults/AGENTS.md` | The worktree dialog's `clean` action (its pure parts in our own `worktree/clean.js`) and the space menu's "Clean up worktrees" on git spaces, opened 560×480; the mod guide. |
| `app/defaults/mods/spaces/main.js`, `app/defaults/AGENTS.md` | With no space on a repo's main checkout, its worktree spaces nest under its first space instead of each standing alone. |
| `app/scripts/spaces.test.ts` | Covers the nesting above (upstream now resolves the temp folder itself, 2026-11-20). |
| `app/src/macos.rs`, `main.rs`, `setup.rs`, `window.rs`, `commands.rs`, `control.rs`, `keys.rs`, `feedback.rs`, `mod_files.rs`, `src/mods/render_tests.rs`, `app/defaults/frame/{welcome,settings,palette,feedback,whatsnew}/main.js`, `app/defaults/mods/{workspace-chrome,menu,machine-add,win98}/…` | P2 (started 2026-11-18): user-visible text says AgentDeck instead of Herdr. Technical names (binaries, paths, env vars, keymap contexts) are unchanged. |
| `core/distribution/macos-Info.plist`, `core/crates/herdr-core/src/platform/macos_bundle.rs`, `tests/macos.rs` | The core bundle can be `AgentDeck Core.app` (inside AgentDeck.app), and its privacy prompt names and texts say AgentDeck. `scripts/bundle-mac-app` builds it. |
| `core/crates/herdr-core/Cargo.toml`, `build.rs`, `src/{lib,paths,cli,cli/update,client,config,exec,machines,input,releases,templates,rpc,api/run,api/types}.rs`, `src/platform/{mod,unix,windows,systemd,macos_bundle,macos_launchd}.rs`, `src/help.txt`, `src/SKILL.md`, `skills/herdr-core/SKILL.md`, the CLI docs and schema, `scripts/mac-bundle`, `mac-sign`, `package`, `install-local.sh`, `distribution/install.sh`, `macos-signing.md`, and the tests that name them | P2 rename (2026-11-18): binary `agentdeck-core`, CLI `adk`, config `~/.config/agentdeck-core`, state and sockets `…/adk` (short for macOS's 103-byte socket limit), variables `ADK_SESSION`, `ADK_SOCKET`, `ADK_TERMINAL_ID`, `ADK_TERMINAL_SOCKET` (no fallback to `HC_*`), bundle id `io.github.khambampati-subhash.agentdeck.core` signed ad hoc, launchd `/tmp/adk-launchd-*`. Panes still get `HC_TERMINAL_ID` for OSC 7501 reporters, with `HC_TERMINAL_SOCKET` naming our socket so a stock `hc` knows the id isn't its own. Names are in our own `src/brand.rs`. Kept: crate and module names, labels, internal `HC_*` knobs, `--hc-launchd`. |
| `app/Cargo.toml`, `THIRD-PARTY-NOTICES` (Cargo.toml hash), `src/{main,mods,core_bin,control,hc,setup,settings,window,update,macos_check,…}.rs`, `src/mods/lifecycle_tests.rs`, `src/SKILL.md`, `defaults/herdr.d.ts` → `agentdeck.d.ts`, `defaults/AGENTS.md`, `defaults/frame/{settings,welcome}/main.js`, `defaults/mods/{machine-add,win98}/…`, `tests/{commands,skill}.rs`, `tests/fixtures/core-bin/*` | P2 rename: binary `agentdeck` (a `[[bin]]`; the package stays `herdr-app`), home `~/.config/agentdeck` (`AGENTDECK_HOME`), `agentdeck.sock`, mod module `"agentdeck"` with `"herdr"` as an alias, mods' `hc()` runs the app's own core. Names are in our own `src/brand.rs`. Kept: the core document key `"herdr-app"`, icon file names. |
| `core/crates/herdr-core/src/**` (messages, hints and clap help), `src/SKILL.md`, `core/README.md`, `core/docs/*.md`, `tests/cli_docs.rs` and the tests that check messages | P2 follow-up (2026-11-19): runtime hints, errors, `[adk]`/`adk:` prefixes and clap help say `adk`, notes to agents are tagged `<adk>…</adk>` (as SKILL.md documents), the docs checker looks for `adk` commands, and core's README and docs give our names, paths and local-build install. Code comments, temp names, `hc.run` labels and Windows' `hc.exe` are unchanged. |
| `app/src/core_bin.rs` | `ensure_core_bundle` removed: it finished upstream's bundle install for cores signed by Herdr's Apple team, which ours (ad hoc) never are. |
| `app/src/core_bin.rs` | P3 (release builds): `find` tries the core bundled inside AgentDeck.app before searching PATH. |
| `app/src/{window,setup,mods,hc,commands}.rs` | Hints the app shows say `adk` instead of `hc`. |
| `core/distribution/install.sh`, `install.ps1`, `core/crates/herdr-core/src/platform/windows.rs`, `tests/windows.rs` | The installers say `adk` and link `adk`/`adk.exe` (Windows updates keep that link); `install.ps1` sets `ADK_SESSION` and strips the `adk ` version prefix. |
| `app/scripts/docs.ts`, `scripts/docs.test.ts`, `docs/commands.md` (generated), `README.md` (the For agents examples), `docs/mods.md`, `docs/security.md` | P3 (2026-11-20): the docs checker runs `target/debug/agentdeck` with a scratch `AGENTDECK_HOME` under `/var/tmp` and checks `agentdeck` examples; the docs give `agentdeck` commands and the `~/.config/agentdeck` home. The rest of the app README is still upstream's. |
| `app/src/mods.rs` (`known_agents`) | P3 (2026-11-20): `known_agents_with` takes the installed-command lookup, so its test runs without the person's interactive shell, which a busy machine can't start within the 30 s limit. Worth offering upstream: the test flakes there too. |
| `app/src/core_bin/cli_link.rs` | The CLI link is made for `AgentDeck.app/Contents/MacOS/AgentDeck` (`brand::APP_BUNDLE`, `APP_EXE`), not `Herdr.app`, and leaves a link to stock Herdr alone (2026-11-20). |
| `app/src/update.rs` | P4: the dormant updater names AgentDeck.app (doc comments, `PACKED` const on macOS uses `brand::APP_BUNDLE`). |
| `core/crates/herdr-core/src/api/types.rs` | P4: clap help and OpenRPC schema say `adk` (not `hc`): `` `adk update` ``, `` `adk machine ls` ``, `` `adk machine rm` `` in /// docs that become clap --help text and OpenRPC method descriptions. |
| `core/crates/herdr-core/src/config.rs` | P4: config field doc says `` `adk attach` `` (not `hc attach`), shown in config documentation. |
| `core/docs/commands.md`, `core/schema/hc.openrpc.json` | P4: generated from the above (`` `just docs` `` and `HC_UPDATE_SCHEMA=1 cargo test --test m0` in core/). |
| `app/defaults/mods/worktree/main.js`, `app/defaults/AGENTS.md`, `app/src/SKILL.md`, `app/scripts/worktree.test.ts` | P4: worktrees live under `~/.agentdeck/worktrees`, not Herdr's `~/.herdr/worktrees`; since the 2026-11-20 sync that is the default of upstream's `worktrees.directory` setting. |
| `core/scripts/restart-core.sh` | P4 sync (2026-11-20): passes `ADK_SESSION` and `ADK_SOCKET` (not upstream's `HC_SESSION`/`HC_SOCKET`) through its `env -i`, so `just install` never restarts or starts a default-session core. |
| `core/crates/herdr-core/src/cli/{run,server,machine}.rs`, `src/remote/{run,put}.rs`, `src/cli/tests.rs` | P4 sync (2026-11-20): the P2 renames re-applied to code upstream moved out of `cli.rs` and `remote.rs` (`[adk]` notes, `adk …` hints, `brand::TERMINAL_ID_VAR`); `server restart --fresh` help says a terminal outside AgentDeck. |
| `app/scripts/worktree.test.ts` | Tests for our worktree dialog changes (task agent picker, `clean`, the space menu's Clean up worktrees); its harness takes the fake `exec` replies as a fourth argument after upstream's settings text and overrides (2026-11-20). |
| `app/src/core_bin.rs` | P4 sync (2026-11-20): `use_core` puts the core's folder on PATH ahead of another `adk` (`brand::CORE_CLI`, `adk.exe`/`adk.ps1` on Windows), not another `hc`, and its tests use `agentdeck-core`/`adk`. |
| `app/src/mods.rs`, `src/mods/lifecycle_tests.rs` | P4 sync (2026-11-20): mods' `hc()` still runs `core_bin::path()` (upstream now maps `hc` to `crate::core_bin::path()` inside `run_blocking` for Windows compatibility, so mods' `hc()` runs our core there too; our override in the mod `hc()` function and `exec` is kept as belt-and-braces), `known_agents_with` follows upstream's `Result`, and the synced tests load both module names through `with_modules`. |
| `app/src/{terminal,update,window,main,macos_check}.rs`, `app/defaults/{AGENTS.md,agentdeck.d.ts}`, `app/src/SKILL.md` | P4 sync (2026-11-20): upstream's new text in our names: `adk put` errors, the core's `adk ` version prefix after an app update, the default window title and file-replace errors say AgentDeck, `agentdeck check`/`status`/`do`, `checking` imported from `"agentdeck"`, and the macOS check test's launchd label uses our prefix. |
| `app/defaults/AGENTS.md` | P4 app sync: dropped upstream's note about the Herdr TUI's config.toml, which AgentDeck doesn't ship. |

## Syncing

Remotes:
- `upstream-app` = `https://github.com/herdrdev/herdr-app.git`
- `upstream-core` = `https://github.com/herdrdev/herdr-core.git`

Both track branch `master`.

Workflow:
1. Create a sync branch from main: `git checkout -b sync-<half>-<YYYY-MM-DD> main` (never run on `main`).
2. Run `just sync-upstream <half>` (where `<half>` is `app` or `core`). This runs `scripts/sync-upstream pull <half> [ref]`, which:
   - Refuses a dirty tree (tracked changes; untracked files are fine) or `main`
   - Adds the remote if missing; an existing remote is used as is
   - Runs `git fetch --no-tags upstream-<half> <ref>` (default: `master`), then `git subtree merge --prefix=<half> FETCH_HEAD`
   - On conflicts: lists the files, says "resolve them (docs/upstream.md#conflict-rules), commit, then: scripts/sync-upstream check <half>", exits 1 and leaves the merge in progress
   - On success: runs `check`
3. If conflicts occur, resolve them following the conflict rules below, then commit the merge with git's prepared message (`git commit --no-edit`). Then run `scripts/sync-upstream check <half>`.
4. The check prints "added lines to review:" (every added line mentioning herdr.dev, a URL, reqwest, curl, telemetry, Herdr, `herdr-app `, `hc `, `[hc]`, `hc:` or `herdr-core ` on the branch since it left `main`), then runs:
   - `scripts/check-offline` (fails if herdr.dev URLs come back)
   - `scripts/check-names` (fails if `HERDR_APP_HOME`, `HC_SESSION`, `HC_SOCKET`, `~/.config/herdr-app`, `Herdr.app`, `` `hc …` ``, `[hc]` hints come back; allowlist in `scripts/names-allow.txt`)
   - The half's suite: core: `cd core && just check`; app: `cd app && just test && just docs-check`
5. Review the added lines for:
   - New requests to any server (not just herdr.dev): gate it or remove it and add a row to the table above
   - New user-visible "Herdr" text: replace with AgentDeck's names
6. For app syncs, also run a watched session (`just dev` with `scripts/watch-net` alongside, see `docs/plan.md` P1) to confirm no outbound connection. `gh` → GitHub sockets are expected (the Pull requests board calls the person's signed-in `gh` at startup); only sockets or `curl` from the app or core count as a failure. To see none at all, run the session with `GH_CONFIG_DIR` pointing at an empty scratch folder.
7. If lockfiles changed, run `just notices` in that half to update `THIRD-PARTY-NOTICES`.
8. Open a PR and merge with `gh pr merge --merge` (never squash or rebase; subtree history must keep upstream's hashes).
9. Add a line to `## Sync log` below.

The subtree merge commit's message is `repo: sync <half> with upstream <short-sha>`.

`check-names` covers production code and documentation (paths in the script), but not READMEs, `*/scripts`, `*/distribution`, or `*/tests`. The sync review reads those by hand.

## Conflict rules

Take upstream's change, then re-apply our divergence as the table above describes it for that file. Our divergence wins only where it is listed there.

Per-kind rules:
- **Generated files**: regenerate them. `app/docs/commands.md`: `cd app && just docs-generate`. `core/docs/commands.md`: `cd core && just docs`. `core/schema/hc.openrpc.json`: `cd core && HC_UPDATE_SCHEMA=1 cargo test --locked --test m0`. `THIRD-PARTY-NOTICES`: `just notices` in that half.
- **Renamed names**: keep ours (`agentdeck`, `adk`, `ADK_SESSION`, …) and move upstream's new code onto the constants in `app/src/brand.rs` or `core/crates/herdr-core/src/brand.rs`.
- **Files P1 changed** (telemetry, feedback, update): upstream's logic, our gate (the env var checks P1 added).
- **`SKILL.md` and `defaults/AGENTS.md`**: upstream's new text, our names (AgentDeck, `agentdeck`, `adk`, `ADK_SESSION`, …).

## Sync log

| Date | Half | Upstream | Commits | Conflicts | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-11-20 | core | c751780 | 47 | 12 | SKILL.md, cli.rs, cli/machine.rs, config.rs, platform/systemd.rs, remote.rs, tests/common/mod.rs, tests/foreground.rs, distribution/install.sh, docs/machines.md, schema (regenerated), scripts/install-local.sh. Upstream's own foreground test fix replaced ours (row dropped). No new network requests. |
| 2026-11-20 | app | 317e673 | 112 | 20 | THIRD-PARTY-NOTICES and docs/commands.md (regenerated), defaults/AGENTS.md, frame/palette, frame/settings, mods/menu, mods/toast, mods/worktree (upstream's `worktrees.directory`, our default), justfile (+ CI's mod-test list), scripts/spaces.test.ts, scripts/worktree.test.ts, src/SKILL.md, commands.rs, core_bin.rs (PATH ordering on `adk`), hc.rs, macos.rs, main.rs, mod_files.rs, mods.rs, window.rs. Upstream's spaces test realpath replaced ours. No new requests to any server; `cargo-about` 0.9.3 for `just notices` was installed under /var/tmp. |
