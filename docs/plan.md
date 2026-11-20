# AgentDeck plan

AgentDeck is our fork of Herdr: the same desktop app and runtime, under our
name, with no link to herdr.dev, then improved. Order matters. We cut the link
before anyone uses it daily, rename before we build on it, and set up
upstream sync before the trees drift.

Each milestone is planned with `superpowers:writing-plans` when it starts
and reviewed with `/code-review high` before merge.

## P0: import and build (done 2026-11-10, on `main`)

- [x] Clear the old AgentOS (Go agentd, Swift shell) on `herdr-rewrite`.
      History stays on `main` and the old branches.
- [x] Import `herdr-app` → `app/` and `herdr-core` → `core/` as git subtrees
      with full history; remotes `upstream-app`, `upstream-core`.
- [x] Ghostty submodules at the pinned commits (`app/vendor/ghostty`,
      `core/vendor/ghostty`).
- [x] Toolchain: Zig 0.16.0 in `~/.local/bin`, `just`.
- [x] `cargo build --locked` works in both halves on macOS 27.2 with Command Line Tools only
      (core 1m 36s, app 5m 19s, Rust 1.99.1, Zig 0.16.0).
- [x] App `cargo test --locked`: 398 passed, 0 failed.
- [x] Core `cargo test --locked --no-fail-fast`: 483 passed; every test passes on
      a rerun. Debugged 2026-11-10:
      - foreground.rs: two tests raced. macOS's `/bin/sh` re-execs bash, so the argv
        named the agent before it reported. Fixed by waiting for `reported`, then
        letting foreground samples pass; mutation-checked (breaking `shell_root`
        fails them).
      - m1, distribution, viewer_activity: fail only on the **first run of a freshly
        built test binary** (holder or launchd detach takes more than 10–15 s), then pass.
        That's macOS's first-launch scan of new binaries, not a code bug. Rerun, or
        add the terminal under System Settings → Privacy & Security → Developer
        Tools to skip the scan.
- [x] Core lint: `cargo fmt --check`, `cargo deny check`, `clippy -D warnings` all pass.
- [x] App Bun JS tests (`app/scripts/*.test.ts`): all 15 files pass with Bun 1.4.4
      (2026-11-19); `changes` and `notes-media` aren't in `just test`.
- [x] Core's Windows clippy (`just lint`): the `x86_64-pc-windows-msvc` target is
      installed (2026-11-19) and it passes with zig stubbed.
- [x] Root `justfile`: `build`, `test`, `check`, `dev` (scratch home
      `/var/tmp/agentos-dev`, core session `aos`), `hc`, `dev-clean`.
      Session names stay short: macOS caps socket paths at 103 bytes.
- [x] Merge `herdr-rewrite` to `main`.

**Done when:** a scratch-home window opens on our own build of core, shows a
shell, and closing and reopening the window keeps the shell. **Met 2026-11-10**:
the window reopened onto the same space, pane and shell, with no network sockets open.

## P1: cut the link to herdr.dev (merged 2026-11-16, PR #2)

On `main`; `scripts/check-offline` passes. Done-when met 2026-11-19: two
watched scratch sessions (new space, split, settings, What's new, check for
updates, quit) opened no internet socket and started no `curl`; no
`update-notes-media` was written and `agentdeck status` showed no errors.

Today the fork would update itself from upstream's servers and replace our
build, and would send usage data there. All of these go, each removal with a test:

- [x] App self-update (`app/src/update.rs`, `HERDR_APP_RELEASE`) and the
      release-notes fetch (`update_notes.rs`, `media.herdr.dev`): off. Updates
      come only from our own builds.
- [x] Core updates (`hc update`, `core/.../releases.rs`, `HERDR_RELEASES_URL`)
      and the app's `app.update_core`: off, or pointed at our own releases
      later.
- [x] Telemetry (`app/src/telemetry.rs`): no built-in endpoint; it sends only to
      a `HERDR_TELEMETRY_URL` the person sets, so the mod API still loads.
- [x] Feedback upload (`feedback.rs`): only to a `HERDR_FEEDBACK_URL` the person sets.
- [x] Setup no longer installs or upgrades core from releases
      (`setup.rs`, `core_bin.rs`); it uses the core we build.
