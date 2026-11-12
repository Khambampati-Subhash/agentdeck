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
