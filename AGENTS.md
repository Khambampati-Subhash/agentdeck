# Agents working on AgentOS

Read `CLAUDE.md` first: it holds the project rules. This file says how work is
split between agents and what each one may do.

For work inside one half, also read that half's guide: `app/AGENTS.md` or
`core/AGENTS.md`. Their technical rules apply. Their maintainer and PR rules
don't (see `CLAUDE.md`).

## Roles

| Role | Agent type | Does | Never |
|---|---|---|---|
| Explorer | `Explore` | finds code across `app/` and `core/`, answers "where/how" with file:line | edits |
| Planner | `Plan` | turns a plan item into tasks with files, tests and order | edits |
| Implementer | `general-purpose` | one task from a written plan, test first, in a worktree | touches files outside its task; runs real agents |
| Reviewer | `feature-dev:code-reviewer` | reviews a finished task's diff against the plan and rules | fixes code itself |
| Upstream syncer | `general-purpose` | pulls herdr-app/herdr-core changes, resolves conflicts, records them | rebrands upstream text beyond the rename rules |

## Brief every subagent with

- The plan item and task, and the half (`app/` or `core/`).
- The exact test command and what "done" looks like.
- The isolation: `HERDR_APP_HOME=/var/tmp/agentos-<task>/app`,
  `HC_SESSION=agentos-<task>`, scratch XDG dirs under `/var/tmp`.
- The no-go list below.

## No-go for every agent

- No network calls to herdr.dev or releases.herdr.dev, and no telemetry.
- No live Claude/Codex/other agent runs, no captures, no paid API calls
  without the user's OK.
- Never use the user's real `~/.config/herdr-app`, `~/.config/herdr-core`
  or `~/.herdr`, and never touch a core or window you didn't start.
- Never delete outside the task's scratch dirs. Never touch `CLAUDE.md`,
  `AGENTS.md`, settings or skills in user homes.
- Don't edit `app/defaults/AGENTS.md`, `SKILL.md` or the generated
  `.d.ts`/schema files except to keep them in step with the behaviour you changed.
  Regenerate the generated ones.
- Don't merge, push or release. The main session does that after review.

## Parallel work

App and core tasks can run in parallel in separate worktrees. They share
nothing at build time, only the core's API (`core/schema/*.openrpc.json`). A task
that changes that API goes first, alone, and the app task follows.
