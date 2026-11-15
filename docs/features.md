# AgentOS feature plan

Our improvements to Herdr. This is the "build" half of `plan.md`: `plan.md` P1–P4
is the plumbing we lay down first (offline, rename, our releases, upstream sync);
this file is P5 and beyond — what we add on top so AgentOS is worth using.

How to read it: every feature names its **layer** (a new feature is a *mod* unless
the `app` or `hc`/core itself must act on it — see `CLAUDE.md`), its **effort**,
**priority**, dependencies, a **done-when**, and its **risks**. Core-divergence
features are marked ⚙️ and must go through `docs/upstream.md` and a fresh commit
that regenerates the schema.

Research date 2026-11-11 against `app` @ `0ac92e4`, `core` @ `ce81486` (herdr-app
0.1.14, herdr-core 0.1.19).

---

## Part 0 — what we already inherit

Before we add anything, this is the bar we're raising from. Stock Herdr is strong;
we don't rebuild it:

- **Persistent agents.** `hc` (herdr-core) runs every terminal in a background
  server; close the app, lose SSH, reboot — the work lives, terminal is restored
  (a shell in its last folder, never the original command re-run).
- **Status that tells you who needs you.** Every agent reports `working /
  blocked / done / idle` via **OSC 7501**. The sidebar and tab surface the most
  urgent.
- **A model you own.** Spaces (per repo/machine), tabs (per task), panes
  (terminals or mod panels). The whole window is *files* in
  `~/.config/herdr-app`: `layouts/*.json`, `keys.json`, `settings.json`,
  `programs.json`, and **mods** (JavaScript on `gpui-kit`/native GPUI).
- **Agent-native.** `hc run --bg`, `hc send`, `hc wait --children`,
  `hc read/get/ls/label/keep/kill`; sub-agents report back to their parent.
- A live ecosystem: ~300 community layouts, ~570 mods, a **Herdr TUI plugin
  marketplace** (`herdr-plugin` GitHub topic → `herdr plugin install`), a phone
  app, multi-machine over SSH/Tailscale.

So "improvement" means filling the gaps in that model, not new plumbing.

---

## Part 1 — the deltas: where AgentOS can win

Two sources of ideas: (a) what Herdr has no room for, and (b) what our old
Go/Swift AgentOS (the `agentd`/`agentctl` version) already solved well.

| # | Gap in stock Herdr | Old AgentOS had | Verdict |
|---|---|---|---|
| F1 | No central place to *answer* a blocked agent | **Approval Inbox** | Ship it — signature feature |
| F2 | Status is only 5 words; **no token/context/cost** | modelUsage parsing | Ship it — biggest gap |
| F3 | Agents run unsupervised; no guardrails | **deny-by-default policy engine** | Ship it — the thesis |
| F4 | No time-series view of the fleet | **AgentLens** | Ship it (depends F2) |
| F5 | You pick the model by hand | **Router** (model/effort from outcomes) | Ship it (depends F2) |
| F6 | No "this agent went quiet" | — (new) | Ship it — cheap, high value |
| F7 | No event-driven agents | Triggers (`ci-failed`) | Ship it |
| F8 | Secrets in env/logs | **secrets broker** (Keychain) | Ship it |
| F9 | Multi-machine list, no fleet roll-up | kernel event log | Ship it (depends F2) |
| F10 | Raw gallery, no curated default | — | Ship it — experience |

---

## Part 2 — feature catalog

### F1 · Approval inbox  ⭐ signature
A floating/drawer "inbox" that aggregates **every blocked agent, on every
machine, into one queue**, and lets you **answer, allow, deny, or edit** with a
key or click instead of hunting the window that asked.

- **Layer:** app mod (`openOverlay`/`notify`, polls `agents().filter(blocked)`
  and `machines()`), one small `hc` addition so an answer maps to a decision.
- **Already possible today:** the `agents` mod already groups a "Needs you"
  section and `blocked` + `hc send` exist. Most of this is a mod *now*; the win
  is making a *decision* (approve/edit/decline) a first-class action.
- **⚙️ optional core bit:** a `terminal.answer {terminal, kind, text}` so a
  "deny" can *stop* the tool call (today a `blocked` agent still holds; you'd
  `hc send` the answer). Regenerates `hc.get`/schema.
- **Effort:** M (mod) + S (core option). **Priority:** P1.
- **Done-when:** with two blocked agents on two machines, the inbox shows both;
  one action on each either unblocks it (allow/answer) or denies; aggregated
  count matches `agents()`; a screenshot shows it over a real scratch layout.
