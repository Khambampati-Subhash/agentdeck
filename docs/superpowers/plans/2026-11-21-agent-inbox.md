# Agent inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A popup listing every blocked agent with what it asks, plus a richer "Needs you" section in the Agents sidebar, so the person can find and answer each one fast.

**Architecture:** One new JavaScript mod, `app/defaults/mods/inbox/`, opened as a top popup (like `picker`). Pure helpers in `inbox/rows.js` turn `agents()` and `terminals()` into rows; `main.js` renders them and reads screen previews with `hc(["read", …])` only while open. The `agents` mod gets a count and each blocked agent's message. No Rust or core changes.

**Tech Stack:** gpui-kit JS mods, Bun tests (`app/scripts/*.test.ts`), `just test`.

**Spec:** `docs/superpowers/specs/2026-11-21-agent-inbox-design.md`

## Global Constraints

- Never answer for the person: no approve/deny, no `keys`, no `send` or `send --force` from the inbox.
- No agent-specific guessing: the preview is shown verbatim, never parsed.
- `adk read` runs only while the popup is open, only for blocked agents.
- User-visible text says AgentDeck, sentence case. Empty state: "No agent needs you".
- Colours only from `theme()` keys the other mods use (`popover`, `foreground`, `muted`, `dim`, `hover`, `raised`, ...).
- Files under ~32 KB. Upstream files changed (agents mod, keys, `AGENTS.md`, justfile) are each noted in `docs/upstream.md`'s "files we changed" list.
- Commits lowercase conventional, prefixed `app:`.
- Never run against the real setup: manual runs use `just dev` (scratch home, session `adk-dev`).

## Review Focus

- An agent with no `report` or an empty `msg` (older agents, `fake_tui.py --blocked`): the row still shows, with its `kind` if any and no message line.
- A remote agent (`machine/t7` address): `hc(["read", …])` gets the full address; a failed or slow read leaves the preview empty, never an error in the popup.
- The list changing while open (an agent answered elsewhere): the selection stays on the same agent if it's still there, else clamps; ↵ on an empty list does nothing.
- A preview full of blank lines or very long lines: trimmed to the last 6 non-empty lines, each cut to 200 characters.
- Many blocked agents: ordered longest waiting first; the waiting time survives the popup closing (stamps live in `localStorage`).

---

### Task 1: Inbox rows (pure helpers)

**Files:**
- Create: `app/defaults/mods/inbox/rows.js`
- Create: `app/scripts/inbox.test.ts`
- Modify: `app/justfile` (`test:` recipe adds `scripts/inbox.test.ts`)

**Interfaces:**
- Produces (all exported from `rows.js`, no imports):
  - `inboxRows(agents: AgentInfo[], terminals: object[], since: Record<string, number>, now: number) -> Row[]` where `Row = { address, space, space_name, tab_name, title, program, kind: string|null, msg: string, waited: number }`. Only `status === "blocked"`. `kind`/`msg` come from the matching terminal's `report` (`report.kind`, `report.msg`), missing → `null` / `""`. `waited = now - (since[address] ?? now)`. Sorted by `waited` descending, ties in `agents()` order.
  - `stamp(since: Record<string, number>, agents: AgentInfo[], now: number) -> Record<string, number>`: a new map: blocked agents keep their stamp or get `now`; agents no longer blocked are dropped.
  - `trimPreview(text: string, lines = 6, width = 200) -> string[]`: last `lines` non-blank lines (trailing whitespace stripped), each cut to `width` chars.
  - `keepSelection(rows: Row[], address: string|null, index: number) -> number`: index of `address` if present, else `min(index, rows.length - 1)`, `-1` when empty.

- [ ] **Step 1: Write the failing tests** in `app/scripts/inbox.test.ts` (import from `../defaults/mods/inbox/rows.js`):
  - `inboxRows keeps only blocked agents, oldest first`: three agents (t1 blocked since 1000, t2 working, t3 blocked since 500), `now = 2000` → addresses `["t3", "t1"]`, waited `[1500, 1000]`.
  - `inboxRows takes kind and msg from the terminal report`: terminal `{ address: "t1", report: { kind: "permission", msg: "Apply these changes?" } }` → row `kind "permission"`, `msg "Apply these changes?"`; a terminal without `report` → `kind null`, `msg ""`.
  - `inboxRows handles remote addresses`: agent `vps/t7` matches terminal `vps/t7`.
  - `stamp keeps old stamps, adds new, drops unblocked`: `{ t1: 5, t9: 1 }` with t1 and t2 blocked at now 10 → `{ t1: 5, t2: 10 }`.
  - `trimPreview keeps the last non-blank lines`: `"a\n\nb  \nc\n\n\n"` with `lines = 2` → `["b", "c"]`; a 300-char line → length 200; `""` → `[]`.
  - `keepSelection follows the agent, then clamps`: rows `[t3, t1]`, address `t1` → `1`; address `t5`, index `4` → `1`; empty rows → `-1`.
