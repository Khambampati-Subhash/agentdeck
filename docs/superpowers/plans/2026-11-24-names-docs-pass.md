# Names and docs pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open P3 and P4 items: `app/README.md` for AgentDeck, the names pass on text from before P4, and the `++` gap in `scripts/sync-upstream`'s report.

**Architecture:** Each fix is driven by a test that already exists for that kind of text. The `++` gap gets a case in `scripts/test_sync_upstream.py`. The names pass widens `scripts/check-names` (tested by `scripts/test_check_names.py`) so the old names fail CI, then fixes every hit. The README is checked by the app's `just docs-check`, which validates every `agentdeck` command it shows.

**Tech Stack:** bash, Python 3 unittest, Rust (doc comments that become help and schema), Markdown, Bun (app docs check).

**Spec:** `docs/plan.md`: P3 "`app/README.md` is still upstream's", P4 "Names pass for text that was already there before P4", P4 "`scripts/sync-upstream`'s report skips an added line whose content starts with `++`".

## Global Constraints

- User-visible text says AgentDeck, never Herdr or AgentOS. "Herdr" stays only where it means upstream (credits, `NOTICE.md`, links, the `"herdr"` mod alias) or is an internal name kept on purpose (crates, labels such as `herdr.space`, keymap contexts, the `herdr` module name in the d.ts).
- No herdr.dev in shipped text unless `scripts/offline-allow.txt` gives a reason.
- Keep upstream mergeable: change only the lines that need it, and list every upstream file touched in `docs/upstream.md`'s table.
- `core/schema/released.openrpc.json` is a frozen snapshot of the released protocol: never edit it.
- Internal names stay: `.herdr-shot-<pid>.png` temp file, `HERDR_TELEMETRY*` env vars, `herdr.*` labels.
- Commits: conventional, lowercase, `repo:`, `app:` or `core:` prefix.

## Review Focus

1. A diff line `+++` inside a hunk (content `++x`) taken for a file header: the report must keep the current file name and print the line. Task 1 tests it.
2. A content line `++ b/evil` must not change the file the next lines are reported under. Task 1 tests it.
3. A new check-names pattern matching an internal name kept on purpose (`herdr.space`, `"herdr"` alias, `herdr-core` crate path): `check-names` must stay clean on the real tree after the fixes. Task 2 runs it.
4. The README showing a command or flag `agentdeck` doesn't have: `just docs-check` must pass. Task 3 runs it.
5. Changing the `agentdeck shot` default breaking a test or the guides' wording: app tests (`cargo test --locked` for `control` and `tests/skill.rs`) must pass. Task 2 runs them.

---

### Task 1: sync-upstream reports added lines that start with `++`

**Files:**
- Modify: `scripts/sync-upstream` (the loop after `print("added lines to review:")`)
- Test: `scripts/test_sync_upstream.py`

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing test** `test_report_lists_added_lines_starting_with_plus_plus`, modelled on `test_report_lists_added_herdr_lines`: upstream adds a file `app/x.c` whose lines are `++Herdr;` then `++ b/other.c Herdr` then `Herdr tail`. Assert the check's stdout contains `app/x.c: ++Herdr;`, `app/x.c: ++ b/other.c Herdr` and `app/x.c: Herdr tail` (the last proves the file name didn't change).
- [ ] **Step 2: Run it and see it fail**
  Run: `python3 -I -m unittest scripts/test_sync_upstream.py -k plus_plus -v`
  Expected: FAIL, `app/x.c: ++Herdr;` missing.
- [ ] **Step 3: Fix the parser.** Track whether the loop is inside a hunk: a `diff --git` line starts a file's header (not in a hunk); `+++ b/` and `+++ /dev/null` set the file only in the header; a `@@` line enters the hunk; inside a hunk every `+` line is content (strip one `+`). Update the stale comment.
- [ ] **Step 4: Run the whole file**
  Run: `python3 -I -m unittest scripts/test_sync_upstream.py -v`
  Expected: all PASS.
- [ ] **Step 5: Commit** `repo: sync-upstream reports added lines starting with ++`

### Task 2: check-names catches the pre-P4 names, and they're fixed

