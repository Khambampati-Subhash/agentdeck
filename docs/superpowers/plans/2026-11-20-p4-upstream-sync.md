# P4: Upstream Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulling upstream fixes into `app/` and `core/` is one command plus written conflict rules, guarded by automated checks that catch herdr.dev requests and Herdr names coming back; the first sync of both halves is done.

**Architecture:** Both halves are `git subtree` imports (`git-subtree-dir` trailers on `3f494d2` and `37d9383`), so `git subtree pull --prefix=<half> <remote> master` merges upstream with its history. A new `scripts/check-names` (sibling of `scripts/check-offline`, same allowlist format) fails when shipped code names an upstream-only name. A new `scripts/sync-upstream` does the pull on a sync branch and then runs the guards and the half's tests. `docs/upstream.md` gains the procedure, the conflict rules and a sync log. The first real sync runs core first (47 commits, 12 conflicted files in a trial merge on 2026-11-20), then the app (112 commits, 19 conflicted files), each as its own PR.

**Tech Stack:** git subtree, bash, Python 3 stdlib (unittest), just, the halves' existing Rust/Bun suites.

**Spec:** `docs/plan.md` § P4, and the rules in `CLAUDE.md` (keep upstream mergeable; never talk to herdr.dev; user-visible text says AgentDeck).

## Global Constraints

- Remotes: `upstream-app` = `https://github.com/herdrdev/herdr-app.git`, `upstream-core` = `https://github.com/herdrdev/herdr-core.git`, branch `master` for both. GitHub only; nothing reaches herdr.dev.
- Sync PRs are merged with a merge commit (`gh pr merge --merge`), never squashed or rebased: the subtree history must keep upstream's hashes.
- A sync never runs on `main`. Branches are `sync-<half>-<YYYY-MM-DD>`.
- Conflict rule: take upstream's change, then re-apply our divergence as `docs/upstream.md` describes it for that file. Our divergence wins only where it is listed there.
- Dependency changes from upstream need `just notices` in that half (app: `bun scripts/notices.ts`, core: `scripts/notices`), licences kept.
- Tests and manual runs use `AGENTDECK_HOME`/`ADK_SESSION` under `/var/tmp`. No live agent runs.
- Commits lowercase conventional (`app:`, `core:`, `repo:`); the subtree merge commit's message is `repo: sync <half> with upstream <short-sha>`.

## Review Focus

