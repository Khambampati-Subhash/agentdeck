# AgentOS

A desktop app for terminals and coding agents: keep work in spaces, see
which agents need you, and leave terminals running when the window closes.

AgentOS is a fork of [Herdr](https://github.com/herdrdev) (Apache-2.0); see
[NOTICE.md](NOTICE.md).

- `app/`: the desktop window (Rust, GPUI, libghostty, JavaScript mods).
- `core/`: the runtime that runs and keeps every terminal (`hc`).

Build: Rust, Zig 0.16.0, `just`, then
`git submodule update --init --depth 1`, `cd core && cargo build --locked`,
`cd app && cargo build --locked`. The roadmap is [docs/plan.md](docs/plan.md).
