// Tests for sending PR comments and CI failures to agents on the branch.

import { test, expect } from "bun:test";
import { load, harness, findId, textOf } from "./mod-harness.ts";
import type { Reply } from "./mod-harness.ts";

const diff = await load("prdiff", "PrDiff");

const DIFF = [
  "diff --git a/src/a.rs b/src/a.rs",
  "index abc123..def456 100644",
  "--- a/src/a.rs",
  "+++ b/src/a.rs",
  "@@ -1,2 +1,3 @@",
  " unchanged",
  "-old line",
  "+new line 1",
  "+new line 2",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index abc..123 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "bye",
].join("\n");

const ghView = JSON.stringify({
  title: "Fix it", headRefName: "fix", headRefOid: "head123", baseRefName: "main", reviewDecision: "CHANGES_REQUESTED", isDraft: false,
  author: { login: "can" }, assignees: [{ login: "sub" }], reviewRequests: [{ login: "jon" }, { slug: "core-team", name: "Core" }],
  latestReviews: [{ author: { login: "mira" }, state: "APPROVED" }],
  reviews: [{ author: { login: "mira" }, state: "APPROVED", body: "Looks good", submittedAt: "2026-11-12T02:00:00Z" }],
  comments: [{ author: { login: "jon" }, body: "First", createdAt: "2026-11-12T01:00:00Z" }],
  commits: [{ oid: "a1f3c9e0000", messageHeadline: "core: shorter path", authors: [{ login: "can", name: "Can" }], committedDate: "2026-11-12T00:00:00Z" }],
});

const REVIEW_COMMENTS = JSON.stringify([
  { user: { login: "jon" }, body: "Log this?", created_at: "2026-11-12T01:30:00Z", path: "src/a.rs", line: 2, side: "RIGHT" },
]);

function ghPr(command: string, args: string[]): Reply {
  if (args[1] === "diff") return { code: 0, stdout: DIFF };
  if (args[0] === "api" && args.includes("POST")) return { code: 0, stdout: "{}" };
  if (args[0] === "api" && args.some((a) => a.endsWith("/comments?per_page=100"))) return { code: 0, stdout: REVIEW_COMMENTS };
  if (args[0] === "api" && args.some((a) => a.includes("/commits/"))) return { code: 0, stdout: DIFF.split("diff --git a/gone.txt")[0] };
  if (args[1] === "view") return { code: 0, stdout: ghView };
  return { code: 0, stdout: "" };
}

const ghProps = { pr: { num: 7, title: "Fix it" }, forge: "gh", repo: "o/r", cwd: "/repo", on: null };

test("→ Agent on a line comment sends it to the one agent on the branch", async () => {
  const agents = [
    { address: "t1", pane: "p1", tab_name: "1", program: { name: "Claude Code" }, space: "s1" },
  ];
  const panes = [
    { pane: "p1", branch: "fix", cwd: "/repo" },
  ];
  const spaces = [
    { id: "s1", machine: null },
  ];
  const replies = (command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return ghPr(command, args);
  };
  const h = harness(diff, "PrDiff", replies, ghProps, "/repo", { agents: () => agents, panes: () => panes, spaces: () => spaces });
  h.view.init({}, h.cx);
  await h.settle();

  // Switch to comments tab
  h.view.tab = "comments";

  // Click → Agent on the second comment (the line comment "Log this?")
  const render = h.view.render(h.cx).node;
  const control = findId(render, "prdiff-send-1");
  expect(control).toBeTruthy();
  control.click(null, h.cx);
  await h.settle();

  expect(h.hcCalls.length).toBe(1);
  expect(h.hcCalls[0]).toEqual(["send", "t1", "--", 'Review comment on #7 (Fix it) by @jon on src/a.rs:2:\n\nLog this?\n\nAddress it on branch fix, commit, and push. Reply with what you changed.']);
  expect(h.notes.filter(Boolean).length).toBe(1);
  expect(h.notes.filter(Boolean)[0].title).toBe("Sent to 1 · Claude Code");
  expect(h.notes.filter(Boolean)[0].level).toBe("success");
});

