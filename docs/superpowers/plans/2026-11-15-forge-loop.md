# Forge Loop (D1–D5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop from issue to merged PR inside AgentOS: start an agent from an issue (D1), see CI and send a failure to the agent (D2), send review comments to the agent (D3), open the PR from the worktree (D4), and clean up finished worktrees (D5).

**Architecture:** All five are JavaScript mods in `app/defaults/mods/`. They extend `prboard` (board), `prdiff` (PR window) and `worktree` (dialog), and add one new dialog mod, `propen`. Data comes from the person's own `gh`, `glab` and `git` through `exec`. Agents are reached with `hc send`, and new agents start through the worktree dialog's `space.new {folder, argv, task}`. No core or Rust change.

**Tech Stack:** Mod JS (`gpui-kit`, `gpui-base`, `herdr` module; `app/defaults/herdr.d.ts`), Bun tests in `app/scripts/*.test.ts`, `gh` ≥ 2.x, `glab`.

**Spec:** `docs/features.md` → F13–F17 ("The forge loop"). D1=F13, D2=F14, D3=F15, D4=F16, D5=F17.

## Global Constraints

- Work on branch `forge-loop` cut from `p1-offline`, because `prboard`/`prdiff` aren't on `main` yet.
- Mods only. No `core/` change, no Rust change, no new dependencies.
- Every source file stays under 32 KB. `prdiff/main.js` is 20.3 KB today, so new PR-window UI goes in `prdiff/checks.js` and `prdiff/agent.js` and `main.js` must end below 30 KB.
- External programs only through `exec("gh"|"glab"|"git", [...])` and `hc([...])`. Every arg is its own string. Free text (titles, bodies, comments, logs) goes as `--flag=value` or after `--`, never as a bare positional that could start with `-`.
- Outward actions (git push, PR/MR create, comment, CI re-run, `hc send`, `git worktree remove`, `git branch -d`) run only on an explicit click or Enter. Never on load, never on a timer.
- Never talk to herdr.dev. Manual runs only through `just dev` (scratch `HERDR_APP_HOME`, core session `aos`). Don't create a real PR, comment, push or re-run during verification without the user's OK.
- The test loader inlines a mod's own files only from single-line `import { … } from "./x.js";` lines. Inside one mod, a helper file's top-level names must not repeat any other file's top-level names in that mod: `prdiff/forge.js` already defines `name`, `hostOf`, `repoFlag`, `cli`, `json`, `num`, `hostFlag`, `api`, `ghRepo`, `glProject`, `byTime`; `prdiff/main.js` defines `TABS`, `REVIEW`, `chipOf`, `since`, `message`; `prboard/forge.js` defines `login`, `problem`, `me`, `repoOfUrl`, `fromGitHub`, `fromGitLab`, `GH_REPO`, `GH_SEARCH`, `GL_REPO`, `GL_ALL`, `listRepo`, `listAll`; `prboard/main.js` defines `COLUMNS`, `SCOPES`, `EMPTY`, `location`, `statusOf`, `since`; `worktree/main.js` defines `place`, `ROOT`, `tilde`, `slug`, `ago`, `checkouts`, `spaceOf`, `git`, `modules`, `submodules`, `repoOf`.
- Copy: GitHub is "pull request" and `#N`; GitLab is "merge request" and `!N`.
- Commits are lowercase conventional with an `app:` prefix and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Behaviour changes update the mod guide `app/defaults/AGENTS.md` (the Layouts paragraph that describes `prboard`/`prdiff`) in the same task. Edits to upstream files (`worktree/main.js`, `menu/main.js`, `app/justfile`, `app/defaults/AGENTS.md`) get a row in `docs/upstream.md`.
- Tests: `cd app && bun test scripts/<file>.test.ts`. Every new test file is added to the `test:` recipe in `app/justfile` (line 46) in the task that creates it.

## Review Focus

