# Inbox polish

The four open items under the agent inbox in `docs/plan.md`. Each is fixed
test-first, in `app/scripts/inbox.test.ts` or `app/scripts/agents.test.ts`.

## 1. A slow `adk read` holds up its preview

`hc()` gives up after 30 s (`EXEC_LIMIT` in `src/mods.rs`), so a read that
hangs blocks that agent's refresh for 30 s and then empties its preview.

- `reading` becomes a map of address → `{ at, token }`. A read older than
  10 s no longer blocks a new one.
- A read's result only lands if its token is still the current one, so a late
  old read can't overwrite a newer preview or clear the newer read's entry.

## 2. The selected row can scroll out of view

- A `ScrollHandle` on `inbox-list`, as in the spaces mod. `scroll_to_item(at)`
  runs only when the selected address or index changes, so the 3 s refresh
  doesn't undo the person's own scrolling.

## 3. A stale `agents.blocked` map wins in layouts without the Agents list

Mods have no unmount hook, so the agents mod can't clear the map when it goes
away. The inbox trusts the map only while the shown layout (`layout()`) has an
`agents` mod node that is drawn: not `hidden`, under no hidden node, and, in a
`stack`, under its `active` child. Otherwise its own stamps are used. The
agents mod republishes on its first render, so switching back is fine.

## 4. Orphan sub-agents are missing from "Needs you"

A blocked or failed pane-less sub-agent with no listed ancestor is in the
inbox but nowhere in the Agents list. If it is the only one blocked, the list
has no "Needs you" section and no inbox button.

- In the priority view, the "Needs you" badge adds the orphans, and the section
  (with its inbox button) shows when only orphans are blocked.
- The badge still won't equal the inbox's row count, on purpose: a parent with
  two blocked sub-agents is one row in the list and two in the inbox.
- The orphan rule is copied into the agents mod (mods don't import from each
  other's folders) and tested on the same cases as the inbox's.

## Finish

`just test` in `app`, `agentdeck check` on both mods, `/code-review high`;
then `docs/plan.md`, `docs/upstream.md` (agents mod), CHANGELOG, Status.