test("several agents: the window asks which", async () => {
  const agents = [
    { address: "t1", pane: "p1", tab_name: "1", program: { name: "Claude Code" }, space: "s1" },
    { address: "t2", pane: "p2", tab_name: "2", program: { name: "Claude Code" }, space: "s2" },
  ];
  const panes = [
    { pane: "p1", branch: "fix", cwd: "/repo" },
    { pane: "p2", branch: "fix", cwd: "/repo2" },
  ];
  const spaces = [
    { id: "s1", machine: null },
    { id: "s2", machine: null },
  ];
  const replies = (command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return ghPr(command, args);
  };
  const h = harness(diff, "PrDiff", replies, ghProps, "/repo", { agents: () => agents, panes: () => panes, spaces: () => spaces });
  h.view.init({}, h.cx);
  await h.settle();

  // Switch to comments tab
  h.view.tab = "comments";

  // Click → Agent on the line comment
  const render = h.view.render(h.cx).node;
  const control = findId(render, "prdiff-send-1");
  control.click(null, h.cx);
  await h.settle();

  expect(h.view.sending.targets.length).toBe(2);
  expect(h.hcCalls.length).toBe(0);

  // Now click the second target
  h.view.sendTo(1, h.cx);
  await h.settle();

  expect(h.hcCalls.length).toBe(1);
  expect(h.hcCalls[0][0]).toBe("send");
  expect(h.hcCalls[0][1]).toBe("t2");
  expect(h.view.sending).toBe(null);
});

test("no agent: Start one opens the worktree dialog on the branch with the task", async () => {
  const replies = (command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return ghPr(command, args);
  };
  const h = harness(diff, "PrDiff", replies, ghProps, "/repo", { agents: () => [], panes: () => [], spaces: () => [] });
  h.view.init({}, h.cx);
  await h.settle();

  // Switch to comments tab
  h.view.tab = "comments";

  // Click → Agent on the line comment
  const render = h.view.render(h.cx).node;
  const control = findId(render, "prdiff-send-1");
  control.click(null, h.cx);
  await h.settle();

  expect(h.view.sending.targets.length).toBe(0);

  // Click "Start one"
  const startRender = h.view.render(h.cx).node;
  const startBtn = findId(startRender, "prdiff-start-agent");
  expect(startBtn).toBeTruthy();
  startBtn.click(null, h.cx);
  await h.settle();

  expect(h.overlays.length).toBe(1);
  expect(h.overlays[0]).toEqual({
    mod: "worktree",
    kind: "dialog",
    width: 440,
    height: 300,
    props: {
      folder: "/repo",
      machine: null,
      action: "new",
      branch: "fix",
      task: 'Review comment on #7 (Fix it) by @jon on src/a.rs:2:\n\nLog this?\n\nAddress it on branch fix, commit, and push. Reply with what you changed.',
    },
  });
  expect(h.view.sending).toBe(null);
});

test("no agent and no folder explains what to do", async () => {
  const noCwdProps = { pr: { num: 7, title: "Fix it" }, forge: "gh", repo: "o/r", cwd: null, on: null };
  const replies = (command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return ghPr(command, args);
  };
  const h = harness(diff, "PrDiff", replies, noCwdProps, "/repo", { agents: () => [], panes: () => [], spaces: () => [] });
  h.view.init({}, h.cx);
  await h.settle();

  // Switch to comments tab
  h.view.tab = "comments";

  // Click → Agent
  const render = h.view.render(h.cx).node;
  const control = findId(render, "prdiff-send-1");
  control.click(null, h.cx);
  await h.settle();

  expect(h.view.sending.targets.length).toBe(0);

  // Click "Start one"
  const startRender = h.view.render(h.cx).node;
  const startBtn = findId(startRender, "prdiff-start-agent");
  startBtn.click(null, h.cx);
  await h.settle();

  expect(h.view.note).toBe("Open the board on This repo to start an agent here.");
  expect(h.overlays.length).toBe(0);
});