- **Risks:** an "allow" must never auto-approve anything the agent hasn't asked
  (deny-by-default, F3). Keep the decision visible and reversible.

### F2 · Agent metrics: context / tokens / cost  ⚙️ the gap
Per-agent **context-window fill %, tokens, daily/total cost, model & effort**,
surfaced live and with a **budget bar**.

- **Why:** this is the single thing stock Herdr cannot do — `hc get`/OSC 7501
  carry only the five status words plus `cwd/labels/parent`. Cost is the thing
  people actually want when they run a fleet of agents.
- **How, in-philosophy:** the core rule is *"status comes only from OSC 7501, no
  scraping."* So we **extend the OSC 7501 wire** with optional fields, e.g.
  `\e]7501;state=working:model=sonnet:effort=high:context_used=0.62:in=…:out=…
  :cache_in=…:cost_usd=0.12\e\\`. `hc` parses the extra keys, carries them in
  `get`/`status`, exposes them through the app API (one new field on
  `AgentInfo` in `herdr.d.ts`). Agents that don't report get `null`, never a
  guessed number.
- **App:** a `metrics` status-bar mod + a `budget` drawer (daily USD, 80% alert),
  and per-pane context% on the pane header. Reuse `workspace-status`, `pane`.
- **⚙️ core:** parse + forward the new keys; add to the `get`/`status` result;
  `HC_UPDATE_SCHEMA=1 cargo test -p herdr-core --test m0` then regenerate the app
  `.d.ts`. **Divergence:** record in `docs/upstream.md`.
- **Effort:** M (core) + M (mod). **Priority:** P1 — it unlocks F4, F5, F9.
- **Done-when:** `fake_tui.py` emits a 7501 with the new keys and a fixture test
  asserts `hc get` returns them; a `metrics` mod shows context% + cost for that
  agent; `unknown`/absent fields read `null`; schema regenerated and committed.
- **Risks:** keep fields *optional* so old agents and the protocol stay
  compatible; don't let a missing field imply "0 spent".

### F3 · Policy engine, deny-by-default  ⚙️ the thesis
Bring back AgentOS's guardrail: one `~/.config/agentos/policy.toml`, enforced in
**two layers** — (1) compiled into each agent's own config at launch (Claude
`--settings` `permissions.allow/deny` + `PreToolUse` hook; Gemini
`--approval-mode`/`--policy`), (2) a per-tool-call interceptor that consults a
local evaluator and routes asks to F1's inbox. Unknown tool → `ask`; unparseable
Bash → `ask`; `deny` always wins; nothing is ever auto-approved.

- **Layer:** ⚙️ core at the *launch* edge (a `hc policy`/launch wrapper that
  compiles policy into argv/env) + a policy mod that shows asks in the inbox.
- **Why:** this is the "why fork Herdr" answer. Herdr runs untrusted agents in
  your shell with your creds; a local, auditable, deny-by-default gate is the
  safety story for a tool people run all day.
- **Scope cut for v1:** policy + the two-layer *prompt* enforcement. A true
  sandbox (`sandbox-exec`/containers) for agent-written scripts is out of scope
  (as in the old spec) — note it as v2.
- **Effort:** L. **Priority:** P2 (after rename, so policy lives in our paths).
- **Done-when:** a managed session launches with policy compiled in; a `deny`
  rule blocks a `git push --force` fixture; an `ask` reaches the F1 inbox and a
  decline stops the call; an unknown tool asks; core unreachable ⇒ fail closed
  (managed) / fall back to the agent's own prompt (adopted), never approve.
- **Risks:** the highest-risk item (intercepts user work). Ship deny-only and
  `ask` routing first; make "fail closed" explicit and tested. Keep it
  opt-in per session with a visible badge.

