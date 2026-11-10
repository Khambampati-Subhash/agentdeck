# AgentOS

A desktop app for terminals and coding agents. It is our fork of Herdr:
`app/` is [herdr-app](https://github.com/herdrdev/herdr-app) (the GPUI
window) and `core/` is [herdr-core](https://github.com/herdrdev/herdr-core)
(`hc`, the runtime that keeps every terminal alive). Both are Apache-2.0;
see `NOTICE.md`.

**Status (2026-11-10):** both upstreams imported with history (app `0ac92e4`,
core `ce81486`). P0 (build and tests) is finishing; P1 cuts the link to herdr.dev. Open items are in `docs/plan.md`.
Update this line at the end of every milestone.

## Docs

- `docs/plan.md`: milestones and everything still open.
- `docs/skills.md`: which skill for which job.
- `AGENTS.md`: subagent roles and their rules.
- `docs/upstream.md`: how we pull upstream fixes (written in P4).
- Upstream's own guides, still the technical truth for their half:
  `app/AGENTS.md`, `core/AGENTS.md`, `app/defaults/AGENTS.md` (the mod and
  layout guide users' agents read), `core/crates/herdr-core/src/SKILL.md`.

## How the two halves fit

- Core runs terminals and draws nothing. The app arranges them and draws
  everything. Closing the window leaves terminals running in core.
- Agent status comes only from programs reporting OSC 7501. Never add screen
  scraping or agent-specific guessing to core.
- The app's core (model, layout documents, commands, shared mod API) stays
  small. Panels, menus, dialogs and sidebars are JavaScript mods in
  `app/defaults/mods/`. A new feature is a mod unless the app itself must act on
  it, only the app can see it, or a mod can't do it correctly.

## Rules

- Upstream's technical rules hold. That covers TDD, lean code, per-OS code
  behind small modules, files under ~32 KB, and keeping SKILL.md and
  `defaults/AGENTS.md` current with behaviour. Their governance doesn't apply
  (asking Can, PRs to `master`, Can releases, "no AI co-author lines"). Ours
  replaces it.
- Never talk to herdr.dev. No telemetry, no feedback upload, no update checks
  or downloads from upstream release servers. P1 enforces this in code; until
  then, don't run the app outside a scratch home.
- Never run the app or core against the user's real setup. Tests and manual
  runs use `HERDR_APP_HOME` and `HC_SESSION` pointing under `/var/tmp`
  (renamed in P2). Never stop, signal or restart a core you didn't start.
- No live agent runs or captures without the user's OK. Real-agent smokes
  cost money. Use fixture programs (`core/crates/herdr-core/tests/fake_tui.py`,
  `app/scripts/bench.py` fixtures).
- Keep upstream mergeable. Change upstream files only where we need to, keep
  our additions in new files or mods, and note each deliberate divergence in
  `docs/upstream.md`.
- Bind to `127.0.0.1` only. Command Line Tools only, no Xcode (GPUI builds
  with `runtime_shaders`).
- Dependency changes need `just notices` in that half, and licences kept.

## Toolchain

Rust stable (CI pins 1.95.0; 1.99 works), Zig **0.16.0** exactly
(`~/.local/bin/zig`), `just`. Bun only for the doc and mod JS tests.
After cloning: `git submodule update --init --depth 1` (Ghostty).

## Commands

- Core: `cd core && cargo build --locked`, `just check` (fmt, clippy, tests), `just test`.
- App: `cd app && cargo build --locked`, `just test` (needs Bun), `cargo test --locked`.
- After a rebuild, the first core test run can time out on macOS (first-launch
  scan of new binaries). Rerun before debugging; see P0 in `docs/plan.md`.
- Mod check: `app/target/debug/herdr-app check <mod folder>`.
- Screenshot a running scratch window: `herdr-app shot out.png`.

## Workflow

Plan item → `superpowers:writing-plans` → `superpowers:subagent-driven-development`
(TDD) → `/code-review high` → merge to `main` → update Status.
Commits are conventional and lowercase, prefixed `app:`, `core:` or `repo:` when scoped.