1. **`gh pr checks` exits 1 (a check failed) or 8 (checks pending) but still prints valid JSON.** The Checks tab must show the checks, not an error. Pinned in Task 5.
2. **The same branch name in two repos (`fix`, `main`, `12-typo`).** → Agent must never send to an agent in a checkout of a different repo. Pinned in Task 2.
3. **Free text that looks like a flag or shell (`--force`, `$(rm -rf ~)`, quotes, newlines) in a comment, issue title or PR body.** It must reach `hc`/`gh`/`glab` byte-for-byte as one arg. Pinned in Tasks 2 and 9.
4. **Starting an agent on a branch that's already checked out (often the main checkout).** `git worktree add` fails; the dialog must show git's message and create no space. Pinned in Task 1.
5. **Cleanup must never remove a worktree with uncommitted changes, or one a space or agent is in.** A worktree whose folder is gone must be pruned, not crash the list. Pinned in Task 10.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/scripts/mod-harness.ts` | create | Shared Bun harness: `load`, `element`, `textOf`, `findId`, `findList`, `harness` (lifted from `prboard.test.ts`) |
| `app/scripts/prboard.test.ts` | modify | Import the harness instead of defining it |
| `app/defaults/mods/worktree/main.js` | modify | `task` prop + agent picker (D1/D3); `action: "clean"` view (D5) |
| `app/defaults/mods/worktree/clean.js` | create | Pure: parse porcelain incl. prunable, parse `[gone]`, classify a worktree |
| `app/scripts/worktree.test.ts` | modify | Use `load` (inlines `clean.js`); tests for task, picker, clean |
| `app/defaults/mods/prdiff/agent.js` | create | Find the branch's agents, `hc send`, task texts, log tail |
| `app/defaults/mods/prdiff/forge.js` | modify | `checks`, `checkLog`, `rerun`, `checksInBrowser`; GitLab `refs.pipeline` |
| `app/defaults/mods/prdiff/checks.js` | create | Checks tab and log view rendering |
| `app/defaults/mods/prdiff/main.js` | modify | → Agent on comments, Checks tab state, log, re-run |
| `app/scripts/pragent.test.ts` | create | D3 + agent.js tests |
| `app/scripts/prchecks.test.ts` | create | D2 tests (board chip + window) |
| `app/defaults/mods/prboard/forge.js` | modify | Export `ask` (was private `run`), `rollup`, `ci` on GitHub rows |
| `app/defaults/mods/prboard/issues.js` | create | Issue lists, body, branch name, task text, local checkout lookup |
| `app/defaults/mods/prboard/main.js` | modify | CI dot on cards; Pull requests / Issues switch; issue cards; Start work; ＋ new PR |
| `app/scripts/issues.test.ts` | create | D1 tests |
| `app/defaults/mods/propen/{mod.json,main.js,git.js}` | create | D4 dialog |
| `app/scripts/propen.test.ts` | create | D4 tests |
| `app/defaults/mods/menu/main.js` | modify | Space menu: "Open pull request", "Clean up worktrees" |

---

### Task 0: Shared mod test harness

**Files:**
- Create: `app/scripts/mod-harness.ts`
- Modify: `app/scripts/prboard.test.ts:1-66`

**Interfaces:**
- Produces:
  - `load(name: string, cls: string): Promise<string>`, moved unchanged from `prboard.test.ts`.
  - `element`, `textOf`, `findId`, `findList`, and `type Reply`, all moved unchanged.
  - `harness(source, cls, replies, props = {}, folder = "/repo", extra: Record<string, any> = {})` → `{ view, cx, calls, overlays, store, settle, runs, hcCalls, notes }`. Over today's version it adds these default globals: `run(name, args)` pushes `[name, args]` to `runs`; `hc(args)` pushes `args` to `hcCalls` and returns `{ stderr: "", ...replies("hc", args) }`; `notify(n)` pushes `n` to `notes`; `agents: () => []`; `knownAgents: async () => []`; `hc`; `TextareaState: { new: (o) => ({ on() {}, value: () => o?.value ?? "", set_value() {}, set_rows() {}, focus() {} }) }`; `Textarea: { new: () => element() }`; `home: () => "/home/user"`. Entries in `extra` override any global, including `spaces` and `panes`.

- [ ] **Step 1:** Move the helpers into `mod-harness.ts` with the additions above and export them. In `prboard.test.ts`, replace lines 1–66 with `import { load, harness, textOf, findId, findList, type Reply } from "./mod-harness";`.
- [ ] **Step 2:** Run `cd app && bun test scripts/prboard.test.ts`. Expected: every existing test passes, with the same count as before the move.
- [ ] **Step 3:** Commit: `app: share the mod test harness`.

---

### Task 1: Worktree dialog takes a task and an agent (D1/D3 prerequisite)

**Files:**
- Modify: `app/defaults/mods/worktree/main.js` (`init`, `create()` at ~line 184, `render`)
- Modify: `app/scripts/worktree.test.ts`
- Modify: `app/defaults/AGENTS.md` (the worktree dialog's props), `docs/upstream.md`

**Interfaces:**
- Consumes: `knownAgents({ on })` from `herdr` (`Program & { run: string[]; installed: boolean }`).
- Produces: worktree props `{ folder?, machine?, space?, action: "new", branch?, tab?, argv?, task? }`. When `task` is set and `argv` isn't, the dialog shows an agent row. Enter runs `run("space.new", { folder: path, machine, tab, argv: chosen.run, task })`. The choice is remembered in `localStorage` under `"worktree.agent"` (value: the program `key`).

- [ ] **Step 1: Write the failing tests** in `worktree.test.ts`. Give its harness a `replies(command, args)` param (default: `{ code: 0, stdout: "" }`), `localStorage`, and `knownAgents`.

```ts
test("a task brings an agent picker; Enter starts that agent with the task", async () => {
  // knownAgents → [{key:"claude",name:"Claude Code",run:["claude"],installed:true},{key:"codex",name:"Codex",run:["codex"],installed:true},{key:"pi",run:["pi"],installed:false}]
  // props {folder:"/repo", action:"new", branch:"12-fix", task:"Work on #12"}; store "worktree.agent" = "codex"
  // after init settles: textOf(render) contains "Codex"; the uninstalled "pi" isn't listed
  // create(): writes[0] equals ["space.new", { folder: "/home/user/.herdr/worktrees/repo/12-fix", machine: "", tab: undefined, argv: ["codex"], task: "Work on #12" }]
});
test("picking another agent is remembered", () => { /* pickAgent(0) → store "worktree.agent" === "claude" */ });
test("a task with no installed agent says so and creates nothing", async () => {
  // knownAgents → [] ; go() → worktree.error === "No agent is installed to take this task."; writes === []
});
test("a branch checked out elsewhere shows git's words and opens no space", async () => {
  // replies: git worktree add → { code: 128, stderr: "fatal: '12-fix' is already checked out at '/repo'" }
  // go() → error contains "already checked out"; no "space.new" in writes
});
test("no task, no picker: today's dialog is unchanged", () => { /* textOf(render) has no agent row; create passes task: undefined */ });
```

- [ ] **Step 2:** Run `cd app && bun test scripts/worktree.test.ts`. Expected: the new tests FAIL (`pickAgent` isn't defined; no `task` in `space.new`).
- [ ] **Step 3: Implement it in `worktree/main.js`.** In `init`, when `props().task && !props().argv`, load `knownAgents({ on: this.on })` installed-only into `this.agents`. `this.pick` is the index of the stored key, or 0. Add `pickAgent(i)`, which sets `this.pick` and stores the key. `create()` checks for a missing agent before `git worktree add`, then passes `argv: p.argv ?? this.agents?.[this.pick]?.run` and `task: p.task`. Render a row of agent pills (`id: wt-agent-<i>`) under the branch input. Raise the dialog's default height from 260 to 300 only when a task is given; that's the caller's `openOverlay` height.
- [ ] **Step 4:** Run the same command. Expected: PASS, and every older worktree test still passes.
- [ ] **Step 5:** Add a line to the AGENTS.md worktree props and a `docs/upstream.md` row ("worktree dialog: `task` and an agent picker"). Commit: `app: the worktree dialog can start an agent with a task`.

---

### Task 2: Find the branch's agent and talk to it (`prdiff/agent.js`)

**Files:**
- Create: `app/defaults/mods/prdiff/agent.js`
- Create: `app/scripts/pragent.test.ts` (add it to the justfile `test:` line)

**Interfaces:**
- Consumes: `agents()`, `panes()`, `spaces()`, `exec`, `hc` from `herdr`.
- Produces:
  - `sameRepo(remote: string, repo: string): boolean`. Takes the path from `git@host:path(.git)`, `ssh://git@host/path(.git)` or `https://host/path(.git)/`, then compares it case-insensitively to `repo` (e.g. `"o/r"`, `"g/sub/r"`).
  - `agentsOn(branch: string, repo: string): Promise<Target[]>` with `Target = { address: string, name: string, cwd: string, on: string | null }`. It covers agents whose pane has `branch === branch` and whose `cwd`'s `git remote get-url origin` (run `{ cwd, on: space.machine }`) satisfies `sameRepo`. `name` is `` `${a.tab_name} · ${a.program.name}` ``.
  - `tell(address: string, text: string): Promise<void>` calls `hc(["send", address, "--", text])` and throws `Error(stderr || stdout)` when the code isn't 0.
  - `reviewTask(p, c): string`, `checkTask(p, check, log): string`, and `tail(text: string, lines = 120, chars = 8000): string`. `p` is the window's `{ pr, forge, repo }`, `c` a comment `{ author, body, path?, line? }`, and `check` a `Check` (Task 5).