1. **Upstream adds a request to its servers under a new host or a variable URL** (not the literal `herdr.dev`), e.g. a new telemetry endpoint. `check-offline` can't see it. The sync review (Task 4, step 3; Task 5, step 4) greps the added lines for `http`, `reqwest`, `curl`, `telemetry`, `update` and the app sync repeats P1's watched session with `scripts/watch-net`.
2. **Upstream adds user-visible "Herdr" text** (a new toast, menu item, hint). Too noisy to fail on (81 "Herdr " hits today, mostly credits and comments), so `sync-upstream` prints every added line containing `Herdr` or `herdr-app`/`hc ` for review, and the review renames the visible ones (Task 3 test `report_lists_added_herdr_lines`).
3. **A conflict resolved toward upstream silently drops one of our changes** (e.g. P1's offline guard). After each sync, every file listed in `docs/upstream.md` that upstream touched is diffed against its pre-sync version and the divergence checked (Task 4, step 4; Task 5, step 4); `check-offline`, `check-names` and the suites back this up.
4. **Running `sync-upstream` with a dirty tree or on `main`** must refuse before touching anything (Task 3 tests `refuses_dirty_tree`, `refuses_main`).
5. **A sync interrupted by conflicts** must leave a normal in-progress merge and say what to do next, and `scripts/sync-upstream check <half>` must run the checks after the person commits the resolution (Task 3 tests `conflict_stops_with_files_listed`, `check_mode_runs_after_resolution`).

---

### Task 1: `scripts/check-names`, and the names it finds today

**Files:**
- Create: `scripts/check-names`, `scripts/names-allow.txt`, `scripts/test_check_names.py`
- Modify: `justfile` (`names` recipe; `check: offline names scripts`), `.github/workflows/ci.yml` (`repo` job runs `scripts/check-names` after `scripts/check-offline`)
- Modify: `app/src/update.rs` (the dormant updater's `Herdr.app` names), plus whatever else the check finds

**Interfaces:**
- Produces: `scripts/check-names` (exit 0 and `check-names: clean`, or prints each hit as `path:line:text` and exits 1 with `check-names: upstream names are back above; see scripts/names-allow.txt`). Allowlist lines are `path<TAB>exact substring<TAB>why`, the same format and matching as `scripts/offline-allow.txt`.
- Consumes: `brand::APP_BUNDLE = "AgentDeck.app"`, `brand::APP_EXE = "AgentDeck"` in `app/src/brand.rs` (added by PR #9, the CLI link fix, which must be on `main` first).

Patterns (extended regex, one alternation): `HERDR_APP_HOME`, `\bHC_(SESSION|SOCKET)\b`, `\.config/herdr-(app|core)`, `~/\.herdr\b`, `dev\.herdr\.`, `Herdr\.app`, `` `herdr-app [a-z] ``, `` `hc [a-z] ``. Paths: `app/src app/defaults app/scripts/docs.ts core/crates/herdr-core/src core/docs app/docs`; `*.md` files are included (guides users' agents read), unlike check-offline. `HC_TERMINAL_ID`/`HC_TERMINAL_SOCKET` are not in the pattern (kept on purpose for OSC 7501 reporters).

- [ ] **Step 1: Write the failing tests** in `scripts/test_check_names.py`, each building a temp git repo (`git init`, files under the checked paths, `git add`) with the script and an empty `names-allow.txt` copied into its `scripts/`, and running that copy (the script `cd`s to `$(dirname "$0")/..`, as check-offline does):
  - `test_clean_tree_passes`: a file with `AGENTDECK_HOME` only → exit 0, stdout `check-names: clean`.
  - `test_upstream_env_var_fails`: `app/src/a.rs` containing `std::env::var("HERDR_APP_HOME")` → exit 1, stdout contains `app/src/a.rs:1:`.
  - `test_allowlisted_hit_passes`: same file plus `names-allow.txt` line `app/src/a.rs\tHERDR_APP_HOME\ttest` → exit 0.
  - `test_kept_reporter_vars_pass`: `HC_TERMINAL_ID` → exit 0.
  - `test_markdown_is_checked`: `app/docs/x.md` with `` `herdr-app ls` `` → exit 1.
- [ ] **Step 2: Run** `python3 -I -B -m unittest scripts/test_check_names.py` — expect 5 errors (script missing).
- [ ] **Step 3: Implement `scripts/check-names`** (bash, modelled on `scripts/check-offline`, reading the allowlist from `$root/scripts/names-allow.txt`).
- [ ] **Step 4: Run the tests** — 5 pass.
- [ ] **Step 5: Run `scripts/check-names` on the real tree** and triage every hit. Expected today (PR #9 already fixed `app/src/core_bin/cli_link.rs`): `app/src/update.rs` (lines 2, 11, 41, 51, 57), `core/crates/herdr-core/src/SKILL.md:255`, `core/crates/herdr-core/src/platform/macos_shutdown.rs:241`.
  - `update.rs:51` `PACKED` becomes `brand::APP_BUNDLE` on macOS (the P2 plan said so; the updater is dormant). Doc comments on lines 2, 11, 41, 57 say `AgentDeck.app`.
  - `SKILL.md:255` and `macos_shutdown.rs:241` (a test-only launchd prefix): read the line; rename if it is ours to say, else allowlist with the reason.
- [ ] **Step 6: Wire it in**: `justfile` `names: scripts/check-names`, `check: offline names scripts`; CI `repo` job step `- run: scripts/check-names`. Run `just names`, `just scripts`, `cd app && cargo test --locked --bins`. Expected: clean, all pass (except the sandbox-only `terminal::tests::other_drops_are_left_alone` when run inside a Claude Code session).
- [ ] **Step 7: Note** `update.rs` in `docs/upstream.md`'s table (P4: the dormant updater names `AgentDeck.app`). Commit: `repo: check-names guards against upstream names` and `app: the dormant updater names AgentDeck.app`.

### Task 2: `docs/upstream.md` procedure and conflict rules

**Files:**
- Modify: `docs/upstream.md` (new sections `## Syncing`, `## Conflict rules`, `## Sync log`, after the existing table; the intro's "written in P4" sentence points to them)

**Interfaces:**
- Consumes: `scripts/check-names` (Task 1); `scripts/sync-upstream` usage (Task 3, below).

- [ ] **Step 1: Write `## Syncing`**: the remotes (Global Constraints), `git checkout -b sync-<half>-<date> main`, `just sync-upstream <half>`, what it does on conflicts, `scripts/sync-upstream check <half>` after resolving, the review of its added-lines report (Review Focus 1 and 2), `just notices` when lockfiles changed, a PR merged with `--merge`, then a `## Sync log` line.
- [ ] **Step 2: Write `## Conflict rules`**: the Global Constraints rule, then per-kind rules: generated files (`app/docs/commands.md`: `just docs-generate`; `THIRD-PARTY-NOTICES`: `just notices`); renamed names: keep ours and move upstream's new code onto `brand.rs` constants; files P1 changed (telemetry, feedback, update): upstream's logic, our gate; `SKILL.md`/`defaults/AGENTS.md`: upstream's new text, our names.
- [ ] **Step 3: Write `## Sync log`** as a table `| Date | Half | Upstream | Commits | Conflicts | Notes |`, empty.
- [ ] **Step 4: Check** the file renders as intended (`grep -n "^## " docs/upstream.md` shows the three new sections) and commit: `repo: upstream sync procedure`.

### Task 3: `scripts/sync-upstream` and `just sync-upstream`

**Files:**
- Create: `scripts/sync-upstream` (Python 3, stdlib only), `scripts/test_sync_upstream.py`
- Modify: `justfile` (`sync-upstream half *args: scripts/sync-upstream pull {{half}} {{args}}`)

**Interfaces:**
- Produces: `scripts/sync-upstream pull <app|core> [ref]` and `scripts/sync-upstream check <app|core>`.
  - `pull`: refuses (exit 2, message, nothing changed) when the tree is dirty or `HEAD` is `main`; adds the remote if missing (URLs from Global Constraints); `git fetch --no-tags upstream-<half> <ref, default master>`; `git subtree pull --prefix=<half> upstream-<half> <ref> -m "repo: sync <half> with upstream <short-sha>"`. On a merge conflict: prints `conflicts:` and each conflicted path, then `resolve them (docs/upstream.md#conflict-rules), commit, then: scripts/sync-upstream check <half>`, exits 1, leaves the merge in progress. On success it runs `check`.
  - `check`: prints the added-lines report, then runs `scripts/check-offline`, `scripts/check-names` and the half's suite (`core`: `cd core && just check`; `app`: `cd app && just test && just docs-check`); exit status is the first failure's. The report: every `+` line of `git diff <base>..HEAD -- <half>`, where `<base>` is the first parent of the newest commit whose subject starts with `repo: sync <half> with upstream`, that matches `herdr\.dev|https?://|reqwest|curl|telemetry|Herdr|herdr-app |\bhc ` , as `path: line`, under the heading `added lines to review:`.
  - Env `SYNC_UPSTREAM_URL` overrides the remote URL and `SYNC_UPSTREAM_SKIP_SUITES=1` skips the suites (tests use both).

- [ ] **Step 1: Write the failing tests** in `scripts/test_sync_upstream.py`. Fixture: a temp "upstream" repo with `a.txt`, a temp "ours" repo that `git subtree add --prefix=core <upstream> master`, then a branch `sync-core-test`; `check-offline`/`check-names` copied in as scripts that print `ok`.
  - `test_refuses_main`: on `main` → exit 2, `HEAD` unchanged.
  - `test_refuses_dirty_tree`: a staged, uncommitted change to `core/a.txt` → exit 2, nothing fetched.
  - `test_pulls_new_upstream_commit`: upstream commits `b.txt` → exit 0, `core/b.txt` exists, `git log -1 --format=%s` is `repo: sync core with upstream <short-sha>`.
  - `test_conflict_stops_with_files_listed`: both sides change `a.txt` line 1 → exit 1, stdout lists `core/a.txt`, `git rev-parse -q --verify MERGE_HEAD` succeeds.
  - `test_check_mode_runs_after_resolution`: after the conflict, resolve and commit, run `check core` → exit 0, stdout contains `added lines to review:`.
  - `test_report_lists_added_herdr_lines`: upstream adds `toast("Herdr is ready")` → the report contains `core/` path and `Herdr is ready`.
- [ ] **Step 2: Run** `python3 -I -B -m unittest scripts/test_sync_upstream.py` — 6 errors.
- [ ] **Step 3: Implement `scripts/sync-upstream`.**
- [ ] **Step 4: Run** the tests — 6 pass; `just scripts` — all pass.
- [ ] **Step 5: Commit**: `repo: sync-upstream pulls a half and runs the guards`. Open the P4 tooling PR (Tasks 1 to 3), `/code-review high`, merge with `--merge`.

### Task 4: First sync, core

**Files:**
- Modify: whatever upstream's 47 commits touch under `core/`; `docs/upstream.md` (table rows for any new divergence, sync log line).

**Note:** Upstream moved CLI code from `cli.rs` into `cli/run.rs` and `cli/server.rs`, so P2's `adk`/`[adk]` renames must be re-applied there by hand. Upstream's new `core/scripts/restart-core.sh` passes `HC_SESSION`/`HC_SOCKET` only (needs `ADK_SESSION`/`ADK_SOCKET`).

- [ ] **Step 1:** `git checkout -b sync-core-2026-11-20 main && just sync-upstream core`. Expected: exit 1, about 12 conflicted files (trial: `SKILL.md`, `cli.rs`, `cli/machine.rs`, `config.rs`, `platform/systemd.rs`, `remote.rs`, `tests/common/mod.rs`, `tests/foreground.rs`, `distribution/install.sh`, `docs/machines.md`, `schema/hc.openrpc.json`, `scripts/install-local.sh`).
- [ ] **Step 2:** Resolve each by the conflict rules, one file at a time, checking its `docs/upstream.md` row. If `Cargo.lock` changed, `cd core && just notices`. Commit the merge.
- [ ] **Step 3:** `scripts/sync-upstream check core`. Expected: guards clean, `just check` passes (rerun once if the first run times out on macOS's first-launch scan). Read every line of the added-lines report; rename visible `Herdr`/`hc` text to ours, and treat any new request to a server as a P1 issue (gate it or remove it, row in `docs/upstream.md`).
- [ ] **Step 4:** For each file listed in `docs/upstream.md` that upstream touched, `git diff <pre-sync main> HEAD -- <file>` and confirm our divergence is still there.
- [ ] **Step 5:** Sync log line (`2026-11-20 | core | <short-sha> | 47 | 12 | …`), commit `repo: core sync notes`, push, PR, CI green, `/code-review high`, merge with `--merge`.

### Task 5: First sync, app

**Files:**
- Modify: whatever upstream's 112 commits touch under `app/`; `docs/upstream.md`; `CHANGELOG.md` (an `## Unreleased` section naming the upstream versions now merged).

- [ ] **Step 1:** `git checkout -b sync-app-2026-11-20 main && just sync-upstream app`. Expected: exit 1, about 19 conflicted files (trial merge of 2026-11-20: `THIRD-PARTY-NOTICES`, `defaults/AGENTS.md`, `defaults/frame/palette/main.js`, `defaults/frame/settings/main.js`, `defaults/mods/{menu,toast,worktree}/main.js`, `justfile`, `scripts/{spaces,worktree}.test.ts`, `src/{SKILL.md,commands,core_bin,hc,macos,main,mod_files,mods,window}.rs`).
- [ ] **Step 2:** Resolve as in Task 4 step 2; then `cd app && just notices` and `just docs-generate`. Commit the merge.
- [ ] **Step 3:** `scripts/sync-upstream check app` and review the report as in Task 4 step 3.
- [ ] **Step 4:** Divergence check as in Task 4 step 4. Then P1's watched session on the merged build: `just dev` (scratch home `/var/tmp/agentdeck-dev`, session `adk-dev`) with `scripts/watch-net` alongside; drive `space.new`, `pane.split --direction right`, `app.settings`, `app.whats_new`, `app.check_updates`, `app.quit` with `agentdeck do`. Expected: no `NET` lines, no `curl` in `PROC` lines.
- [ ] **Step 5:** Sync log line, `CHANGELOG.md` `## Unreleased` with the new upstream versions, commit, push, PR, CI green, `/code-review high`, merge with `--merge`. Tick P4 in `docs/plan.md`, update Status in `CLAUDE.md`.
