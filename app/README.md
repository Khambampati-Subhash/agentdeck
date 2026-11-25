# AgentDeck

AgentDeck is a desktop app for terminals and coding agents. Keep work in spaces, see which agents need you, and leave terminals running when you close the window.

It is a fork of [Herdr](https://github.com/herdrdev/herdr-app) with no link to herdr.dev; see [NOTICE.md](../NOTICE.md).
Its terminals run in [AgentDeck Core](../core/README.md) (`adk`).

## Install

AgentDeck runs on macOS with Apple Silicon. There is no release server or installer script.

From a [GitHub release](https://github.com/Khambampati-Subhash/agentdeck/releases): unzip it, move AgentDeck.app into `~/Applications`, then remove macOS quarantine:

```sh
xattr -dr com.apple.quarantine ~/Applications/AgentDeck.app
```

Or [build from source](#build-from-source) and run `just install`: it puts AgentDeck.app in `~/Applications` and `agentdeck` and `adk` in `~/.local/bin`.
Add that folder to your PATH if it isn't there.

## Find your work

A **space** holds work on one machine, usually in one repo. Each space has **tabs**. Split a tab into **panes** to put terminals or mod panels beside each other.

An unnamed space follows its first terminal's folder. Name a space or tab when you want a label that stays.
New tabs start in the focused terminal's folder.

The agents sidebar brings agents from your spaces into one list, including workers started by another agent.
Agents that report status show as:

- **Working:** still busy.
- **Blocked:** waiting for you.
- **Done:** finished while you were looking elsewhere.
- **Idle:** not working, or a finished agent you have looked at.

Click an agent to see it. A worker without a pane opens in **peek**, over your tab. Keep it as a tab if you want it beside your other work.
Ctrl-click a live terminal address in terminal text to peek at it; use Cmd-click on macOS.
An address such as `t7` means a terminal on the same machine as the terminal showing it. `vps/t7` names one on another machine.

The window arranges terminals. The core runs them.
Closing the window leaves them running; closing a pane or tab ends its terminals.
After a reboot or core crash, kept panes get fresh shells in their last folders, not their old programs.

## Work on another machine

Add an SSH machine from Settings → Machines or the sidebar's Add machine action.
Pick a host from your SSH config or type how SSH reaches it.
Spaces on that machine run their terminals there, not on your computer.

Each machine keeps its spaces, tabs and splits in its core. Connected screens share that structure and the live terminals, but keep their own focus and zoom.
Remote work keeps running when your local window closes or your laptop sleeps, as long as the remote machine and core stay up.

## Make it yours

Open the command palette to find an action by name, or open Settings to change fonts, colors, sounds and other preferences.
Settings > Look also adjusts terminal line height, cell width and scroll speed. All default to 100%; layouts can override them with `terminal_line_height` (0.8–2), `terminal_cell_width` (0.8–2) and `terminal_scroll_speed` (0.1–5).
The built-in layouts include AgentDeck, Terminals and AgentDeck 98.
A **layout** arranges the window. **Mods** are small JavaScript programs that draw its panels, menus and dialogs.

Duplicate a shipped layout or mod before changing its structure or code. Your copies stay yours; AgentDeck updates the shipped ones on start.
Save a personal layout, mod or key file and the window reloads it.
A broken edit keeps the last good version and reports the error.

Cmd+Shift+P shows every command and its key. Change any key in `keys.json`; see [the keys section](defaults/AGENTS.md#keys-keysjson) of the mod guide for the format, including JSON objects for named, typed command arguments.

Cmd+A selects the terminal's whole screen and scrollback, ready for Cmd+C.
In vim and other alternate-screen apps, it selects only that screen.

[Layouts and mods](docs/mods.md) · [Commands](docs/commands.md)

## Updates and privacy

AgentDeck never checks for updates or downloads them. A new build arrives when you run `just install` again or install a newer release.

There is no telemetry or feedback upload unless you point `HERDR_TELEMETRY_URL` or `HERDR_FEEDBACK_URL` at a server of your own.
Mods are trusted code, not sandboxed extensions. Read [security and privacy](docs/security.md) before installing someone else's mod.

## For agents

```sh
agentdeck --skill
```

This prints the agent guide for driving the window. The agentdeck-core skill points agents here.
Use `adk` for running and coordinating programs; use the app to change what you see.

```sh
agentdeck ls
agentdeck status
agentdeck commands
```

The first two inspect the open window. The command list also works without one.
See the [command reference](docs/commands.md) for arguments.

## Build from source

Clone the repo with its submodules. Use Rust 1.95.0 and Zig 0.16.0, the versions used in [CI](../.github/workflows/ci.yml), and [just](https://github.com/casey/just). From the repo root:

```sh
git clone --recurse-submodules https://github.com/Khambampati-Subhash/agentdeck.git
cd agentdeck
just build
just test
just install
```

If AgentDeck or its core is running, `just install` restarts both on the new build, and their terminals end.
Documentation and mod checks also need [Bun](https://bun.sh): in `app/`, `just docs-check` checks generated pages and CLI examples, and `just docs-generate` refreshes the reference pages.

For how the project works and its rules, see the root [CLAUDE.md](../CLAUDE.md) and [AGENTS.md](../AGENTS.md).
