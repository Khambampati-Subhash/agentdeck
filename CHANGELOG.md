# AgentDeck changelog

## agentdeck-v0.1.0 (2026-11-19)
On herdr-app 0.1.14 and herdr-core 0.1.19.

After downloading, remove macOS quarantine: `xattr -dr com.apple.quarantine ~/Applications/AgentDeck.app`

AgentDeck is a fork of Herdr with no connection to herdr.dev and improvements for the forge loop.

- **Fork and rename**: AgentDeck runs independently from Herdr with its own settings, bundle IDs, and binaries (`agentdeck`, `adk`). Stock Herdr and AgentDeck can run side by side without interfering.
- **No upstream connections**: The app makes no network calls to herdr.dev. Updates, telemetry, and feedback are disabled or only sent when explicitly configured.
- **Issue to PR workflow**: Issues appear on the Pull requests board with a Start work button that opens a worktree and starts an agent on the issue. PR windows show CI checks with logs, Fix with agent, and Re-run. Review comments can be sent to the agent on the PR's branch. Open pull or merge requests directly from a worktree. Clean up merged or deleted worktrees safely.
- **Worktree improvements**: Worktree spaces group under their repo even when no space is on the main checkout.
- **Migration tool**: Copy settings and mods from an existing AgentOS or Herdr install with `just migrate`.
- **Build tooling**: Self-contained Mac app bundle, ad hoc signing, and release infrastructure under AgentDeck names.