**Files:**
- Modify: `scripts/check-names` (`paths`, `pattern`), `scripts/names-allow.txt`
- Test: `scripts/test_check_names.py`
- Fix hits in: `core/crates/herdr-core/src/SKILL.md` (lines 205, 310, 318), `core/crates/herdr-core/src/config.rs:17-18`, `core/crates/herdr-core/src/machines.rs:24-33`, `client.rs:22`, `api/types.rs:155`, the source of the `"…on the hc socket…"` schema description, regenerated `core/schema/hc.openrpc.json` and `core/docs/*` (`cd core && just docs`), `app/defaults/agentdeck.d.ts:358`, `app/defaults/frame/settings/main.js:631`, `app/src/control.rs:80`, `app/src/main.rs:57`, `app/src/SKILL.md` (119, 152, 186, 194), `app/defaults/AGENTS.md`, `docs/upstream.md`

**Interfaces:** Task 3 relies on `app/README.md` being in check-names' `paths`.

- [ ] **Step 1: Write the failing tests** in `scripts/test_check_names.py`, one per pattern, each writing one file and asserting `returncode == 1` and the line in stdout:
  - `test_hc_tag_fails`: `core/crates/herdr-core/src/a.rs` with `/// \`<hc>\` tags`.
  - `test_hc_word_in_schema_fails`: `core/schema/hc.openrpc.json` with `"The hc session there"`; and `test_released_schema_ignored`: the same text in `core/schema/released.openrpc.json` passes.
  - `test_upstream_shot_name_fails`: `app/src/a.rs` with `unwrap_or("herdr-shot.png")`; `test_shot_temp_name_passes`: `format!(".herdr-shot-{}.png", id)` passes.
  - `test_agentos_fails`: `app/defaults/a.d.ts` with `(AgentOS has none)`.
  - `test_to_hc_version_fails`: `app/defaults/a.js` with `` ` to hc ${v}` ``.
  - `test_herdr_word_in_guides_fails`: `app/defaults/AGENTS.md` with `# Herdr app`; `app/README.md` with `Quit and reopen Herdr`; `test_herdr_word_in_code_passes`: `app/src/a.rs` with `// like Herdr` passes (code stays out of this rule); `test_herdr_label_in_guide_passes`: `app/defaults/AGENTS.md` with `` `herdr.space=<id>` `` passes (lowercase is a label).
- [ ] **Step 2: Run them and see them fail**
  Run: `python3 -I -m unittest scripts/test_check_names.py -v`
  Expected: the new `_fails` tests FAIL.
- [ ] **Step 3: Widen check-names.** Add `core/schema/hc.openrpc.json` and `app/README.md` to `paths` (the released snapshot stays out). Add to the pattern: `<hc>`, `herdr-shot\.png` (not preceded by `.herdr-shot-`, so match `[^.-]herdr-shot\.png|^herdr-shot\.png` or the quoted/backticked forms), `AgentOS`, `to hc \$`, `\bhc\b` limited to the schema file, and capital `Herdr` limited to the guide files (`app/defaults/AGENTS.md`, `app/src/SKILL.md`, `core/crates/herdr-core/src/SKILL.md`, `app/README.md`). Path-limited rules need a second `git grep` over those files; keep one loop over hits for the allowlist.
- [ ] **Step 4: Run the tests**
  Run: `python3 -I -m unittest scripts/test_check_names.py -v`
  Expected: all PASS.
- [ ] **Step 5: Run it on the real tree and see the hits**
  Run: `scripts/check-names`
  Expected: FAIL, listing the lines above.
- [ ] **Step 6: Fix every hit.**
  - "Herdr" meaning this app becomes "AgentDeck" ("the AgentDeck app", "AgentDeck's", "Herdr 98" → "AgentDeck 98", main layout "AgentDeck"); `<hc>` → `<adk>`, "hc" → "adk" in the doc comments; default shot file `agentdeck-shot.png`; Settings says `to adk ${version}`; d.ts "AgentDeck has none".
  - Where "Herdr" means upstream, keep it and add an allow line with the reason: "mods written for Herdr load unchanged", "Existing Herdr.app grants" (already allowed), and any sentence comparing with stock Herdr.
  - The herdr.dev share section ("Layouts and mods other people made"): drop the herdr.dev gallery, its URLs and the `herdr-layout`/`herdr-mod` topics; keep the steps for adding one from a folder or GitHub repo, and say to share one as a public GitHub repo with `RECIPE.md` and `preview.png`.
  - Regenerate core's docs and schema: `cd core && just docs`.
