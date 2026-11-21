# AgentDeck changelog

## Unreleased

- **Agent inbox**: `cmd-shift-i` (`ctrl-shift-i` elsewhere) opens a list of every agent that needs you (also "Open inbox" in the palette), with what it's asking, how long it has waited and its last screen lines; ↵ goes to its pane. The Agents list's "Needs you" section shows a count, an inbox button and each agent's message.
- **Command line link**: AgentDeck.app from a release now links `agentdeck` into `~/.local/bin` when it runs from an Applications folder. 0.1.0 looked for `Herdr.app` and never made the link.
- **Upstream fixes**: the app and core now include upstream's fixes up to herdr-app 0.1.16 and herdr-core 0.1.21.
- **Worktree folder**: new worktrees go under `~/.agentdeck/worktrees` instead of Herdr's `~/.herdr/worktrees` (or where `worktrees.directory` in settings.json says). Existing ones are left alone.

## agentdeck-v0.1.0 (2026-11-20)
On herdr-app 0.1.14 and herdr-core 0.1.19.

After downloading, unzip it, move AgentDeck.app into ~/Applications, then remove macOS quarantine: `xattr -dr com.apple.quarantine ~/Applications/AgentDeck.app`

AgentDeck is a fork of Herdr with no connection to herdr.dev and improvements for the forge loop.

- **Fork and rename**: AgentDeck runs independently from Herdr with its own settings, bundle IDs, and binaries (`agentdeck`, `adk`). Stock Herdr and AgentDeck can run side by side without interfering.
- **No upstream connections**: The app makes no network calls to herdr.dev. Updates, telemetry, and feedback are disabled or only sent when explicitly configured.
- **Issue to PR workflow**: Issues appear on the Pull requests board with a Start work button that opens a worktree and starts an agent on the issue. PR windows show CI checks with logs, Fix with agent, and Re-run. Review comments can be sent to the agent on the PR's branch. Open pull or merge requests directly from a worktree. Clean up merged or deleted worktrees safely.
- **Worktree improvements**: Worktree spaces group under their repo even when no space is on the main checkout.
- **Migration tool**: `just migrate` copies settings and mods from an AgentOS install (a Herdr install's only with `--from`). It needs a source checkout.
- **Build tooling**: Self-contained Mac app bundle, ad hoc signing, and release infrastructure under AgentDeck names.
