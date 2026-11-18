# P2: rename to AgentDeck (design)

Agreed 2026-11-18. Finishes P2 in `docs/plan.md` after the visible-name work
on `p2-visible-name`.

## Goal

AgentDeck and stock Herdr run side by side on one Mac without seeing each
other's terminals, settings or core. Everything a user sees or that would
collide says AgentDeck. Internal names stay upstream's, so merges stay small.

Decisions:

- Depth: rename what collides or shows. Internal knobs, crate and module
  names, labels and keymap contexts stay.
- Approach: one names module per half (`brand.rs`). Call sites read from it.
- Old AgentOS install: opt-in migration by script. Nothing moves on its own.
- Bundle ids use `io.github.khambampati-subhash` (we don't own `agentdeck.dev`).

## 1. Names

`app/src/brand.rs` and `core/crates/herdr-core/src/brand.rs` hold `const`s
only. Every name below comes from them; tests assert against `brand::`, not
literals.

| What | Now | AgentDeck |
|---|---|---|
| App binary | `herdr-app` | `agentdeck` |
| Core binary | `herdr-core`, `hc` | `agentdeck-core`, `adk` |
| App home | `~/.config/herdr-app` | `~/.config/agentdeck` |
| Core config | `~/.config/herdr-core/config.toml` | `~/.config/agentdeck-core/config.toml` |
| Core state | `~/.local/state/herdr-core/<session>` | `~/.local/state/agentdeck-core/<session>` |
| Core runtime dir | `$XDG_RUNTIME_DIR/herdr-core` | `$XDG_RUNTIME_DIR/agentdeck-core` |
| Windows pipe prefix | `herdr-core-<user>-` | `agentdeck-core-<user>-` |
| App control socket | `$HOME/herdr-app.sock` | `$HOME/agentdeck.sock` |
| Bundle ids | `dev.herdr.app`, `dev.herdr.core` | `io.github.khambampati-subhash.agentdeck`, `io.github.khambampati-subhash.agentdeck.core` |
| launchd temp jobs | `/tmp/hc-launchd-*` | `/tmp/adk-launchd-*` |
| Mod import | `"herdr"`, `herdr.d.ts` | `"agentdeck"`, `agentdeck.d.ts`; `"herdr"` stays registered as an alias |
| `TERM_PROGRAM` in panes | `herdr` | `agentdeck` |

Cargo `[[bin]]` names change; crate names don't.

Kept on purpose:

- Labels `herdr.space`, `herdr.tab`, `herdr.pinned`, ... and the core document
  key `"herdr-app"`. They are stored in core state; renaming breaks migration
  and shared mods for no visible gain. This departs from the P2 table in
  `docs/plan.md`, which gets updated.
- Crate and module names, keymap contexts, the `--hc-launchd` sentinel,
  OSC 7501.
- `macos_bundle.rs` checks for Herdr's Developer ID (`dev.herdr.core`, team
  `2W9652Q7QR`). Our builds are ad hoc, so it checks our identifier with no
  team. The plan first confirms what that check guards.

## 2. Environment variables

**Read (choosing an install): new names only, no fallback.**

| Now | AgentDeck |
|---|---|
| `HERDR_APP_HOME` | `AGENTDECK_HOME` |
| `HERDR_APP_ID` | `AGENTDECK_APP_ID` |
| `HC_SESSION` | `ADK_SESSION` |
| `HC_SOCKET` | `ADK_SOCKET` |
| `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET` (read by the client) | `ADK_TERMINAL_ID`, `ADK_TERMINAL_SOCKET` |

Old names are ignored when set. `agentdeck` started inside a stock Herdr
terminal (which has `HC_SESSION` set) still uses its own core.

**Set in panes (`api/run.rs`):**