- [ ] **Step 7: Verify**
  Run: `scripts/check-names && scripts/check-offline && just scripts`
  Expected: `check-names: clean`, offline clean, script tests PASS.
  Run: `cd core && just docs-check && cargo test --locked -p herdr-core --lib config`
  Run: `cd app && cargo test --locked control && cargo test --locked --test skill && cargo test --locked commands settings`
  Expected: PASS (`commands`/`settings` hold tests that read `defaults/AGENTS.md`).
- [ ] **Step 8: Record the divergence.** Add one row to `docs/upstream.md`'s table naming every upstream file changed here and why ("names pass for pre-P4 text"). Commit as `app: our names in guides and pre-p4 text` and `core: …` (one commit per half, plus `repo:` for scripts).

### Task 3: app/README.md for AgentDeck

**Files:**
- Modify: `app/README.md`
- Test: `cd app && just docs-check` (checks every `agentdeck` command and flag in it), `scripts/check-names` (Task 2 added the README)

**Interfaces:** consumes Task 2's check-names coverage of `app/README.md`.

- [ ] **Step 1: Run the checks on the old README to see what they catch.** `scripts/check-names` should list the README's "Herdr" lines.
- [ ] **Step 2: Rewrite it**, the way P2 rewrote `core/README.md`:
  - Title `# AgentDeck`; one line that it is a fork of [Herdr](https://github.com/herdrdev/herdr-app) with no link to herdr.dev (see `NOTICE.md`).
  - **Install:** no release server or installers. Either a GitHub release of this repo (unzip, move AgentDeck.app to `~/Applications`, `xattr -dr com.apple.quarantine ~/Applications/AgentDeck.app`, as in CHANGELOG 0.1.0), or build from source and `just install` (AgentDeck.app in `~/Applications`, `agentdeck` and `adk` in `~/.local/bin`). macOS Apple Silicon only. Drop Linux, Windows, Homebrew, DMG and the shell/PowerShell installers.
  - Keep "Find your work", "Work on another machine", "Make it yours", "For agents" with AgentDeck names (layouts: AgentDeck, Terminals, AgentDeck 98; "AgentDeck updates the shipped ones on start"; "the agentdeck-core skill").
  - **Updates and privacy:** no update checks or downloads; a new build arrives by `just install` or a new release. No telemetry or feedback upload unless the person sets `HERDR_TELEMETRY_URL` / `HERDR_FEEDBACK_URL`. Keep the mods-are-trusted-code line.
  - **Build from source:** clone this repo with submodules, Rust 1.95.0 and Zig 0.16.0 (as CI), `just build`, `just test`, `just install` from the repo root; Bun for `just docs-check`. Keep the bench section but say `adk` on PATH. Point contributors to the root `CLAUDE.md`/`AGENTS.md` instead of upstream's CONTRIBUTING.
- [ ] **Step 3: Verify**
  Run: `scripts/check-names && scripts/check-offline && (cd app && just docs-check)`
  Expected: all clean/PASS.
- [ ] **Step 4: Bookkeeping and commit.** Add `app/README.md` to Task 2's `docs/upstream.md` row. Tick the three items in `docs/plan.md`; add an open P4 item: "`telemetry.rs`, `feedback.rs` and the d.ts still read `HERDR_TELEMETRY`, `HERDR_TELEMETRY_URL` and `HERDR_FEEDBACK_URL`; P2 said only `AGENTDECK_*` are read." Add a CHANGELOG "Unreleased" line ("**Names**: the app's README, guides and help say AgentDeck and `adk`; `agentdeck shot` saves `agentdeck-shot.png` by default."). Commit `app: readme for agentdeck` and `repo: names and docs pass plan, changelog and status`.