Exact copy (`ref` is `#N` on GitHub and `!N` on GitLab):

```js
reviewTask: `Review comment on ${ref} (${pr.title}) by @${c.author}${c.path ? ` on ${c.path}:${c.line}` : ""}:\n\n${c.body}\n\nAddress it on branch ${pr.branch}, commit, and push. Reply with what you changed.`
checkTask:  `CI check "${check.name}" failed on ${ref} (${pr.title}), branch ${pr.branch}. The end of its log:\n\n\`\`\`\n${log}\n\`\`\`\n\nFind the cause, fix it on this branch, commit, and push.`
```

`tail` removes `/\x1b\[[0-9;?]*[A-Za-z]/g` and `\r`, keeps the last `lines` lines, then the last `chars` characters.

- [ ] **Step 1: Write the failing tests** (load with `load("prdiff", "PrDiff")`; the harness's `extra` supplies `agents`, `panes` and `spaces`):

```ts
test("sameRepo reads ssh, https and nested GitLab paths", () => {
  expect(sameRepo("git@github.com:O/R.git\n", "o/r")).toBe(true);
  expect(sameRepo("https://gitlab.example.com/g/sub/r/", "g/sub/r")).toBe(true);
  expect(sameRepo("ssh://git@github.com/o/r2.git", "o/r")).toBe(false);
});
test("agentsOn keeps only agents on the branch in a checkout of the same repo", async () => {
  // agents: t1 (pane p1), t2 (p2), vps/t3 (vps/p3, space s2 machine "vps")
  // panes: p1 {branch:"fix", cwd:"/a"}, p2 {branch:"fix", cwd:"/b"}, vps/p3 {branch:"fix", cwd:"/srv/r"}
  // origin: /a → git@github.com:o/r.git ; /b → git@github.com:other/r.git ; /srv/r (on vps) → https://github.com/o/r
  // → addresses ["t1", "vps/t3"]; the exec for /srv/r had on: "vps"
});
test("tell sends flag-looking text after --", async () => {
  // tell("t1", "--force $(rm -rf ~)") → hcCalls[0] deep-equals ["send", "t1", "--", "--force $(rm -rf ~)"]
});
test("tell surfaces hc's error", async () => { /* hc → {code:1, stderr:"no terminal t9"} → rejects "no terminal t9" */ });
test("task texts name the PR the forge's way", () => {
  // reviewTask({pr:{num:7,title:"Fix it",branch:"fix"},forge:"gh"}, {author:"jon",body:"Log this?",path:"src/a.rs",line:2})
  //   === "Review comment on #7 (Fix it) by @jon on src/a.rs:2:\n\nLog this?\n\nAddress it on branch fix, commit, and push. Reply with what you changed."
  // checkTask with forge "glab", num 3 starts with 'CI check "test" failed on !3 '
});
test("tail strips colour and keeps the end", () => {
  // tail("\x1b[31ma\x1b[0m\r\nb\nc", 2) === "b\nc" ; tail("x".repeat(9000), 120, 8000).length === 8000
});
```

- [ ] **Step 2:** Run `cd app && bun test scripts/pragent.test.ts`. Expected: FAIL (not defined).
- [ ] **Step 3:** Implement `agent.js` with the signatures above. Its imports: `import { agents, panes, spaces, exec, hc } from "herdr";`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `app: find and message the agent on a pull request's branch`.

---

### Task 3: → Agent on review comments (D3)

**Files:**
- Modify: `app/defaults/mods/prdiff/main.js` (`commentsTab` ~line 276, new methods, render strip)
- Modify: `app/scripts/pragent.test.ts`, `app/defaults/AGENTS.md`

**Interfaces:**
- Consumes: `agentsOn`, `tell` and `reviewTask` (Task 2); worktree props (Task 1).
- Produces these `PrDiff` methods, which Task 6 reuses:
  - `sendToAgent(text: string, label: string, cx)`. With one target it tells it and `notify({ title: "Sent to " + name, level: "success" })`. With several it sets `this.sending = { text, label, targets }` and the window shows a "Send to:" strip of target pills (`id: prdiff-target-<i>`). With none it sets `this.sending = { text, label, targets: [] }` and the strip says "No agent is on <branch>." with a **Start one** button (`id: prdiff-start-agent`).
  - `sendTo(i: number, cx)`.
  - `startAgent(cx)`. Without `this.p.cwd` it sets `this.note = "Open the board on This repo to start an agent here."`. With it, it calls `openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 300, props: { folder: this.p.cwd, machine: this.p.on, action: "new", branch: this.pr.branch, task: text } })` and clears `sending`.

  `pr.branch` comes from `details()` when the props didn't carry it.

- [ ] **Step 1: Write the failing tests** (GitHub fixtures from `prboard.test.ts`, `ghPr`/`ghView`; add `agents`/`panes`/`spaces`/`exec` replies for origin):

```ts
test("→ Agent on a line comment sends it to the one agent on the branch", async () => {
  // one agent t1 on branch "fix" in o/r; click findId(render, "prdiff-send-1") (the "Log this?" comment)
  // → hcCalls[0] equals ["send","t1","--", reviewTask(view.p, view.comments[1])]; notes[0].title === "Sent to 1 · Claude Code"
});
test("several agents: the window asks which", async () => {
  // two matching agents → view.sending.targets.length === 2, no hc call yet; sendTo(1) → hc to the second; sending === null
});
test("no agent: Start one opens the worktree dialog on the branch with the task", async () => {
  // ghProps has cwd "/repo" → overlays[0] = { mod:"worktree", props:{ folder:"/repo", action:"new", branch:"fix", task: <reviewTask text> } }
});
test("no agent and no folder explains what to do", async () => { /* cwd null → view.note === "Open the board on This repo to start an agent here." */ });
```

- [ ] **Step 2:** Run `cd app && bun test scripts/pragent.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement it. Each comment row gets a small `→ Agent` control (`id: prdiff-send-<i>`, `cx.stop_propagation()` on mouse down so the window doesn't drag), and the `sending` strip sits above the comment box. Import `agentsOn`, `tell`, `reviewTask` from `./agent.js`, and `openOverlay` from `herdr`.
- [ ] **Step 4:** Run `bun test scripts/pragent.test.ts scripts/prboard.test.ts`. Expected: PASS.
- [ ] **Step 5:** Update the AGENTS.md prdiff sentence. Commit: `app: send a review comment to the agent on the branch`.

---

### Task 4: CI result on PR cards (D2, board)

**Files:**
- Modify: `app/defaults/mods/prboard/forge.js`, `app/defaults/mods/prboard/main.js` (`card`)
- Create: `app/scripts/prchecks.test.ts` (add it to the justfile)

**Interfaces:**
- Produces `rollup(items: any[] | null | undefined): "pass" | "fail" | "pending" | null`. Rows gain `ci`: GitHub This-repo rows get `rollup(p.statusCheckRollup)`; search rows and GitLab rows get `null`.
- Rules:
  - Absent or empty input → `null`.
  - Any item with `conclusion` in `FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE`, or `state` in `FAILURE, ERROR` → `"fail"`.
  - Otherwise, any item with `status` set and not `COMPLETED`, or with `state` in `PENDING, EXPECTED` → `"pending"`.
  - Otherwise → `"pass"`.
- Also add `statusCheckRollup` to `GH_REPO`'s `--json` list.

- [ ] **Step 1: Failing tests:**

```ts
test("rollup: fail beats pending beats pass; nothing is null", () => {
  expect(rollup([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "FAILURE" }])).toBe("fail");
  expect(rollup([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("pending");
  expect(rollup([{ status: "COMPLETED", conclusion: "SKIPPED" }, { state: "SUCCESS" }])).toBe("pass");
  expect(rollup([])).toBe(null); expect(rollup(undefined)).toBe(null);
});
test("This repo cards show the CI dot; other rows don't", async () => {
  // GitHub repo fixture with statusCheckRollup [{state:"FAILURE"}] on #7 → findId(render,"pr-ci-o/r-7") exists, tooltip "Checks failing"; #8 has none
});
```

- [ ] **Step 2:** Run `bun test scripts/prchecks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `rollup`. In `card`, when `pr.ci`, render a dot (`id: pr-ci-<repo>-<num>`) before the files count: ✓ `t.done` "Checks passed", ✕ `t.blocked` "Checks failing", ● `t.working` "Checks running".
- [ ] **Step 4:** Run `bun test scripts/prchecks.test.ts scripts/prboard.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `app: show ci results on pull request cards`.

---

### Task 5: Checks tab in the PR window (D2)

**Files:**
- Modify: `app/defaults/mods/prdiff/forge.js` (new exports; `gitlab()` refs)
- Create: `app/defaults/mods/prdiff/checks.js`
- Modify: `app/defaults/mods/prdiff/main.js` (`TABS`, `refresh`, timer)
- Modify: `app/scripts/prchecks.test.ts`

**Interfaces:**
- Produces in `forge.js`:
  - `Check = { name: string, state: "pass"|"fail"|"pending"|"skip"|"cancel", workflow: string, link: string, job: string|null, run: string|null, at: string|null }`.
  - `checks(p, refs): Promise<Check[]>`.
    - GitHub: `exec gh pr checks <num> <repoFlag> --json name,state,bucket,link,workflow,startedAt,completedAt`. Accept exit codes 0, 1 and 8 when stdout parses as a JSON array. A non-zero exit whose stderr contains `no checks reported` → `[]`. Anything else throws. `state` comes from `bucket` (`skipping` → `skip`). `run` and `job` come from `link` matching `/actions/runs/(\d+)/job/(\d+)`.
    - GitLab: with no `refs.pipeline` → `[]`. Otherwise `api projects/<pid>/pipelines/<id>/jobs?per_page=100`; `name` is `` `${stage}: ${name}` ``, `job` is `String(id)`, `run` is `String(pipeline id)`, `link` is `web_url`. The `status` map is: `success`→pass, `failed`→fail, `canceled`→cancel, `skipped` and `manual`→skip, anything else→pending.
  - `gitlab()` sets `refs.pipeline = m.head_pipeline?.id ?? null`.
- Produces in `checks.js`: `checksTab(v, t)`, which renders `v.checks` (failing first, then pending, then the rest; `id: prdiff-check-<i>`), `v.checkError`, and an "Open checks in browser" link. `PrDiff` gains `this.checks = []`, `this.checkError = null` and `loadChecks(cx)`. `TABS` gains `{ id: "checks", label: "Checks" }`, which shows its failing count. `refresh` calls `loadChecks` after `details`. `cx.timer.every(30000, …)` reloads checks only while some check is pending.

- [ ] **Step 1: Failing tests:**

```ts
test("GitHub checks parse even when gh exits 8 (pending) or 1 (failed)", async () => {
  // gh pr checks → { code: 8, stdout: JSON [{name:"build",bucket:"pass",...},{name:"test",bucket:"fail",link:"https://github.com/o/r/actions/runs/11/job/22"},{name:"lint",bucket:"pending"}] }
  // → view.checks.map(c => [c.name, c.state, c.run, c.job]) ordered fail, pending, pass: [["test","fail","11","22"],["lint","pending",null,null],["build","pass",null,null]]
  // → view.checkError === null; textOf(tab bar) contains "Checks 1"
  // same again with code 1 → same checks
});
test("no checks reported is an empty list, not an error", async () => { /* code 1, stderr "no checks reported on the 'fix' branch" → checks [], checkError null */ });
test("GitLab checks are the head pipeline's jobs", async () => {
  // MR fixture adds head_pipeline {id: 90}; jobs [{id:5,name:"rspec",stage:"test",status:"failed",web_url:"…/jobs/5",pipeline:{id:90}},{id:6,name:"deploy",stage:"deploy",status:"manual"}]
  // → asked "projects/43/pipelines/90/jobs?per_page=100"; checks [["test: rspec","fail","90","5"],["deploy: deploy","skip","90","6"]]
});
test("checks reload on the timer only while one is pending", async () => { /* fire cx.timer callback: with a pending check → a new pr checks call; after all pass → none */ });
```

The harness's `cx.timer.every` must record its callbacks so tests can fire them: set `cx.timer = { every: (ms, f) => timers.push(f), after() {} }` through `extra` or a harness option.

- [ ] **Step 2:** Run `bun test scripts/prchecks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `checks`, `refs.pipeline`, `checks.js` and the main.js wiring.
- [ ] **Step 4:** Run `bun test scripts/prchecks.test.ts scripts/prboard.test.ts`. Expected: PASS. Check that `wc -c app/defaults/mods/prdiff/main.js` is under 30000.
- [ ] **Step 5:** Commit: `app: a checks tab in the pull request window`.

---

### Task 6: Check log, Fix with agent, Re-run (D2)

**Files:**
- Modify: `app/defaults/mods/prdiff/forge.js`, `prdiff/checks.js` (`logView`), `prdiff/main.js`
- Modify: `app/scripts/prchecks.test.ts`, `app/defaults/AGENTS.md`

**Interfaces:**
- Consumes: `sendToAgent` (Task 3), and `checkTask`/`tail` (Task 2).
- Produces:
  - `checkLog(p, check): Promise<string>`.
    - GitHub with a `job`: `gh run view --job <job> --log-failed <repoFlag>`. If that output is blank, fall back to `--log`. A check with no `job` (not an Actions check) rejects with `"This check's log is on its own site: open checks in browser."`.
    - GitLab: `cli(p, ["api", "projects/<pid>/jobs/<job>/trace", ...hostFlag(p)])`, which returns raw text.
  - `rerun(p, check)`: GitHub `gh run rerun <run> --failed <repoFlag>`; GitLab `api -X POST projects/<pid>/jobs/<job>/retry`.
  - `checksInBrowser(p)`: GitHub `gh pr checks <num> <repoFlag> --web`; GitLab `openInBrowser(p)`.
  - `PrDiff.openLog(i, cx)` sets `this.log = { check, text: null, error: null }`, loads it, and stores `tail(raw, 300, 60000)`. `PrDiff.closeLog(cx)` closes it. `PrDiff.fixWithAgent(cx)` calls `this.sendToAgent(checkTask(this.p, this.log.check, tail(this.log.text)), "check", cx)`. `PrDiff.rerunCheck(cx)` re-runs, notifies `"Re-running " + name`, and reloads checks.
  - `logView(v, t)` shows a header with ← Back, the check name, **Fix with agent** (`id: prdiff-fix`, only for `fail`) and **Re-run** (`id: prdiff-rerun`; it reads "Re-run failed jobs" on GitHub and "Retry job" on GitLab), then the log in a monospace virtual list.

- [ ] **Step 1: Failing tests:**

```ts
test("a failed Actions check opens its failed steps' log, tailed and uncoloured", async () => {
  // gh run view --job 22 --log-failed --repo o/r → 400 lines with \x1b[31m → view.log.text has 300 lines, no \x1b
});
test("an empty --log-failed falls back to the full log", async () => { /* first reply "", second (args include "--log") "all of it" → text "all of it" */ });
test("a non-Actions check says where its log is", async () => { /* job null → view.log.error === "This check's log is on its own site: open checks in browser." */ });
test("Fix with agent sends the check task with the log's last 120 lines", async () => {
  // one agent on branch → hcCalls[0][3] === checkTask(view.p, check, tail(view.log.text))
});
test("Re-run calls the forge's re-run and reloads checks", async () => {
  // gh: ["run","rerun","11","--failed","--repo","o/r"] ; glab: ["api","-X","POST","projects/43/jobs/5/retry","--hostname","gitlab.example.com"]
});
```

- [ ] **Step 2:** Run `bun test scripts/prchecks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it. Clicking a check row calls `openLog(i)`. In the Checks tab the body is `logView` while `this.log` is set.
- [ ] **Step 4:** Run `bun test scripts/prchecks.test.ts scripts/pragent.test.ts scripts/prboard.test.ts`. Expected: PASS. `prdiff/main.js` must be under 30000 bytes.
- [ ] **Step 5:** Update the AGENTS.md prdiff sentence (checks, logs, fix with agent, re-run). Commit: `app: read a failing check's log and hand it to the agent`.

---

### Task 7: Issues on the board (D1, list)

**Files:**
- Modify: `app/defaults/mods/prboard/forge.js` (rename private `run` → exported `ask`; no other change)
- Create: `app/defaults/mods/prboard/issues.js`
- Modify: `app/defaults/mods/prboard/main.js`
- Create: `app/scripts/issues.test.ts` (add it to the justfile)

**Interfaces:**
- Consumes: `ask(forge, args, opts)`, `login`, `forgeLabel` from `./forge.js`.
- Produces in `issues.js`:
  - `Issue = { forge, num, title, repo, pid: number|null, labels: string[], assigned: boolean, mine: boolean, url, at }`.
  - `listIssuesRepo(forge, me, opts): Promise<Issue[]>`. GitHub: `issue list --state open --limit 60 --json number,title,author,assignees,labels,updatedAt,url`. GitLab: `issue list --per-page 60 --output json` (fields `iid, project_id, title, author.username, assignees, labels` (strings), `web_url`, `updated_at`, `references.full`).
  - `listIssuesAll(forge, me, opts): Promise<Issue[]>`, merged by URL the way `listAll` merges.
    - GitHub: `search issues --state open --limit 50 --json number,title,repository,url,updatedAt,author,assignees,labels`, once with `--assignee @me` and once with `--author @me`.
    - GitLab: `api issues?state=opened&per_page=50&scope=assigned_to_me` and `…&scope=created_by_me`.
- Produces in `prboard/main.js`:
  - `KINDS = [{ id: "pulls", label: "Pull requests" }, { id: "issues", label: "Issues" }]`, stored at `"prboard.kind"`.
  - `ISSUE_COLUMNS = assigned "Assigned" / "Nothing is assigned to you."`, `created "Mine" / "You have no open issues."`, `all "All" / "No open issues."`.
  - `view()` includes the kind. `setKind(id, cx)`. When the stored column isn't in the kind's columns, use `"assigned"`.
  - `issueCard(t, row, i)`, `id: issue-<repo>-<num>`: repo (All repos only), `#num` or `!num`, up to 3 label chips, the title, and the age. A `↗` control (`id: issue-web-<repo>-<num>`) opens it in the browser: GitHub `gh issue view <num> --repo <repo> --web`; GitLab `glab issue view <num> -R <project url> --web`.
  - The header title becomes the two KINDS pills.

- [ ] **Step 1: Failing tests:**

```ts
test("Issues, every repo, on GitHub asks two searches and merges by url", async () => {
  // store prboard.kind=issues → searches [["--assignee","@me"],["--author","@me"]]; an issue in both is one row with assigned && mine
  // cols.assigned / cols.created / cols.all nums as fixtures; render shows "Assigned" not "Review"
});
test("Issues, this repo, on GitLab uses glab issue list", async () => { /* args ["issue","list","--per-page","60","--output","json"], cwd "/repo"; labels ["bug"] */ });
test("the kind is remembered and keeps each kind's cache", async () => { /* setKind("issues") → store; back to pulls → pulls rows shown at once */ });
test("a stored Review column falls back to Assigned on Issues", async () => {});
test("every exec argument is a string, issues too", async () => {});
```

- [ ] **Step 2:** Run `bun test scripts/issues.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it. `refresh()` picks `listIssuesAll`/`listIssuesRepo` or `listAll`/`listRepo` by `this.kind`, and `columns()` builds issue columns without `review`.
- [ ] **Step 4:** Run `bun test scripts/issues.test.ts scripts/prboard.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `app: issues on the pull requests board`.

---

### Task 8: Start work on an issue (D1)

**Files:**
- Modify: `app/defaults/mods/prboard/issues.js`, `prboard/main.js`
- Modify: `app/scripts/issues.test.ts`, `app/defaults/AGENTS.md`

**Interfaces:**
- Consumes: worktree props (Task 1).
- Produces:
  - `issueBody(forge, row, opts): Promise<string>`. GitHub: `issue view <num> --repo <[host/]repo> --json body` → `.body ?? ""`. GitLab: `api projects/<pid ?? encoded repo>/issues/<num>` (plus `--hostname <host>` off gitlab.com) → `.description ?? ""`.
  - `branchFor(row): string`, built as `` `${num}-${slug}` ``. `slug` is the lowercased title, runs of non-`[a-z0-9]` become `-`, ends are trimmed, and it's cut to ≤ 40 characters at a `-` boundary.
  - `issueTask(row, body): string`, with this exact copy:
    `` `Work on ${forgeLabel(row.forge)} issue ${ref} in ${row.repo}: ${row.title}\n${row.url}\n\n${body.trim().slice(0, 6000) || "(no description)"}\n\nWork on this branch and commit as you go. Don't push or open a pull request unless asked.` ``
  - `sameRepo(remote, repo)` has the same rules as `prdiff/agent.js` (copied, because mods can't share files; leave a comment saying so).
  - `findCheckout(repo): Promise<{ folder, on } | null>`. It looks at local spaces (`machine === null`) in order, takes each `folder` once, and runs `git remote get-url origin` with that `cwd`. The first that's `sameRepo` wins.
  - `PrBoard.startWork(row, cx)`. In This repo the folder is `{ folder: this.root, on }`; otherwise it's `findCheckout(row.repo)`. When none is found: `notify({ title: "No checkout of " + row.repo, body: "Open a space in a clone of it, then Start work again.", level: "warning" })`. Otherwise: `openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 300, props: { folder, machine: on, action: "new", branch: branchFor(row), task: issueTask(row, body) } })`.
  - Issue cards get a **Start work** control (`id: issue-start-<repo>-<num>`), and Enter on the selected issue does the same.

- [ ] **Step 1: Failing tests:**

```ts
test("branchFor makes a short, safe branch", () => {
  expect(branchFor({ num: 12, title: "Crash on empty config!" })).toBe("12-crash-on-empty-config");
  expect(branchFor({ num: 3, title: "Ünïcode & `$(x)` / spaces   here, and a very long tail that goes on" }).length).toBeLessThanOrEqual(43);
  expect(branchFor({ num: 3, title: "!!!" })).toBe("3");
});
test("issueTask carries the title, link and body", () => { /* exact string for a GitHub fixture; empty body → "(no description)" */ });
test("Start work in This repo opens the worktree dialog with branch and task", async () => {
  // overlays[0].props == { folder: "/repo", machine: null, action: "new", branch: "12-crash-on-empty-config", task: issueTask(row, "Steps: …") }
});
test("Start work in All repos finds the space cloned from that repo", async () => {
  // spaces: s1 /x (origin other/x), s2 /y (origin git@github.com:a/one.git) → folder "/y"
});
test("Start work with no checkout says so and opens nothing", async () => { /* notes[0].title === "No checkout of a/one"; overlays [] */ });
```

- [ ] **Step 2:** Run `bun test scripts/issues.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `bun test scripts/issues.test.ts scripts/worktree.test.ts scripts/prboard.test.ts`. Expected: PASS.
- [ ] **Step 5:** Update AGENTS.md (the board's Issues view, Start work). Commit: `app: start an agent on an issue from the board`.

---

### Task 9: Open a PR from a worktree (D4, `propen`)

**Files:**
- Create: `app/defaults/mods/propen/mod.json` (`{ "place": "none" }`), `propen/git.js`, `propen/main.js`
- Modify: `app/defaults/mods/menu/main.js` (space items ~line 66; overlay branch ~line 115), `prboard/main.js` (header ＋)
- Create: `app/scripts/propen.test.ts` (add it to the justfile)
- Modify: `app/defaults/AGENTS.md`, `docs/upstream.md`

**Interfaces:**
- Props: `{ folder: string, machine: string | null }`.
- `git.js` produces:
  - `readBranch(folder, on): Promise<Info>` with `Info = { root, branch, base, forge: "gh"|"glab", repo, commits: { sha, subject, body }[], dirty: number }`. Commits are listed oldest first.
    - `root`: `git rev-parse --show-toplevel`.
    - `branch`: `git rev-parse --abbrev-ref HEAD`. If it's `HEAD`, throw `"Detached HEAD: check out a branch first."`.
    - `base`: `git symbolic-ref --short refs/remotes/origin/HEAD` minus `origin/`; otherwise `main` if `git show-ref --verify --quiet refs/remotes/origin/main` succeeds; otherwise `master`.
    - `repo`: the path of `origin`, as `sameRepo` reads it.
    - `forge`: `/gitlab/i` on origin → `glab`, else `gh`.
    - `commits`: `git log --reverse --format=%H%x1f%s%x1f%b%x1e origin/<base>..HEAD`.
    - `dirty`: the line count of `git status --porcelain`.
  - `draft(branch, commits): { title, body }`. With one commit: `{ title: subject, body: body.trim() }`. With several: the title is the branch with a leading `\d+-` dropped, `[-_/]` turned into spaces, and the first letter capitalised; the body is `commits.map(c => "- " + c.subject).join("\n")`.
  - `existing(info, on): Promise<{ num, url, title } | null>`. GitHub: `gh pr list --head <branch> --state open --json number,url,title`. GitLab: `glab mr list --source-branch=<branch> --output json` (`iid`, `web_url`, `title`).
  - `createPr(info, on, { title, body, base, draft }): Promise<string>`, which returns the URL. It runs `git push -u origin <branch>` first (timeout 120000); a failure throws git's stderr. Then:
    - GitHub: `gh pr create --title=<t> --body=<b> --base=<base> --head=<branch>` plus `--draft`.
    - GitLab: `glab mr create --title=<t> --description=<b> --target-branch=<base> --source-branch=<branch> --yes` plus `--draft`.

    The URL is the last stdout line matching `^https?://`.
- `main.js` (`ProOpen` view): a title `Input`, a body `Textarea` (rows 8), a base `Input`, a Draft toggle (default on), and a create button (`id: propen-create`) labelled `` `Create ${draft ? "draft " : ""}${forge === "glab" ? "merge request" : "pull request"}` ``. Notes:
  - `dirty > 0` → `` `${n} uncommitted change${n === 1 ? "" : "s"} won't be in it.` ``
  - No commits → `` `Nothing to open: no commits ahead of origin/${base}.` `` (create is disabled).
  - An existing PR/MR → "Already open: #N title" with an **Open** button.

  After create, and for **Open**: `notify({ title: "Opened " + url, level: "success" })`, then open `prdiff` with `{ pr: { num, url, title, branch }, forge, repo, cwd: root, on }` (`num` comes from the URL's last path segment), then `closeOverlay`.
- Menu: on git spaces, `["Open pull request", "propen", { folder: place, machine }]` (the space's live folder as the menu already computes it). The menu's overlay branch opens `propen` as a dialog, 560×460.
- Board: with scope This repo and `this.root` set, a header ＋ (`id: prboard-new`) opens the same dialog with `{ folder: this.root, machine: on }`.

- [ ] **Step 1: Failing tests:**

```ts
test("draft: one commit is its own title and body", () => { expect(draft("12-x", [{ subject: "Fix crash", body: "Because.\n" }])).toEqual({ title: "Fix crash", body: "Because." }); });
test("draft: many commits list their subjects under the branch's name", () => {
  expect(draft("12-crash-on-empty", [{ subject: "a" }, { subject: "b" }])).toEqual({ title: "Crash on empty", body: "- a\n- b" });
});
test("the dialog warns about uncommitted changes and refuses an empty branch", async () => { /* status 2 lines → note "2 uncommitted changes won't be in it."; no commits → create disabled, text "Nothing to open: no commits ahead of origin/main." */ });
test("an existing PR for the branch is offered instead of a second one", async () => {});
test("detached HEAD is explained", async () => {});
test("create pushes, then creates with --flag=value args, then opens the PR window", async () => {
  // title "--force $(x)" → gh args include "--title=--force $(x)"; calls order: git push -u origin fix, gh pr create …
  // stdout "https://github.com/o/r/pull/9\n" → overlays[0] = { mod: "prdiff", props: { pr: { num: 9, … }, forge: "gh", repo: "o/r" } }
});
test("GitLab uses glab mr create with its own flags", async () => { /* --description=…, --target-branch=main, --source-branch=fix, --yes, --draft */ });
test("a failed push stops before creating", async () => { /* git push code 1 → error shown; no gh pr create call */ });
```

- [ ] **Step 2:** Run `bun test scripts/propen.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `git.js`, `main.js`, the menu entry and the board ＋.
- [ ] **Step 4:** Run `bun test scripts/propen.test.ts scripts/prboard.test.ts`, then `cd app && cargo build --locked && target/debug/herdr-app check defaults/mods/propen`. Expected: PASS, and the check prints no problems.
- [ ] **Step 5:** Update AGENTS.md (propen and the menu items) and add a `docs/upstream.md` row (menu: "Open pull request"). Commit: `app: open a pull request from a worktree`.

---

### Task 10: Worktree cleanup (D5)

**Files:**
- Create: `app/defaults/mods/worktree/clean.js`
- Modify: `app/defaults/mods/worktree/main.js` (`action: "clean"`), `app/defaults/mods/menu/main.js`
- Modify: `app/scripts/worktree.test.ts` (switch to `load("worktree", "Worktree")` from `mod-harness` so `clean.js` is inlined)
- Modify: `app/defaults/AGENTS.md`, `docs/upstream.md`

**Interfaces:**
- `clean.js` (pure) produces:
  - `listAll(porcelain): { path, branch, missing }[]`. It skips the first (main) block and `bare` blocks, and sets `missing` for `prunable` blocks. Don't name it `checkouts`; that name is taken.
  - `goneBranches(forEachRef): Set<string>`, the lines `<branch>\t[gone]`.
  - `classify(f): { reason: string, selectable: boolean, picked: boolean }` with `f = { branch, missing, inUse: string|null, dirty: number, merged: boolean, gone: boolean, base }`. First match wins:
    1. `inUse` → `` `In use by ${inUse}` ``, not selectable.
    2. `missing` → `"Folder is gone"`, picked.
    3. `dirty` → `` `${dirty} uncommitted change${dirty === 1 ? "" : "s"}` ``, not selectable.
    4. `merged` → `` `Merged into ${base}` ``, picked.
    5. `gone` → `"Branch deleted on origin"`, picked.
    6. Otherwise → `"Not merged"`, selectable, not picked.
- `main.js`, `action: "clean"`:
  - `cleanList(cx)` runs `git fetch --prune origin` (timeout 60000). A failure sets `this.note = "Couldn't reach origin; using what's known here."` and goes on.
  - It then reads the base (the same `origin/HEAD` rule as Task 9), `git branch --merged origin/<base> --format=%(refname:short)`, `git for-each-ref --format=%(refname:short)%09%(upstream:track) refs/heads`, `git worktree list --porcelain`, and, for each non-missing worktree, `git status --porcelain` with that `cwd`.
  - `inUse` is the name of `spaceOf(path, …)` or of a pane whose `cwd` is inside the path.
  - Rows have `id: wt-clean-<i>`. A click toggles a row only when it's selectable. A "Delete their branches too" toggle defaults on.
  - Enter or **Remove N** calls `removeChosen()`, which for each picked row runs `git worktree remove <path>`, or once `git worktree prune` for missing ones. Then, if the toggle is on, `git branch -d <branch>`. Never `--force` or `-D`. It collects `{ path, ok, message }` and shows "Removed N. Kept: <branch>: <git's words>". The dialog stays open until Esc or Enter.
- Menu: on git spaces, `["Clean up worktrees", "worktree", { space: tg.id, action: "clean" }]`, opened 560×480.

- [ ] **Step 1: Failing tests:**

```ts
test("listAll keeps linked worktrees and marks missing ones", () => {
  // porcelain: main /r (branch main); /w/a (branch a); /w/b (branch b, "prunable gitdir file points to non-existent location")
  // → [{path:"/w/a",branch:"a",missing:false},{path:"/w/b",branch:"b",missing:true}]
});
test("classify: in use and dirty can't be picked; merged, gone and missing are picked", () => {
  // one assertion per rule, with the exact reason strings above
});
test("clean view lists reasons and only removes what's picked, without force", async () => {
  // replies give: merged a; gone b; c dirty (" M x"); d in a space; e unmerged
  // → reasons per row; removeChosen() → exec args include ["worktree","remove","/w/a"] and ["worktree","remove","/w/b"], and ["branch","-d","a"], ["branch","-d","b"]
  // → no arg anywhere equals "--force" or "-D"; c, d, e untouched
});
test("a branch git won't delete is reported, not hidden", async () => { /* branch -d b → code 1 "error: the branch 'b' is not fully merged" → result text contains "b: error: the branch 'b' is not fully merged" */ });
test("an unreachable origin still lists from local refs", async () => { /* fetch code 128 → note "Couldn't reach origin; using what's known here."; rows still listed */ });
```

- [ ] **Step 2:** Run `bun test scripts/worktree.test.ts`. Expected: the new tests FAIL; the older ones still pass after the loader switch.
- [ ] **Step 3:** Implement `clean.js`, the clean view in `main.js`, and the menu item. Check that `wc -c app/defaults/mods/worktree/main.js` is under 30000.
- [ ] **Step 4:** Run `bun test scripts/worktree.test.ts`. Expected: PASS.
- [ ] **Step 5:** Update AGENTS.md and `docs/upstream.md` (worktree: clean action; menu item). Commit: `app: clean up finished worktrees`.

---

### Task 11: Whole-loop verification and docs

**Files:**
- Modify: `docs/plan.md` (P5: list F13–F17 with a link to this plan), `CLAUDE.md` Status line (at milestone end)

- [ ] **Step 1:** Run `cd app && just test`. Expected: all Bun suites (including `pragent`, `prchecks`, `issues`, `propen`) and `cargo test --locked` pass. Paste the summary lines into the PR description.
- [ ] **Step 2:** Run `cd app && cargo build --locked`, then `target/debug/herdr-app check` on each of `defaults/mods/prboard`, `prdiff`, `worktree`, `propen` and `menu`. Expected: no problems reported.
- [ ] **Step 3:** Check sizes with `wc -c app/defaults/mods/{prboard,prdiff,worktree,propen}/*.js`. Expected: every file under 32768 bytes, and `prdiff/main.js` and `worktree/main.js` under 30000.
- [ ] **Step 4:** Do a manual pass on the scratch home only (`just dev`). Read-only actions on the user's real `gh`/`glab` are fine. Show the user screenshots before any outward action. Using `herdr-app shot`, capture: the board's Issues view, a PR window's Checks tab with a log open, the worktree dialog with a task and agent picker, `propen` on a scratch branch (don't click Create), and the clean dialog on a scratch repo with `/var/tmp` worktrees.
- [ ] **Step 5:** Request `/code-review high` on the branch and fix what it confirms. Then commit: `repo: list the forge loop in the plan`.

---

## Self-review notes

- Spec coverage: F13 → Tasks 1, 7, 8; F14 → Tasks 4, 5, 6; F15 → Tasks 1, 2, 3; F16 → Task 9; F17 → Task 10.
- Names used across tasks: `sendToAgent`, `agentsOn`, `tell`, `reviewTask`, `checkTask`, `tail`, `Check`, `checks`, `checkLog`, `rerun`, `checksInBrowser`, `rollup`, `ask`, `branchFor`, `issueTask`, `findCheckout`, `readBranch`, `draft`, `existing`, `createPr`, `listAll` (worktree/clean.js; different mod from prboard's `listAll`, so no collision), `goneBranches`, `classify`.
- Every Review Focus item has a test: 1 → Task 5 "exits 8 or 1"; 2 → Task 2 "agentsOn keeps only…"; 3 → Task 2 "tell sends… after --" and Task 9 "--flag=value"; 4 → Task 1 "branch checked out elsewhere"; 5 → Task 10 "classify" and "only removes what's picked".
