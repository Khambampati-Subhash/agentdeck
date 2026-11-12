# Upstream

AgentOS is a fork of Herdr (Apache-2.0, see [NOTICE.md](../NOTICE.md)):

- `app/` is [herdr-app](https://github.com/herdrdev/herdr-app), imported with its history at `0ac92e4`.
- `core/` is [herdr-core](https://github.com/herdrdev/herdr-core), imported with its history at `ce81486`.

Both imports are subtree merges, so upstream commits keep their hashes and
authors here, and later upstream fixes can be merged in (the process is
written in P4, `docs/plan.md`).

## Upstream files we changed

As the Apache License 2.0 asks, every upstream file AgentOS modifies is listed
here with why. Files we only added aren't upstream's and aren't listed.

| Files | Why |
| --- | --- |
| `app/assets/icons/Herdr.icns`, `herdr-app.ico`, `herdr-ui-icon-clean.png`, `herdr-ui-icon-clean.svg`, `app/defaults/frame/welcome/herdr.png` | AgentOS's own window-stack icon instead of Herdr's logo. |
| `core/crates/herdr-core/tests/foreground.rs` | Tests wait for the agent's report before checking it is kept (flaky on macOS). |
| `app/src/update.rs`, `update_notes.rs`, `core_bin.rs`, `setup.rs`, `app/distribution/install.sh`, `install.ps1`, `app/scripts/test_distribution.py`, `core/crates/herdr-core/src/releases.rs`, `machines.rs`, `core/crates/herdr-core/tests/distribution.rs`, `update.rs`, `core/distribution/install.sh`, `install.ps1`, `core/scripts/manifest` | P1: no update checks, downloads or installers from herdr.dev unless `HERDR_RELEASES_URL` names a release server. |
| `app/src/telemetry.rs`, `feedback.rs`, `app/defaults/herdr.d.ts`, `app/defaults/frame/feedback/main.js`, `app/defaults/frame/settings/main.js` | P1: telemetry and feedback send only to an endpoint the person configures. |
| `app/defaults/layouts/main.json`, `app/defaults/mods/tabs/main.js`, `app/defaults/frame/welcome/main.js`, `app/defaults/AGENTS.md`, `app/justfile` | The Pull requests panel (`prboard`, `prdiff` mods): a third panel beside Files and Changes, its tab bar button and welcome card, the mod guide, and its tests in `just test`. |
| `app/src/mods/render_tests.rs` | The shipped-mods render test answers `gh` and `glab` (the PR panel's CLIs) as signed out. |