### F4 · AgentLens — the fleet dashboard  (Plan 2)
A dedicated **mission-control layout**, all agents/time-spaces at a glance:
status over time, cost-over-time (F2), who-needs-you (F1), throughput
(`# tasks/hr`), and a per-space/per-machine roll-up. It's a custom *layout* +
*theme* (exactly what Herdr's gallery shows people making), plus the `metrics`
mod. Read-only.

- **Layer:** app layout `layouts/lens.json` + `metrics` + `budget` mods. No core
  change beyond F2.
- **Effort:** M (mostly, once F2 and F1 exist). **Priority:** P2.
- **Done-when:** opening the Lens layout on a scratch home with ≥3 agents shows
  cost, context% and a status history; a blocked agent lights up and links to F1;
  verified with `herdr-app shot`.
- **Risks:** polling many agents — poll gently (a mod timer), cache roll-ups.

### F5 · Router — pick model & effort  (OS-7 carry-over)
When you start an agent, optionally **auto-pick model + effort** from the task
and from **past outcomes** (the Wilson-lower-bound policy the old version used).
Maps onto `hc` **templates**: a template carries the chosen model/effort; the
router is a policy that fills it from task signals + a store of recent
outcomes.

- **Layer:** ⚙️ core (a tiny `hc router`/`hc --route <task>` writing into the
  template) + an outcomes store (app home file; later core). The feedback loop
  *needs* F2's cost/quality signals.
- **Effort:** M. **Priority:** P2 (after F2).
- **Done-when:** `hc router pick "<task>"` returns a `(model, effort)` from the
  candidate ladder given fixture outcomes; a template launches the agent with that
  model; cheapest-adequate wins over a `min_success` bar; `mode: off` is honored.
- **Risks:** "escalation from the strongest" reads oddly (known old gap) — keep
  the human in the loop; show the pick, let them override.

### F6 · Stuck-agent watchdog  🪄 cheap + high value
An agent marked `working` that emits **no new status or output for N minutes** is
flagged "needs attention" (a "stale" status / a red dot + a sound via
`settings.sounds`).

- **Layer:** app mod — poll each agent's last-update time + `hc read` delta;
  *do not scrape* content, only the cadence of 7501 updates/output lines.
- **Effort:** S. **Priority:** P1 (after F1 shares the alarm surface).
- **Done-when:** a fixture agent that stops emitting for N→min shows the flag and
  fires a `blocked`-class toast; one that keeps emitting does not; tunable.
- **Risks:** false positives on long-running legit builds — base it on output
  cadence, not a wall clock; default off or generous.

### F7 · Triggers — event-driven agents
"When CI fails on repo X, run this task"; "on file change, run Y". An
`agentctl trigger add …` equivalent for `hc`: a small daemon loop that watches
events and launches a templated agent.

- **Layer:** ⚙️ core (a `hc trigger`/watcher) + a UI mod. Reuse F3 (triggered
  agents get the policy) and `hc run --bg`.
- **Effort:** M. **Priority:** P3.
- **Done-when:** a `ci-failed`-style trigger (fixture) launches the templated
  agent and reports back; triggers list, pause, delete; a failed trigger shows
  why.
- **Risks:** loops and cost — cap concurrency and cost via F2 budgets.

### F8 · Secrets broker
Keychain-backed secret injection with **scrubbing**: values live in the system
keychain, never in argv/logs; only secrets named in policy are injected; `ttl`
expires (resuming re-pulls); scope is a recorded label in the audit log.

- **Layer:** ⚙️ core (`hc secret` + env at spawn). Local: 127.0.0.1, no
  telemetry (the fork's rule).
- **Effort:** M. **Priority:** P2.
- **Done-when:** `hc secret set X` keeps the value out of argv; a launch injects
  it from the keychain; it never appears in any log/event file; `ttl` expiry
  kills the session with a recorded reason.
- **Risks:** keychain access is per-app on macOS; align with the P1 "offline,
  signed-by-us" install.

### F9 · Fleet roll-up
Herdr already lists other machines; add a **one-line roll-up across all of them**
(total agents, who-needs-you, total cost). Needs F2 + a small `hc machine`
summary (per-machine counts already derivable from `hc ls --on`).

- **Layer:** app mod over `machines()` + per-machine `hc ls`: low; a core summary
  helper: small. **Effort:** S–M. **Priority:** P3.
- **Done-when:** with two configured machines, one line shows totals + needs-you;
  reachable/unreachable handled; no agent content leaves a machine.

### F10 · Curated AgentOS layout + theme pack
Ship default `layouts/` + `themes/` (a "mission control" layout using F1+F4+F6, a
clean default theme) and **publish a few as the first AgentOS mods** on the
marketplace topic. This is the thing that makes the fork feel like a product.

- **Layer:** app (layout/theme/mod files in `app/defaults/*`). **Effort:** M
  (mostly design + `shot` tuning). **Priority:** P2, but a good *quick win* early.
- **Done-when:** `just dev` opens the AgentOS layout; `herdr-app shot` of it is a
  screenshot we'd put on a landing page; it clones cleanly per the mod guide.

### F11 · Handoff choreography (first-class roles)
`hc run --bg` already lets agents start agents and report back. Make
**planner → implementer → reviewer** a *template* with a hierarchy view in the
`agents` mod (parent shows its kids' urgent status). Low effort, high demo value.

- **Layer:** app mod + a role template. **Effort:** S–M. **Priority:** P3.
- **Done-when:** launching the "review flow" template starts a reviewer as a child
  of the implementer; the agents list shows it nested and inherits its urgent
  status; the final report lands in the parent's input.

### F12 · Unified memory / scratchpad
A per-space shared note file the agents can read and append, plus a small
`memory` mod to browse it. AgentOS's "unified memory" in our home dir.

- **Layer:** app mod + a file in `~/.config/agentos`. **Effort:** S.
  **Priority:** P3 (nice-to-have).
- **Done-when:** two agents in a space write to the same memory file; the mod
  lists entries; hot-reload shows new entries live.

### The forge loop: issue → agent → PR → merged (F13–F17)

These build on the Pull requests panel (`prboard`, `prdiff`) and the worktree
dialog. Everything goes through the person's own `gh`/`glab`/`git`. No token is
kept in the app, and nothing is sent to herdr.dev. All of them are mods; the
plan is `docs/superpowers/plans/2026-11-15-forge-loop.md`.

### F13 · Issues on the board → "Start work"  (D1)
The board gets an **Issues** view beside Pull requests, with the same GitHub/GitLab
tabs and All repos / This repo scopes. Its columns are Assigned, Mine and All.
**Start work** on an issue opens the worktree dialog. The branch name is filled
in as `<num>-<slug>`, and the dialog has an agent picker. Confirming creates the
worktree, opens a space, and starts the agent with the issue (title, link, body)
as its first message.

- **Layer:** `prboard` (+ `issues.js`), `worktree` gets `task` and an agent picker.
- **Done-when:** fixture `gh`/`glab` replies list issues in both scopes; Start
  work opens the worktree dialog with the branch and task; Enter runs
  `space.new {folder, argv, task}`; in All repos it finds a local checkout from
  the spaces' `origin`, or says to open one.

### F14 · CI checks + "fix this failure"  (D2)
PR cards show the CI result (✓ ✕ ●) when the list carries it (GitHub, This repo).
The PR window gets a **Checks** tab listing `gh pr checks` or the MR's head
pipeline jobs. A check opens its log (failed steps; the last 300 lines). From
there, **Fix with agent** sends the log tail to the agent on the branch, and
**Re-run** re-runs failed jobs. The tab reloads every 30 s while checks are pending.

- **Done-when:** fixtures for pass/fail/pending on both forges; `gh pr checks`
  exit codes 1 and 8 still parse; the log view tails and strips ANSI; Fix sends
  through F15's path; Re-run calls the right CLI.

### F15 · Review comments → the branch's agent  (D3)
Each comment in the PR window has **→ Agent**. It finds the agents whose pane is
on the PR's branch in a checkout of the same repo. With one match it sends the
comment (author, file:line, body) with `hc send`. With several it asks which one.
With none it offers to start one on that branch, through the worktree dialog.

- **Done-when:** one / many / none fixtures; an agent on the same branch name in
  another repo is never picked; text that starts with `-` reaches `hc send`
  intact (after `--`).

### F16 · Open a PR from a worktree  (D4)
A `propen` dialog, opened from the space menu and the board's **＋** (This repo).
It reads the branch, base (`origin/HEAD`) and commits, and drafts a title and body
from them. It warns about uncommitted changes, refuses when there's nothing ahead,
and links an existing PR for the branch instead of making a second. Create
pushes the branch and runs `gh pr create` / `glab mr create`, as a draft by
default, then opens the new PR's window.

- **Done-when:** draft text for one and many commits; existing-PR, detached,
  nothing-ahead and dirty cases; create runs push then create with `--flag=value`
  args; the PR window opens on the returned URL.

### F17 · Worktree cleanup  (D5)
The worktree dialog gets a **clean** action, opened from the space menu. It fetches
with `--prune`, then lists linked worktrees with a reason: merged into the base,
branch deleted on origin, folder gone, uncommitted changes, in use by a space or
agent, or not merged. Only removable ones can be ticked, and the safe ones are
ticked already. Remove uses plain `git worktree remove` and `git branch -d`, never
`--force`, and reports what git refused.

- **Done-when:** a fixture repo state yields each reason; in-use and dirty can't
  be selected; a missing folder is pruned; `-d` refusal is reported, not hidden.

---

## Part 3 — priority & effort

Legend: impact/effort; layer `mod` / `core` (⚙️ = schema/API change).
Arrows are dependencies.

```
        impact
        high ┌ F3 policy · F2 metrics · F4 lens
         med │ F1 inbox · F5 router · F8 secrets · F10 pack
         low │ F6 watchdog · F11 handoff · F12 memory · F9 fleet · F7 triggers
             └────────────────────────────────────►
            low     medium      high        effort

Dependency spine:  F2 (metrics) ──► F4 (lens), F5 (router), F9 (fleet)
                   F1 (inbox) ────► F3 (policy asks) + F6 (watchdog alarm)
                   P1 offline → P2 rename is the gate for F3/F8 (local paths)
```

**Build order (the quick-wins first, inside each, then the spine):**
1. **Do it this week — no core change, pure mods:** F10 layout pack, F11 handoff
   template, F12 memory, **F6 watchdog** (cadence-only, default off).
2. **First core divergence:** **F2 metrics** (OSC 7501 extension) — it unblocks
   the most.
3. **Signature:** **F1 approval inbox** mod, then its optional `terminal.answer`.
4. **Thesis:** **F3 policy**, **F8 secrets** (after P2 rename).
5. **On top of F2:** **F4 lens**, **F5 router**, **F9 fleet**, **F7 triggers**.

---

## Part 4 — how this stacks on `plan.md`

These features don't replace the milestones; they ride on them.

- **After P1 (offline):** nothing in F2/F3/F8 should reach the network. The
  "metrics" and "router" are local. F10/F11/F12 can begin now.
- **After P2 (rename to AgentOS):** F3, F8, F10 get their home paths
  (`~/.config/agentos`, `~/.agentos`) and bundle id. Do not start these against
  real Herdr paths.
- **Schema-gating (per `AGENTS.md` "parallel work"):** any feature that changes
  `core/schema/*.openrpc.json` — **F2, F3 (launch), F5, F8** — is a *solo* core
  change; the matching app/mod change follows it in a second task.
- **TDD:** every feature's *Done-when* is a fixture/`fake_tui.py` + `hc get`/
  `herdr-app shot` check, never a live agent run. Real-agent smokes stay off
  without the user's OK (cost).
- **Philosophy guardrail:** status stays OSC-7501-only (F2 *extends* the protocol,
  it doesn't add scraping); 127.0.0.1 only; no telemetry; new feature ⇒ a mod
  unless the app/core must act on it.

---

## Part 5 — first things I'd build, with commands

Pick three, in order:

```sh
# 1. F10 — a first AgentOS layout + theme (pure app mods; verify visually)
just dev                                   # scratch home, core session "aos"
# add app/defaults/layouts/mission-control.json + reuse F1/F4/F6 mods, tune,
app/target/debug/herdr-app shot lens.png    # screenshot it
app/target/debug/herdr-app check <mod folder>

# 2. F2 — metrics over OSC 7501 (the core divergence)
# core: parse optional 7501 fields; add to get/status; regenerate schema
cd core && HC_UPDATE_SCHEMA=1 cargo test -p herdr-core --test m0
# fake_tui.py emits  \e]7501;state=working:model=sonnet:context_used=0.62:cost_usd=0.12
# fixture asserts hc get returns them; app .d.ts gains the field; a metrics mod reads it
cd app && cargo build --locked && cargo test --locked

# 3. F1 — approval inbox (mod today; core terminal.answer when we're ready)
# reuse agents() + blocked + hc send; one action per blocked agent, two machines
```

---

## Appendix — deliberately not in scope (today)

- **True sandboxes** for agent-written scripts (`sandbox-exec`/containers) — F3
  v2, after the two-layer prompt policy is proven.
- **Team/fleet mode** sharing one kernel across users — solo-dev first; reuse the
  kernel later.
- **Upstream feature-backports** — those come through P4 sync, not this file.
- **Changing upstream files** — keep our work in new mods/new files; record
  every divergence in `docs/upstream.md`; keep the trees mergeable.

*Open questions for the user: final binary/bundle names (carried in `plan.md`),
macOS-only vs Linux/Windows builds, and whether to ship the Win98 layout and its
fonts. Each decision gates which features we can release.*
