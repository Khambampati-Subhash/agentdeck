# Security and privacy

## Mods have your access

A mod is trusted JavaScript running inside AgentDeck. It can run programs with your environment, fetch URLs and read files.
The built-in file API limits writes to the app home, but a mod can run a program to write elsewhere. That is not a security boundary.
Mods can also run programs on connected machines.

There is no permission prompt for each program or network request. Read a mod before installing it, and treat it like a shell script you would run yourself.
Layouts can load mods. Check those references too.

## What stays on disk

The default app home is `~/.config/agentdeck`, including on macOS and Windows (under your user home).
`XDG_CONFIG_HOME` changes the config root. `AGENTDECK_HOME` selects an app home directly and takes precedence.

This folder holds your settings, keys, layouts, mods, generated agent guide and API types.
It also holds mod data, shared state, window positions, this screen's focus and zoom, update notes and cached media, and telemetry while enabled.
Mods may store sensitive data here. AgentDeck does not encrypt this folder.
The [installed guide's file map](../defaults/AGENTS.md#the-files) explains the files.

Spaces, tabs and splits are stored in each machine's core document, not in the app home.
Terminals and their output belong to [AgentDeck Core](../../core/README.md).
Removing the app home does not stop the core or erase its data.

The app exposes a local control socket in its home so agents can inspect and drive the window.
Treat access to that home as access to the window and its commands.
Remote connections use SSH through the core.

## Updates and signing

AgentDeck never checks for updates or downloads them. A new build comes from `just install` in a checkout or from a release of this repo on GitHub.
Releases are signed ad hoc, not with an Apple Developer ID, and are not notarized, so macOS quarantines a downloaded copy until you remove the flag (see the [README](../README.md#install)).
Core updates come the same way: `adk update --from <build>` swaps in a build you made.

## Telemetry

The app counts usage locally while telemetry is on (the default): versions, OS, bucketed usage time and counts, known agent names, built-in layout names, mod counts, app command names and fixed event counters.
Terminal text, prompts, file contents, folder paths and free-text names are never included.
AgentDeck has no telemetry server: reports are sent only if you set `HERDR_TELEMETRY_URL` to a server of your own.

**Settings → Privacy** shows the report and turns counting off, as does this field in your existing `settings.json`:

```json
{
  "telemetry": false
}
```

Turning it off deletes the local install ID and unsent reports.
For one run, set `DO_NOT_TRACK=1` or `HERDR_TELEMETRY=0`. CI environments disable collection too.

Feedback is drafted for you to review, and sent only to a server `HERDR_FEEDBACK_URL` names. AgentDeck has none.
Telemetry being off does not stop mod network requests.

[Back to AgentDeck](../README.md)