- [ ] **Step 2: Run** `cd app && bun test scripts/inbox.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four functions in `rows.js` as specified.
- [ ] **Step 4: Run** `cd app && bun test scripts/inbox.test.ts`. Expected: all pass. Add the file to `just test` and run `cd app && bun test scripts/inbox.test.ts scripts/agents.test.ts`.
- [ ] **Step 5: Commit** `app: inbox rows for blocked agents`.

### Task 2: Inbox popup

**Files:**
- Create: `app/defaults/mods/inbox/mod.json`: `{ "place": "none", "title": "Inbox", "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 640, "height": 0.7 } }`
- Create: `app/defaults/mods/inbox/main.js`
- Modify: `app/defaults/keys.macos.json` (`"cmd-shift-i": "mod.open:inbox"` in `global`), `app/defaults/keys.json` (`"ctrl-shift-i": "mod.open:inbox"`). First grep both files and `app/src/keys.rs` tests for those chords; if taken, pick a free one and say which.
- Modify: `app/defaults/AGENTS.md` (the "defaults are mods too" list in `## Mods`: add `inbox`, one line on what it shows and that it never answers for the person; the `## Keys` table if it lists defaults).
- Modify: `docs/upstream.md` (files we changed: keys files, `AGENTS.md`, justfile).
- Test: `app/scripts/inbox.test.ts` (extend)

**Interfaces:**
- Consumes: `inboxRows`, `stamp`, `trimPreview`, `keepSelection` from `./rows.js`.
- Produces: `export default class Inbox extends View` with methods the tests drive: `move(delta: number)`, `go()` (runs `agent.focus` with `{ terminal: address }`, then `closeOverlay(props().overlay)`), `peek()` (runs `terminal.peek` with `{ terminal }`), and `previews: Map<address, string[]>`.

- [ ] **Step 1: Write the failing tests** (load `main.js` with the same `new Function` harness as `agents.test.ts`, passing fakes for `agents`, `terminals`, `run`, `hc`, `closeOverlay`, `props`, `theme`, `localStorage`, and `rows.js`'s exports):
  - `go focuses the selected agent and closes`: two blocked rows, `move(1)`, `go()` → `run` got `["agent.focus", { terminal: <second address> }]` and `closeOverlay` got the overlay id.
  - `go on an empty list does nothing`: no blocked agents → `go()` makes no `run` call.
  - `previews read only blocked agents, once each`: after `init` and one refresh, `hc` was called with `["read", "t1", "--json"]` for each blocked agent and never for a working one; `previews.get("t1")` equals `trimPreview` of the fake's `text`.
  - `a failed read leaves an empty preview`: `hc` rejects → `previews.get("t1")` is `[]`, no throw.
  - `stamps persist`: `localStorage` `"since"` holds the stamp map after a refresh; a second instance reads it back.
- [ ] **Step 2: Run** `cd app && bun test scripts/inbox.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement `main.js`.** Render like `picker`: a header ("Needs you", count, `esc` hint), one row per `Row` (program icon via the same `icon()` helper as `agents`, name, `space_name · tab_name`, `kind` chip, `msg`, waited via a `duration()` copied from `agents`), the selected row expanded with its preview in the mono font, and a footer of key hints (`↑↓ move`, `↵ go to pane`, `space peek`). Keys in `on_key_down`: `up`/`down` → `move`, `enter` → `go`, `space` → `peek`, `escape` → close. Click on a row → select it, then `go()`. Empty: "No agent needs you". On each render, re-stamp (`stamp`) and save to `localStorage` key `"since"` only when it changed; start a read for any blocked address not yet in `previews` (at most one read in flight per address), and refresh previews every 3 s with `cx.timer.every(3000, …)`.
- [ ] **Step 4: Run** `cd app && bun test scripts/inbox.test.ts` (pass), then `cd app && cargo build --locked && target/debug/agentdeck check defaults/mods/inbox`. Expected: check reports no errors.
- [ ] **Step 5: Commit** `app: inbox popup for agents that need you`.

### Task 3: "Needs you" in the Agents sidebar

**Files:**
- Modify: `app/defaults/mods/agents/main.js`
- Modify: `app/scripts/agents.test.ts`
- Modify: `docs/upstream.md` (agents mod entry)

**Interfaces:**
- Consumes: nothing from Tasks 1–2 except the mod name `inbox` for `run("mod.open", { name: "inbox" })`. Check `app/src/commands.rs` for `mod.open`'s exact argument name before using it.
- Produces: `blockedMsg(terminal: object|undefined) -> string` (top-level function in `agents/main.js`): `report.msg` trimmed, cut to 80 chars with "…", else `""`.

- [ ] **Step 1: Write the failing tests** in `agents.test.ts` (same `new Function` pattern that extracts `title`):
  - `blockedMsg shows the report's message`: `{ report: { msg: "  Apply these changes?  " } }` → `"Apply these changes?"`; 100-char msg → 81 chars ending in "…"; `undefined` and `{}` → `""`.
- [ ] **Step 2: Run** `cd app && bun test scripts/agents.test.ts`. Expected: FAIL (`blockedMsg` not defined).
- [ ] **Step 3: Implement.** Add `blockedMsg`. In the priority view, the "Needs you" header (`SECTION[4]`) shows the member count as a badge and an inbox button (`svg("mods/workspace-chrome/…")` icon that exists there, `id("open-inbox")`) running `mod.open` for `inbox`; a blocked row shows `blockedMsg` of its terminal as a second dim line (not in the narrow rail). Grouped view: blocked rows get the same second line. Keep the header's fold click working; the button stops propagation.
- [ ] **Step 4: Run** `cd app && just test`. Expected: all Bun files and `cargo test --locked` pass. Then `target/debug/agentdeck check defaults/mods/agents`.
- [ ] **Step 5: Commit** `app: needs-you count and messages in the agents list`.

### Task 4: Manual check and status

**Files:**
- Modify: `docs/plan.md` (P5: tick the approvals-bar candidate as "inbox, done", note the island as next), `CLAUDE.md` status line, `CHANGELOG.md` (unreleased: the inbox).

- [ ] **Step 1:** `just dev`; in a scratch terminal run `python3 core/crates/herdr-core/tests/fake_tui.py --blocked` in two tabs. Expected: sidebar "Needs you" shows `2`; `cmd-shift-i` opens the inbox with both rows, previews visible; ↵ goes to the pane and closes; `agentdeck shot /var/tmp/inbox.png` taken with the popup open.
- [ ] **Step 2:** Update the docs above and commit `repo: inbox in plan, status and changelog`.
