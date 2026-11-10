# AgentOS plan

AgentOS is our fork of Herdr: the same desktop app and runtime, under our
name, with no link to herdr.dev, then improved. Order matters. We cut the link
before anyone uses it daily, rename before we build on it, and set up
upstream sync before the trees drift.

Each milestone is planned with `superpowers:writing-plans` when it starts
and reviewed with `/code-review high` before merge.

## P0: import and build (in progress)

- [x] Clear the old AgentOS (Go agentd, Swift shell) on `herdr-rewrite`.
      History stays on `main` and the old branches.
- [x] Import `herdr-app` → `app/` and `herdr-core` → `core/` as git subtrees
      with full history; remotes `upstream-app`, `upstream-core`.
- [x] Ghostty submodules at the pinned commits (`app/vendor/ghostty`,
      `core/vendor/ghostty`).
- [x] Toolchain: Zig 0.16.0 in `~/.local/bin`, `just`.
- [ ] `cargo build --locked` passes in `core/` and `app/` on macOS with
      Command Line Tools only.
- [ ] `just check` in core and `cargo test --locked` in app pass, or the
      failures are written down here with the reason.
- [ ] Root `justfile`: `build`, `test`, `check` for both halves;
      `dev` runs the app and core in a scratch home and session.
- [ ] Merge `herdr-rewrite` to `main`.

**Done when:** a scratch-home window opens on our own build of core, shows a
shell, and closing and reopening the window keeps the shell.

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
| Herdr 98 layout, logo, icons | dropped or redrawn |

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
