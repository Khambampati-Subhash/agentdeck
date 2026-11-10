# AgentOS plan

AgentOS is our fork of Herdr: the same desktop app and runtime, under our
name, with no link to herdr.dev, then improved. Order matters. We cut the link
before anyone uses it daily, rename before we build on it, and set up
upstream sync before the trees drift.

Each milestone is planned with `superpowers:writing-plans` when it starts
and reviewed with `/code-review high` before merge.

## P0: import and build (done 2026-11-10, merge pending)

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
- [ ] App Bun JS tests (`app/scripts/*.test.ts`): Bun isn't installed yet.
- [ ] Core's Windows clippy (`just lint`) needs the `x86_64-pc-windows-msvc` target; skip it unless we ship Windows.
- [x] Root `justfile`: `build`, `test`, `check`, `dev` (scratch home
      `/var/tmp/agentos-dev`, core session `aos`), `hc`, `dev-clean`.
      Session names stay short: macOS caps socket paths at 103 bytes.
- [ ] Merge `herdr-rewrite` to `main`.

**Done when:** a scratch-home window opens on our own build of core, shows a
shell, and closing and reopening the window keeps the shell. **Met 2026-11-10**:
the window reopened onto the same space, pane and shell, with no network sockets open.

## P1: cut the link to herdr.dev

Today the fork would update itself from upstream's servers and replace our
build, and would send usage data there. All of these go, each removal with a test:

- [ ] App self-update (`app/src/update.rs`, `HERDR_APP_RELEASE`) and the
      release-notes fetch (`update_notes.rs`, `media.herdr.dev`): off. Updates
      come only from our own builds.
- [ ] Core updates (`hc update`, `core/.../releases.rs`, `HERDR_RELEASES_URL`)
      and the app's `app.update_core`: off, or pointed at our own releases
      later.
- [ ] Telemetry (`app/src/telemetry.rs`) removed, along with the Settings → Privacy
      report and the `telemetry()` mod API. The API returns "off" so mods still load.
- [ ] Feedback upload (`feedback.rs`, `HERDR_FEEDBACK_URL`): removed, or saves
      locally.
- [ ] Setup no longer installs or upgrades core from releases
      (`setup.rs`, `core_bin.rs`); it uses the core we build.
- [ ] Install scripts and Homebrew/DMG docs that fetch from releases.herdr.dev:
      removed or rewritten for local builds.
- [ ] A test greps the shipped binaries' strings for `herdr.dev` and fails if
      any network URL is left.

**Done when:** a full app session (open, new space, split, agent status
from a fixture, settings, quit) makes no outbound connection, checked with
`nettop` or `lsof -i` during the run.

## P2: rename to AgentOS

Not a blind text replace. A `herdr`→`agentos` sed was tried on 2026-11-10 and
discarded (saved at `/var/tmp/agentos-saved/`). It broke the build (files
not renamed), pointed updates at `agentos.dev`, a domain we don't own, and rewrote
licence notices and upstream history. Rename names, files and paths together,
keep third-party text and links to upstream, and only rename after P1.

Names (defaults; change here before P2 starts):

| Upstream | AgentOS |
|---|---|
| Herdr, Herdr.app, `herdr-app` binary | AgentOS, AgentOS.app, `agentos` |
| herdr-core, `hc` | agentos-core, `aos` |
| `~/.config/herdr-app`, `~/.config/herdr-core`, `~/.herdr` | `~/.config/agentos`, `~/.config/agentos-core`, `~/.agentos` |
| `HERDR_*`, `HC_*` env vars | `AGENTOS_*`, `AOS_*` |
| `dev.herdr.app`, `dev.herdr.core` | `dev.agentos.app`, `dev.agentos.core` |
| labels `herdr.space`, `herdr.tab`, `herdr.pinned`, ... | `agentos.space`, ... |
| `herdr.d.ts`, `import ... from "herdr"` | `agentos.d.ts`, `"agentos"` (keep `"herdr"` as an alias so shared mods run) |
| Herdr 98 layout | dropped or redrawn |
| Ram logo | **done 2026-11-10**: "window stack" icon (`app/assets/icons/herdr-ui-icon-clean.svg` is the source; the `.icns`, `.ico`, PNG and welcome logo are rendered from it). File names stay `herdr-*` until this rename; the DMG background and the sidebar's "Herdr" text still need doing |

Keep as is: OSC 7501 (the status protocol agents emit; it's a number, not a
brand), the agent-detection files, crate-internal module names where renaming
only adds merge conflicts.

- [ ] Put every product name, path, env var and bundle id behind one constants
      module per half, upstream-shaped, so later merges touch one file.
- [ ] Binaries, bundle, Info.plist, icons, window title, menus, toasts.
- [ ] App home, core config and state paths. A one-time migration from an
      existing `~/.config/herdr-app` is opt-in only, never automatic.
- [ ] Product skills and guides (`SKILL.md`, `defaults/AGENTS.md`, `--skill`
      output) and the generated `.d.ts`/schema, regenerated.
- [ ] macOS bundle signs ad hoc locally; `just install` puts AgentOS.app in
      `~/Applications` and `agentos`/`aos` in `~/.local/bin`.

**Done when:** AgentOS and stock Herdr run side by side on one Mac without
seeing each other's terminals, settings or core.

## P3: our build and release

- [ ] GitHub Actions on our repo: macOS arm64 build and tests for both halves
      (adapted from upstream CI). Linux comes later if wanted.
- [ ] Versioning: `agentos-vX.Y.Z` tags. Our CHANGELOG lists our changes on
      top of the upstream versions.
- [ ] Optional: our own update channel (GitHub Releases) replacing what P1
      turned off.

## P4: upstream sync

- [ ] `docs/upstream.md`: procedure (`git subtree pull --prefix=app
      upstream-app master`, same for core), a list of every file we changed and
      why, and a log of syncs.
- [ ] `just sync-upstream`: pulls, re-runs the rename checks and tests.
- [ ] First sync done for real, with any conflicts written down.

## P5: improvements

The user picks these. Candidates, mostly as mods (Herdr's rule: if a mod can
do it, it's a mod):

- [ ] Ideas from the old AgentOS: approvals bar for blocked agents, policy
      (deny by default), token, context and cost per agent, session resume.
      Each needs a check of what OSC 7501 and `hc` already give.
- [ ] Our default layout and theme.
- [ ] Anything else from daily use: keep a list here.

## Open questions

- Final names for the binaries (`agentos` / `aos`) and the bundle id.
- macOS only, or also Linux and Windows builds?
- Keep the Win98 layout and mods, or drop them (their fonts carry their own
  licences)?
