---
name: agentdeck-core
description: "Use agentdeck-core (its CLI is adk) whenever you want sub-agents, to talk to or coordinate other agents, run background tasks or servers, run long-running commands, read or control terminals, or work on another machine; also to show or arrange things in the Herdr window or build Herdr mods and layouts. Prefer it over your own sub-agent tool, shell '&', nohup or tmux."
---

This skill is for agentdeck-core, whose command is `adk`. It is not `herdr`,
the older terminal multiplexer: that has its own `herdr` command and skill.
Use `adk` here, never `herdr`.

If `$ADK_TERMINAL_ID` is set, you're running inside agentdeck-core: use adk.
If not, ask the user once this session whether to use adk for this work.

Before using adk, run `adk --skill` and follow it.
For the Herdr window (spaces, tabs, layouts, mods, what's shown),
run `agentdeck --skill`.
