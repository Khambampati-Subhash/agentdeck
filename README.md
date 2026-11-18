# AgentDeck

A desktop app for terminals and coding agents: keep work in spaces, see
which agents need you, and leave terminals running when the window closes.

AgentDeck is a fork of [Herdr](https://github.com/herdrdev) (Apache-2.0); see
[NOTICE.md](NOTICE.md).

- `app/`: the desktop window (Rust, GPUI, libghostty, JavaScript mods).
- `core/`: the runtime that runs and keeps every terminal (`hc`).

What it does:

- **Spaces** hold your tabs and terminals. A git worktree's space sits under
  its repo in the sidebar: under the space on the main checkout, or under the
  repo's first space when none is open there.
- **Agents** report their status (working, needs you, done) over OSC 7501, so
  the sidebar and agent list show which one needs you. Claude Code needs the
  plugin in `integrations/claude-code/` to report.
- **Forge loop**: start an agent on an issue in its own worktree, watch its
  checks, send review comments back to it, and open the pull request.
- **Offline**: no telemetry, update checks or downloads from upstream servers.

## Build and run

You need Rust, Zig 0.16.0 and `just`. Then:

```sh
git submodule update --init --depth 1
just build          # both halves
just test           # app and core tests
just dev            # our build in a scratch home (never your real setup)
just install-app    # build a release into ~/Applications as a Mac app
```

Status and roadmap: [docs/plan.md](docs/plan.md). The rename from Herdr is
underway: the app shows AgentDeck, but binaries, paths and env vars are
still `herdr-*` until P2 finishes.

## Thanks

AgentDeck stands on [Herdr](https://github.com/herdrdev) by Can
([@ogulcancelik](https://github.com/ogulcancelik)) and its contributors.
The window (`app/`, from [herdr-app](https://github.com/herdrdev/herdr-app))
and the terminal runtime (`core/`, from
[herdr-core](https://github.com/herdrdev/herdr-core)) are their work, and this
repository keeps their full commit history. Thank you for building it in the
open and under the Apache License 2.0. If you like what's here, go star and
support the original.

AgentDeck isn't affiliated with or endorsed by the Herdr project.