- [x] Install scripts and Homebrew/DMG docs that fetch from releases.herdr.dev:
      removed or rewritten for local builds.
- [x] `scripts/check-offline` fails if shipped code names `herdr.dev` outside
      the reasoned entries in `scripts/offline-allow.txt`.

**Done when:** a full app session (open, new space, split, settings, What's
new, check for updates, quit) makes no outbound connection, including from
short-lived children like `curl`, checked with `scripts/watch-net`.
Detailed plan: `docs/superpowers/plans/2026-11-10-p1-offline.md`.

Found 2026-11-10: even builds from source fetch the bundled changelog's
`media.herdr.dev` images with `curl` at every start (`update_notes::started`).
The first scratch run downloaded two. The P0 "no sockets" check missed it
because it was a one-off `lsof` snapshot.

## P2: rename to AgentDeck (merged 2026-11-19, PR #3)

Not a blind text replace. A `herdr`→`agentos` sed was tried on 2026-11-10 and
discarded (saved at `/var/tmp/agentos-saved/`). It broke the build (files
not renamed), pointed updates at `agentos.dev`, a domain we don't own, and rewrote
licence notices and upstream history. Rename names, files and paths together,
keep third-party text and links to upstream, and only rename after P1.

Names (chosen 2026-11-18; the product was called AgentOS before):

| Upstream | AgentDeck |
|---|---|
| Herdr, Herdr.app, `herdr-app` binary | AgentDeck, AgentDeck.app, `agentdeck` |
| herdr-core, `hc` | agentdeck-core, `adk` |
| `~/.config/herdr-app`, `~/.config/herdr-core`, `~/.herdr` | `~/.config/agentdeck`, `~/.config/agentdeck-core`, `~/.agentdeck` |
| `HERDR_*`, `HC_*` env vars | `AGENTDECK_*`, `ADK_*` |
| `dev.herdr.app`, `dev.herdr.core` | `io.github.khambampati-subhash.agentdeck`, `….agentdeck.core` |
| labels `herdr.space`, `herdr.tab`, `herdr.pinned`, ... | kept: stored in core state |
| `herdr.d.ts`, `import ... from "herdr"` | `agentdeck.d.ts`, `"agentdeck"` (keep `"herdr"` as an alias so shared mods run) |
| Herdr 98 layout | shown as "AgentDeck 98" (2026-11-18); dropped or redrawn later |
| Ram logo | **done 2026-11-10**: "window stack" icon (`app/assets/icons/herdr-ui-icon-clean.svg` is the source; the `.icns`, `.ico`, PNG and welcome logo are rendered from it). File names stay `herdr-*` until this rename; the DMG background still needs doing |

Keep as is: OSC 7501 (the status protocol agents emit; it's a number, not a
brand), the agent-detection files, crate-internal module names where renaming
only adds merge conflicts.

- [x] Names in one `brand.rs` per half (2026-11-18). Literal paths in tests and
      guides were renamed in place.
- [x] Visible name (2026-11-18): window title, menus, toasts, setup and
      welcome text, settings, palette, sidebar, Win98 strings and
      `scripts/install-mac-app`'s bundle (`AgentDeck.app`) say AgentDeck. Keymap
      contexts, bundle paths and the welcome card about upstream's herdr TUI
      are unchanged.
- [x] Binaries (`agentdeck`, `agentdeck-core` + `adk`), bundle ids
      (`io.github.khambampati-subhash.agentdeck`, `….agentdeck.core`, ad hoc),
      Info.plist, launchd prefix. Icon file names stay `herdr-*`.
- [x] Core's runtime hints, errors and help say `adk …`, notes to agents
      are tagged `<adk>`, and core's README and docs use our names (2026-11-19).
      The docs checker had been looking for `hc` examples and so checked none.
- [x] From the P2 review, deferred (done 2026-11-19): `core_bin::ensure_core_bundle`
      removed; `just migrate` copies the install record (`installed.json`) with
      mods and layouts, so shipped mods aren't taken for edited ones (tests in
      `scripts/test_migrate_agentos.py`, run by `just check`); core's installers
      link `adk`/`adk.exe`, say `adk`, and `install.ps1` sets `ADK_SESSION` (it set
      `HC_SESSION`, which core no longer reads) and strips the `adk ` version prefix.
      Moved to P3: the app's release pipeline (`update.rs`, `scripts/package`,
      `distribution/install.sh`) still names `Herdr.app` and `herdr-app`.