- `ADK_SESSION`, `ADK_TERMINAL_ID`, `ADK_TERMINAL_SOCKET`.
- `HC_TERMINAL_ID` as well, same value: OSC 7501 reporters (our
  `integrations/claude-code` hook, Herdr's agent integrations) check it before
  reporting. Without it, agent status vanishes.
- `HC_TERMINAL_SOCKET` set to our socket (changed after review): without it a
  stock `hc` trusts `HC_TERMINAL_ID` as one of its own terminals. Never
  `HC_SESSION`: a stock `hc` would look for that session in Herdr's dirs.
- The Claude Code hook accepts `ADK_TERMINAL_ID` or `HC_TERMINAL_ID`.

**Unchanged:** internal knobs and test variables (`HC_QUIET_MS`,
`HC_SETTLE_MS`, `HERDR_APP_LOG`, `HERDR_TEST_*`, ...) and the variables P1 made
inert (`HERDR_RELEASES_URL`, telemetry, feedback). Documented as upstream names.

`CLAUDE.md`'s scratch rule becomes `AGENTDECK_HOME` and `ADK_SESSION` under
`/var/tmp`. The root `justfile` follows: `dev` uses the new variables and
`just hc` becomes `just adk`.

## 3. Migration and install

**`scripts/migrate-agentos`** (ours, outside upstream code):

- Copies `settings.json`, `keys.json`, `mods/` and `layouts/` from
  `~/Library/Application Support/AgentOS` to `~/.config/agentdeck`.
  `--from <dir>` imports from another home, such as stock Herdr's
  `~/.config/herdr-app`.
- Stops if the target already has settings, unless `--force`. Shows what it
  will copy and asks before writing. Never changes or deletes the source.
- A copied `settings.json` naming an old core path is pointed at the
  bundled `adk`.
- Live terminals stay in the old `agentos` core. The script prints the
  command to list or quit that core; it never stops it.
- AgentDeck never migrates by itself. A fresh home starts at the welcome screen.

**`just install`** replaces `scripts/install-mac-app`:

- Release build of both halves. Bundles `~/Applications/AgentDeck.app`
  (`io.github.khambampati-subhash.agentdeck`) with the core's own bundle
  (`io.github.khambampati-subhash.agentdeck.core`) inside. Both signed ad hoc.
- Links `agentdeck` and `adk` into `~/.local/bin`.
- Info.plist sets only `PATH`. No home or session overrides: the defaults
  are already separate from Herdr's.
- Replaces the current `AgentDeck.app` (which has the old `agentos` id) in
  place. Leaves an old `AgentOS.app` alone.
- `scripts/install-mac-app` becomes a wrapper that runs `just install`.

## 4. Testing and guides

**Unit tests, written first, in each half:**

- Paths resolve under `agentdeck-core` and `~/.config/agentdeck`;
  `ADK_SESSION`, `ADK_SOCKET` and `AGENTDECK_HOME` are honoured.
- No fallback: with only `HC_SESSION` or `HERDR_APP_HOME` set, the defaults are used.
- Pane env has `ADK_*` and `HC_TERMINAL_ID`, and lacks `HC_SESSION` and
  `HC_TERMINAL_SOCKET`.
- A mod importing `"agentdeck"` loads; one importing `"herdr"` does too.
- `core_bin` finds `adk` and `agentdeck-core`, not `hc` or `herdr-core`.
- Existing tests with old literals switch to `brand::`. A test whose
  behaviour changes is a stop-and-check, not a rewrite.

**`scripts/check-names`**, run by `just check`: scans the shipped binaries'
strings and fails on leftover collision names (`.config/herdr-app`,
`herdr-core/` paths, `dev.herdr.`, `HC_SESSION`, `HC_SOCKET`). An allowlist covers
the deliberate keeps (labels, the `"herdr"` alias, `HC_TERMINAL_ID`, credits).

**Side-by-side check** (the P2 "done when"), scripted, fixtures only:

- Sandbox `HOME` under `/var/tmp`.
- A stock `hc` core (built from the upstream subtree) and an `adk` core, both
  session `default`, each running `core/crates/herdr-core/tests/fake_tui.py`.
- Each `ls` shows only its own terminal.
- `adk` run inside the stock core's pane still reaches the `adk` core.
- No live agents. Never touches the real Herdr setup or the `agentos` core;
  stops only the cores it started.

**Guides, regenerated in the same change:** `app/src/SKILL.md`,
`core/crates/herdr-core/src/SKILL.md`, `app/defaults/AGENTS.md`, `help.txt`,
`--skill` output, the generated `agentdeck.d.ts` and schema. Ours:
`docs/upstream.md` lists every divergence, `docs/plan.md` ticks off P2 and
notes the label decision, `CLAUDE.md` gets the new commands, variables and
Status.

## Delivery

Branch `p2-rename` from `p2-visible-name`. Order: brand modules, core, app,
install and migration, guides and checks. `/code-review high` before merge.

## Out of scope

- Renaming labels, crates, modules or internal knobs.
- Moving live terminals between cores.
- Our own update channel (P3), upstream sync (P4).
- Windows and Linux packaging; their paths follow from `brand.rs` but aren't
  tested by hand.
