# P3: Our Build and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions tests both halves on macOS arm64 on every push and PR, and pushing an `agentdeck-vX.Y.Z` tag builds an ad hoc signed `AgentDeck.app` zip and attaches it to a draft GitHub Release.

**Architecture:** A downloaded `AgentDeck.app` must work without `just install`, so the app learns to find the core bundled inside it. `scripts/install-mac-app` is split: a new `scripts/bundle-mac-app` builds a self-contained bundle with no `$HOME` paths baked in, and install-mac-app adds the per-machine parts on top. One root `VERSION` file and a root `CHANGELOG.md` define a release, and `scripts/release-check` checks a tag against both. Workflows live in the root `.github/workflows/`. GitHub ignores the subtree copies in `app/.github` and `core/.github`, which stay untouched.

**Tech Stack:** GitHub Actions (macos-15, ubuntu-latest), bash, Python 3 stdlib (unittest), Rust 1.95.0, Zig 0.16.0, Bun 1.4.4, `codesign`, `ditto`, `gh`.

**Spec:** `docs/plan.md` § P3, plus the decisions of 2026-11-19: macOS arm64 only; no update channel (the app's updater stays dormant unless `HERDR_RELEASES_URL` is set); a tag makes CI build a draft release.

## Global Constraints

- macOS arm64 only. No Linux or Windows jobs. Core's Windows clippy still runs in the lint job (zig stubbed), as upstream does.
- Rust `1.95.0`, Zig `0.16.0`, Bun `1.4.4`. Pin actions by commit SHA, using the SHAs already in `app/.github/workflows/ci.yml` and `core/.github/workflows/ci.yml`.
- Tags are `agentdeck-vX.Y.Z`. `VERSION` holds `X.Y.Z`. The first release is `0.1.0`.
- Ad hoc signing only (`codesign --sign -`). No Apple certificates, no notarization.
- Nothing in a workflow, script or artifact may reach herdr.dev. `scripts/check-offline` runs in CI.
- Never touch the person's real setup. Tests write under `/var/tmp` or `$RUNNER_TEMP`.
- Upstream files change only where needed, and each one is listed in `docs/upstream.md`.
- Commits are lowercase conventional: `app:`, `core:`, `repo:`.

## Review Focus

1. **The app is moved, renamed or under a path with spaces** (`/Applications/My Apps/AgentDeck.app`). It still finds its own core. Test in Task 1: `bundled_core_follows_the_bundle`.
2. **A tag that doesn't match `VERSION`, or a CHANGELOG with no section for it.** The release fails before building anything, with a message naming the mismatch. Tests in Task 3.
3. **A release bundle carrying the CI runner's paths** (`/Users/runner`) in its plist or settings. Compiled binaries can hold build paths in panic messages, which is harmless. The bundle's non-executable files have no home path. Test in Task 2: `no_home_paths_in_the_bundle`.
4. **The zip breaks the signature** (symlinks or extended attributes lost). The workflow unzips its own artifact and runs `codesign --verify --deep --strict` on it before uploading (Task 5, step 2).
5. **A downloaded app is quarantined, and Gatekeeper refuses an ad hoc signed app.** The release notes and README give the exact `xattr -dr com.apple.quarantine` command (Task 6).

---

### Task 1: The app finds the core bundled inside it

**Files:**
- Modify: `app/src/core_bin.rs` (`find`, plus a new `bundled_core`)
- Test: `app/src/core_bin.rs` `mod tests`

**Interfaces:**
- Produces: `fn bundled_core(exe: &Path) -> Option<PathBuf>`. For `<X>.app/Contents/MacOS/<exe>`, it returns `<X>.app/Contents/Helpers/AgentDeck Core.app/Contents/MacOS/agentdeck-core`. Returns `None` when `exe` isn't inside an `.app`.
- `find(configured)` tries, in order: the configured core, then `bundled_core(current_exe().canonicalize())` (macOS only), then today's PATH, usual dirs and login shell. `HERDR_CORE_DIRS` still replaces everything after the configured core, so tests stay hermetic.

- [ ] **Step 1: Write the failing tests** (`#[cfg(unix)]`):
  - `bundled_core_follows_the_bundle`: `bundled_core(Path::new("/Applications/My Apps/Deck.app/Contents/MacOS/AgentDeck"))` returns `Some("/Applications/My Apps/Deck.app/Contents/Helpers/AgentDeck Core.app/Contents/MacOS/agentdeck-core")`.
  - `no_bundled_core_outside_an_app`: `bundled_core(Path::new("/x/target/debug/agentdeck"))` returns `None`.
- [ ] **Step 2: Run** `cd app && cargo test --locked bundled_core`. Expected: FAIL to compile, because `bundled_core` isn't defined.
- [ ] **Step 3: Implement `bundled_core`** (pure path logic: the grandparent's extension is `app`), and call it in `find` as described above. Gate the call with `cfg!(target_os = "macos")`. A candidate still counts only if `version()` answers.
- [ ] **Step 4: Run** `cd app && cargo test --locked core_bin`. Expected: all pass.
- [ ] **Step 5: Commit** `app: find the core bundled inside AgentDeck.app`, and add a `docs/upstream.md` row for `app/src/core_bin.rs`.

### Task 2: `scripts/bundle-mac-app` builds a self-contained bundle

**Files:**
- Create: `scripts/bundle-mac-app`, `scripts/test_bundle_mac_app.py`
- Modify: `scripts/install-mac-app` (calls bundle-mac-app, then does only the per-machine parts)

**Interfaces:**
- Produces: `scripts/bundle-mac-app --app-bin PATH --core-bin PATH --version X.Y.Z OUT_DIR`. It writes `OUT_DIR/AgentDeck.app` (removing any old one first) containing:
  - `Contents/MacOS/AgentDeck` (copied from `--app-bin`)
  - `Contents/Helpers/AgentDeck Core.app` (from `core/scripts/mac-bundle`, signed ad hoc)
  - `Contents/Resources/AgentDeck.icns` (from `app/assets/icons/Herdr.icns`)
  - `Contents/Info.plist`: today's keys from install-mac-app, with `CFBundleShortVersionString` = `--version`, `CFBundleVersion` = `--version`, and an empty `LSEnvironment`
  
  The whole bundle is signed ad hoc. It exits 2 on usage errors and 1 if a binary is missing or not executable.
- install-mac-app keeps its interface (`[--no-build]`). It builds, runs `bundle-mac-app` into a staging folder under `$HOME/Applications`, then:
  - keeps today's pre-rename core move
  - adds the `LSEnvironment` keys (`PATH`, and `AGENTDECK_HOME` if set)
  - re-signs, swaps the bundle in, writes settings, registers with lsregister, links `agentdeck` and `adk`
  
  The swap must not interrupt a running copy. Move the old bundle aside, then move the new one in, as today's core swap does.

- [ ] **Step 1: Write the failing tests** (`scripts/test_bundle_mac_app.py`). The fake binaries are shell scripts: the core prints `adk 0.1.19` for `--version`. Each test works in a temp dir under `/var/tmp` and is skipped unless `sys.platform == "darwin"`.
  - `test_builds_a_signed_bundle`: `codesign --verify --deep --strict OUT/AgentDeck.app` succeeds, and both executables exist.
  - `test_version_in_info_plist`: `plistlib` reads `CFBundleShortVersionString == "0.1.0"`, `CFBundleIdentifier == "io.github.khambampati-subhash.agentdeck"` and `CFBundleExecutable == "AgentDeck"`.
  - `no_home_paths_in_the_bundle`: run with `HOME` set to a temp dir. No file outside `Contents/MacOS` contains that dir's bytes, and `LSEnvironment == {}`.
  - `test_missing_binary_fails`: a nonexistent `--core-bin` exits 1 and writes no bundle.
  - `test_replaces_an_old_bundle`: running twice leaves one valid bundle.
- [ ] **Step 2: Run** `python3 -I -B -m unittest discover -s scripts -p 'test_bundle_mac_app.py'`. Expected: FAIL, because the script is missing.
- [ ] **Step 3: Implement `scripts/bundle-mac-app`** (bash, `set -euo pipefail`), moving the bundle-building parts of install-mac-app into it, then slim install-mac-app down to the per-machine parts listed above.
- [ ] **Step 4: Run** `just scripts`. Expected: OK. Then check install on a scratch home: `HOME=/var/tmp/adk-p3-home scripts/install-mac-app --no-build`, after a `cargo build --release` of both halves. Then `codesign --verify --deep --strict /var/tmp/adk-p3-home/Applications/AgentDeck.app`. Expected: valid. Never run install against the real `$HOME` in tests.
- [ ] **Step 5: Commit** `repo: bundle-mac-app builds a self-contained AgentDeck.app`.

### Task 3: One version, a changelog, and `scripts/release-check`

**Files:**
- Create: `VERSION` (`0.1.0`), `CHANGELOG.md`, `scripts/release-check`, `scripts/test_release_check.py`
- Modify: `justfile` (recipes `version` and `tag`)

**Interfaces:**
- `CHANGELOG.md` starts with `# AgentDeck changelog`. Each release is `## agentdeck-vX.Y.Z (YYYY-MM-DD)`, then a line `On herdr-app A.B.C and herdr-core D.E.F.`, then bullets. `0.1.0` lists P0–P2, the forge loop (F13–F17), and the worktree nesting.
- Produces: `scripts/release-check TAG [--notes FILE]` (Python 3 stdlib). It checks that:
  - `TAG` matches `^agentdeck-v\d+\.\d+\.\d+$`
  - its version equals `VERSION` (stripped)
  - `CHANGELOG.md` has a section headed `## TAG`
  
  With `--notes`, it writes that section's body (up to the next `## `) to `FILE`. Exit 0 if OK, 1 with a one-line reason naming what mismatched. `--root DIR` (default: the repo) lets tests point it elsewhere.
- `just version` prints `VERSION`. `just tag` runs `release-check agentdeck-v$(cat VERSION)`, requires a clean tree on `main`, then creates the annotated tag locally. It never pushes. Pushing is a separate, deliberate `git push origin <tag>`.

- [ ] **Step 1: Write the failing tests** (`scripts/test_release_check.py`, temp roots under `/var/tmp`):
  - `test_matching_tag_passes_and_writes_notes`: the notes file equals the section body.
  - `test_tag_not_matching_version_fails`: `VERSION` is 0.1.0 and the tag is `agentdeck-v0.2.0`. Exit 1, and stderr contains `VERSION says 0.1.0`.
  - `test_missing_changelog_section_fails`: stderr contains `no "## agentdeck-v0.1.0" in CHANGELOG.md`.
  - `test_bad_tag_shape_fails`: `v0.1.0` and `agentdeck-v0.1` exit 1.
  - `test_the_repo_itself_passes`: `release-check agentdeck-v$(cat VERSION)` on the real repo exits 0.
- [ ] **Step 2: Run** `just scripts`. Expected: FAIL, because the script is missing.
- [ ] **Step 3: Implement** `scripts/release-check`, `VERSION`, `CHANGELOG.md` and the two recipes.
- [ ] **Step 4: Run** `just scripts`. Expected: OK.
- [ ] **Step 5: Commit** `repo: version, changelog and release-check`.

### Task 4: CI on every push and PR

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Triggers: `push` to `main`, `pull_request`, `workflow_dispatch`. `permissions: contents: read`. Concurrency cancels superseded PR runs.
- Env:
  - `RUST_TOOLCHAIN: 1.95.0`, `ZIG_VERSION: 0.16.0`
  - `CARGO_PROFILE_DEV_DEBUG: "1"`, `CARGO_PROFILE_TEST_DEBUG: "1"`, `CARGO_INCREMENTAL: "0"`
  - `HC_TEST_WATCHDOG_S: "120"`, `HC_TEST_SLOW_RUNNER: "1"`
- Jobs:
  - `repo` (ubuntu-latest): `scripts/check-offline`, and the script tests other than the darwin-only bundle tests, which skip themselves.
  - `core-lint` (ubuntu-latest): exactly core's upstream `lint` job, with `working-directory: core`.
  - `core-test` (macos-15): submodules, Rust, Zig, rust-cache (`workspaces: core -> target`), `cargo clippy --locked --all-targets -- -D warnings`, then the tests with core's upstream macOS selection (every `tests/*.rs` except `stitch`, plus `--lib --bins`, `--test-threads 2`).
  - `app-test` (macos-15): submodules, Rust, Zig, Bun 1.4.4 (`oven-sh/setup-bun`, pinned by SHA), rust-cache (`workspaces: app -> target`), `bun test` with the files `app/justfile`'s `test` lists, then `cargo test --locked --config 'profile.dev.package."*".opt-level=0'` with upstream's macOS selection (every `tests/*.rs` except `shot_pixels`, plus `--bins`).
  - `ci-ok` (ubuntu-latest): `needs` all four, `if: always()`, fails unless each result is `success`.
- Caches save only on `main` pushes, as upstream does.

- [ ] **Step 1: Write the workflow.** Validate it locally with `actionlint` from its release binary (`go install` isn't needed: download the darwin-arm64 tarball into `/var/tmp`). Expected: no findings.
- [ ] **Step 2: Push the branch and open a PR.** Run: `gh pr checks --watch`. Expected: all five jobs pass. If `app-test` hits macOS-runner-only failures, compare with upstream's own skips before changing a test. Note each skip in the workflow with its reason.
- [ ] **Step 3: Commit** `repo: ci for both halves on macos arm64` (with fixups as needed from step 2).

### Task 5: The release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `scripts/release-check` (Task 3), `scripts/bundle-mac-app` (Task 2).
- Triggers: `push: tags: ['agentdeck-v*']`, and `workflow_dispatch` (a dry run: everything except creating the release). `permissions: contents: write` only on the job that creates the release.
- Steps on macos-15:
  1. `scripts/release-check "$TAG" --notes "$RUNNER_TEMP/notes.md"`. For a dispatch, `TAG` is `agentdeck-v$(cat VERSION)`.
  2. Build both halves with `cargo build --release --locked`, run `scripts/bundle-mac-app` into `$RUNNER_TEMP/out`, then `ditto -c -k --keepParent AgentDeck.app AgentDeck-<X.Y.Z>-macos-arm64.zip`. Unzip it into a fresh folder and run `codesign --verify --deep --strict` there. Then write `SHA256SUMS` with `shasum -a 256`.
  3. Upload both files as a workflow artifact (always).
  4. Only on a tag push: `gh release create "$TAG" --draft --title "AgentDeck <X.Y.Z>" --notes-file "$RUNNER_TEMP/notes.md" <zip> SHA256SUMS`.

- [ ] **Step 1: Write the workflow;** `actionlint` passes.
- [ ] **Step 2: Dry run** after merge: `gh workflow run release.yml`, then `gh run watch`. Expected: success, with the artifact holding the zip and `SHA256SUMS`. Download it to `/var/tmp/adk-p3-dl`. `codesign --verify --deep --strict` passes. Launch `AgentDeck.app/Contents/MacOS/AgentDeck` with `AGENTDECK_HOME=/var/tmp/adk-p3-dl/home ADK_SESSION=adk-p3`: `agentdeck status` shows no errors, and the window has a shell (the bundled core was found with no settings). Stop that core with `ADK_SESSION=adk-p3 …/agentdeck-core server stop`.
- [ ] **Step 3: Commit** `repo: release workflow builds a draft release from a tag`.

### Task 6: Docs and the first release

**Files:**
- Modify: `README.md` (Install: build from source with `just install`, or download a release, then `xattr -dr com.apple.quarantine ~/Applications/AgentDeck.app` and optionally `ln -s ~/Applications/AgentDeck.app/Contents/Helpers/"AgentDeck Core.app"/Contents/MacOS/agentdeck-core ~/.local/bin/adk`), `CHANGELOG.md` (the same quarantine line at the top of each release's notes), `docs/plan.md` (tick P3; replace the "app's release pipeline under our names" item with "not needed: no update channel; upstream's `scripts/package`, `distribution/install.sh` and `update.rs` stay dormant"), `docs/upstream.md` (rows for Task 1 and for `scripts/install-mac-app`), `CLAUDE.md` (Commands: `just tag`, releases; Status).

- [ ] **Step 1: Write the docs above.** Run `just check`. Expected: as before (the known `TemporaryItems` test aside).
- [ ] **Step 2: Commit** `repo: p3 docs`, open the PR, merge after review.
- [ ] **Step 3: First release, only with the user's OK** (it publishes): `just tag`, then `git push origin agentdeck-v0.1.0`, then `gh run watch`. Expected: a draft release with the zip and `SHA256SUMS`. The user publishes it.

**Done when:** a PR runs green CI on macOS arm64, and a pushed `agentdeck-v0.1.0` tag yields a draft release whose zip, once downloaded, opens AgentDeck on its own bundled core.