- [x] App home `~/.config/agentdeck`, core config `~/.config/agentdeck-core`,
      state and sockets `~/.local/state/adk` (short: macOS caps socket paths at
      103 bytes and `agentdeck-core` overflowed it here). `just migrate` copies
      the AgentOS settings, only when run. Only `AGENTDECK_HOME`/`ADK_*` are read.
- [x] Guides (`SKILL.md`s, `defaults/AGENTS.md`, help), `agentdeck.d.ts`, CLI
      docs and schema.
- [x] `just install`: AgentDeck.app signed ad hoc in `~/Applications`,
      `agentdeck`/`adk` in `~/.local/bin`. A pre-rename core's binary is kept in
      `~/Library/Application Support/AgentOS` for its running session.
      Not yet run for real.

**Done when:** AgentDeck and stock Herdr run side by side on one Mac without
seeing each other's terminals, settings or core. `scripts/side-by-side` passes
(2026-11-18).

## P3: our build and release

- [x] Not needed: no update channel (decided 2026-11-19); upstream's `scripts/package`,
      `distribution/install.sh` and `update.rs` stay dormant.
- [x] GitHub Actions on our repo: macOS arm64 build and tests for both halves
      (adapted from upstream CI). Linux comes later if wanted.
- [x] Versioning: `agentdeck-vX.Y.Z` tags. Our CHANGELOG lists our changes on
      top of the upstream versions.
- [x] Self-contained Mac app bundle (`scripts/bundle-mac-app`, `scripts/install-mac-app`)
      with ad hoc signing. Release workflow builds a draft GitHub release from a tag.
- [x] First release (`agentdeck-v0.1.0`), published 2026-11-20.
- [x] Upstream's app docs check runs in CI and `just check`, against `agentdeck`
      (2026-11-20). `app/scripts/test_distribution.py` runs in CI only: one case fails on
      a Mac with `/Applications/Herdr.app`.
- [ ] `app/README.md` is still upstream's: herdr.dev installers, Homebrew and Windows
      installs, "telemetry is on by default", cloning herdr-app. Rewrite it for
      AgentDeck as P2 did for `core/README.md`.
- [x] Flaky under load: `mods::tests::known_agents_uses_snapshot_and_refreshes_changed_commands`
      started the person's interactive shell, which a busy machine couldn't start within the
      30 s limit (74 of 80 failed under load). It now passes a stand-in lookup and also
      checks the cache (0 of 160 under the same load), 2026-11-20.

## P4: upstream sync

- [x] `docs/upstream.md`: procedure (`git subtree pull --prefix=app
      upstream-app master`, same for core), a list of every file we changed and
      why, and a log of syncs.
- [x] `just sync-upstream`: pulls, re-runs the rename checks and tests.
- [x] First sync done for real, with any conflicts written down.

## P5: improvements

The user picks these. Candidates, mostly as mods (Herdr's rule: if a mod can
do it, it's a mod):

- [ ] Ideas from the old AgentOS: approvals bar for blocked agents, policy
      (deny by default), token, context and cost per agent, session resume.
      Each needs a check of what OSC 7501 and `hc` already give.
- [ ] Our default layout and theme.
- [ ] Anything else from daily use: keep a list here.
  - [x] Worktree spaces group under their repo even when no space is on the
        main checkout: they nest under the repo's first space (2026-11-18).
- [x] The forge loop: issue → agent → PR → merged ([plan](superpowers/plans/2026-11-15-forge-loop.md),
      spec in `docs/features.md` F13–F17). Merged to `main` 2026-11-16 (PR #1).
  - F13: issues on the Pull requests board, and **Start work** opens a worktree
    with an agent on the issue.
  - F14: a PR window Checks tab with logs, **Fix with agent** and **Re-run**.
  - F15: review comments sent to the agent on the PR's branch with **→ Agent**.
  - F16: open a pull or merge request from a worktree's branch (`propen`).
  - F17: **Clean up worktrees** removes merged or gone ones, never dirty or in-use ones.

## Open questions

- macOS arm64 only for now (decided 2026-11-19). Linux and Windows builds
  deferred.
- Keep the Win98 layout and mods, or drop them (their fonts carry their own
  licences)?
