# Agent inbox: design

Approved 2026-11-21 (popup and sidebar first; the notch "island" is a later milestone).

## Why

Agents that need a person (OSC 7501 `blocked`) are easy to miss: the Agents
sidebar's "Needs you" section only shows names. The inbox gathers every blocked
agent in one place with what it is asking, so the person can answer each one
quickly. Voice control (planned next) will drive the same list.

## Goals

- A popup (`inbox` mod) listing every blocked agent: icon, name, space and tab,
  the report's `kind` (permission, question, auth) and `msg`, how long it has
  waited, and the last lines of its screen.
- Keyboard first: ↑/↓ move, ↵ goes to the agent's pane, space peeks, esc closes.
  Clicking a row goes to its pane.
- Opened by a key (`cmd-shift-i` on macOS, `ctrl-shift-i` elsewhere, if free) and
  from the palette, and from the "Needs you" section.
- The Agents sidebar's "Needs you" section shows a count and each blocked row's
  `msg` under its name.

## Non-goals

- Answering for the person. No approve/deny buttons, no keys pressed, no
  `send --force`. Core's guide says a blocked agent needs a person; we keep that.
- The notch island (needs app Rust code; separate milestone).
- Any change to core or to the app's Rust code.

## Anti-goals

- Agent-specific guessing (per-agent key tables, reading prompts off the screen
  to decide anything). The screen preview is shown, never parsed.
- Polling `adk read` for every agent constantly: read previews only while the
  popup is open, and only for blocked agents.

## Approaches considered

- **A. Show and jump** (picked): show what each agent asks, jump to its pane.
  Safe for every agent, no guessing.
- B. A reply box that sends typed text with `send --force`: fine for
  questions, wrong for permission prompts that want one key.
- C. Approve/deny buttons with a per-agent key table: one click, but it is the
  agent-specific guessing our rules forbid, and breaks silently.

## How (decided)

- New mod `app/defaults/mods/inbox/` (`main.js`, `mod.json` with a popup
  overlay at top, like `picker`). Default mods are embedded by `app/build.rs`.
- Data: `agents()` for blocked agents and their place; `terminals()` for each
  agent's `report` (`kind`, `msg`); `hc(["read", addr, "--json"])` for the
  preview, trimmed to the last ~6 non-empty lines.
- Waiting time: the mod stamps when it first sees an agent blocked (like the
  agents mod's `changed` map).
- Going to a pane: `run("agent.focus", …)` (or the same call the agents mod
  uses), then close the overlay. Peek: `run("terminal.peek", { terminal })`.
- Pure helpers (rows from agents and terminals, ordering, preview trim) are
  plain functions in `main.js`, tested with Bun like `scripts/agents.test.ts`,
  and the test is added to `just test`.
- Docs: `app/defaults/AGENTS.md` (mods list), and `docs/upstream.md` if an
  upstream file changes (keys, agents mod).

## Left to the builder

- Exact visual layout, within the existing theme tokens (`theme()`).
- Ordering (my call: longest waiting first).
- Empty state copy (my call: "No agent needs you").
