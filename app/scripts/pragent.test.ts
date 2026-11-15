// Tests for sending PR comments and CI failures to agents on the branch.

import { test, expect } from "bun:test";
import { load, harness, findId, fns } from "./mod-harness.ts";
import type { Reply } from "./mod-harness.ts";

const source = await load("prdiff", "PrDiff");

// Task 2: Helper function tests

test("sameRepo reads ssh, https and nested GitLab paths", () => {
  const { sameRepo } = fns(source, ["sameRepo"]);
  expect(sameRepo("git@github.com:O/R.git\n", "o/r")).toBe(true);
  expect(sameRepo("https://gitlab.example.com/g/sub/r/", "g/sub/r")).toBe(true);
  expect(sameRepo("ssh://git@github.com/o/r2.git", "o/r")).toBe(false);
  expect(sameRepo("https://h/o/r.git/", "o/r")).toBe(true);
  expect(sameRepo("http://h/o/r", "o/r")).toBe(true);
  expect(sameRepo("ssh://git@h:2222/o/r.git", "o/r")).toBe(true);
});

test("agentsOn keeps only agents on the branch in a checkout of the same repo", async () => {
  const agents = [
    { address: "t1", pane: "p1", space: "s1", tab_name: "Tab 1", program: { name: "Claude" } },
    { address: "t2", pane: "p2", space: "s1", tab_name: "Tab 2", program: { name: "Claude" } },
    { address: "vps/t3", pane: "vps/p3", space: "s2", tab_name: "Tab 3", program: { name: "Claude" } },
  ];
  const panes = [
    { pane: "p1", branch: "fix", cwd: "/a" },
    { pane: "p2", branch: "fix", cwd: "/b" },
    { pane: "vps/p3", branch: "fix", cwd: "/srv/r" },
  ];
  const spaces = [
    { id: "s1", machine: null },
    { id: "s2", machine: "vps" },
  ];

  let execCalls: any[] = [];
  const exec = async (cmd: string, args: string[], opts?: any) => {
    execCalls.push({ cmd, args, opts });
    if (cmd === "git" && args[0] === "remote" && opts?.cwd === "/a") {
      return { code: 0, stdout: "git@github.com:o/r.git\n", stderr: "" };
    }
    if (cmd === "git" && args[0] === "remote" && opts?.cwd === "/b") {
      return { code: 0, stdout: "git@github.com:other/r.git\n", stderr: "" };
    }
    if (cmd === "git" && args[0] === "remote" && opts?.cwd === "/srv/r" && opts?.on === "vps") {
      return { code: 0, stdout: "https://github.com/o/r\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unknown" };
  };

  const { agentsOn } = fns(source, ["agentsOn"], { agents: () => agents, panes: () => panes, spaces: () => spaces, exec });
  const result = await agentsOn("fix", "o/r");

  expect(result.length).toBe(2);
  expect(result[0].address).toBe("t1");
  expect(result[0].name).toBe("Tab 1 · Claude");
  expect(result[0].cwd).toBe("/a");
  expect(result[0].on).toBe(null);
  expect(result[1].address).toBe("vps/t3");
  expect(result[1].name).toBe("Tab 3 · Claude");
  expect(result[1].cwd).toBe("/srv/r");
  expect(result[1].on).toBe("vps");

  // Verify that /srv/r exec had on: "vps"
  const vpsExec = execCalls.find(c => c.opts?.cwd === "/srv/r");
  expect(vpsExec?.opts?.on).toBe("vps");
});

test("tell sends flag-looking text after --", async () => {
  const hcCalls: any[] = [];
  const hc = async (args: string[]) => {
    hcCalls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };

  const { tell } = fns(source, ["tell"], { hc });
  await tell("t1", "--force $(rm -rf ~)");

  expect(hcCalls.length).toBe(1);
  expect(hcCalls[0]).toEqual(["send", "t1", "--", "--force $(rm -rf ~)"]);
});

test("tell surfaces hc's error", async () => {
  const hc = async (args: string[]) => {
    return { code: 1, stdout: "", stderr: "no terminal t9" };
  };

  const { tell } = fns(source, ["tell"], { hc });

  await expect(tell("t9", "hello")).rejects.toThrow("no terminal t9");
});

test("task texts name the PR the forge's way", () => {
  const { reviewTask, checkTask } = fns(source, ["reviewTask", "checkTask"]);

  const reviewResult = reviewTask(
    { pr: { num: 7, title: "Fix it", branch: "fix" }, forge: "gh" },
    { author: "jon", body: "Log this?", path: "src/a.rs", line: 2 }
  );
  expect(reviewResult).toBe(
    "Review comment on #7 (Fix it) by @jon on src/a.rs:2:\n\nLog this?\n\nAddress it on branch fix, commit, and push. Reply with what you changed."
  );

  const checkResult = checkTask(
    { pr: { num: 3, title: "Foo", branch: "bar" }, forge: "glab" },
    { name: "test" },
    "error on line 10"
  );
  expect(checkResult.startsWith('CI check "test" failed on !3 ')).toBe(true);
  expect(checkResult).toContain("branch bar");
});

test("tail strips colour and keeps the end", () => {
  const { tail } = fns(source, ["tail"]);

  expect(tail("\x1b[31ma\x1b[0m\r\nb\nc", 2)).toBe("b\nc");
  expect(tail("x".repeat(9000), 120, 8000).length).toBe(8000);
});

// Task 3: Sending review comments to agents

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
  const h = harness(source, "PrDiff", replies, ghProps, "/repo", { agents: () => agents, panes: () => panes, spaces: () => spaces });
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
  expect(h.notes.length).toBe(1);
  expect(h.notes[0].title).toBe("Sent to 1 · Claude Code");
  expect(h.notes[0].level).toBe("success");
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
  const h = harness(source, "PrDiff", replies, ghProps, "/repo", { agents: () => agents, panes: () => panes, spaces: () => spaces });
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
  const h = harness(source, "PrDiff", replies, ghProps, "/repo", { agents: () => [], panes: () => [], spaces: () => [] });
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
  const h = harness(source, "PrDiff", replies, noCwdProps, "/repo", { agents: () => [], panes: () => [], spaces: () => [] });
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

test("Send to: a double click sends once, and × dismisses the strip", async () => {
  const agents = [
    { address: "t1", pane: "p1", tab_name: "1", program: { name: "Claude Code" }, space: "s1" },
    { address: "t2", pane: "p2", tab_name: "2", program: { name: "Claude Code" }, space: "s1" },
  ];
  const panes = [{ pane: "p1", branch: "fix", cwd: "/repo" }, { pane: "p2", branch: "fix", cwd: "/repo2" }];
  const replies = (command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return ghPr(command, args);
  };
  const h = harness(source, "PrDiff", replies, ghProps, "/repo", { agents: () => agents, panes: () => panes, spaces: () => [{ id: "s1", machine: null }] });
  h.view.init({}, h.cx);
  await h.settle();
  h.view.tab = "comments";
  findId(h.view.render(h.cx).node, "prdiff-send-1").click(null, h.cx);
  await h.settle();
  const target = findId(h.view.render(h.cx).node, "prdiff-target-0");
  target.click(null, h.cx);
  target.click(null, h.cx);
  await h.settle();
  expect(h.hcCalls.length).toBe(1);
  expect(h.view.sending).toBe(null);

  // The strip's × clears it without sending.
  findId(h.view.render(h.cx).node, "prdiff-send-1").click(null, h.cx);
  await h.settle();
  expect(h.view.sending.targets.length).toBe(2);
  findId(h.view.render(h.cx).node, "prdiff-sending-close").click(null, h.cx);
  expect(h.view.sending).toBe(null);
  expect(findId(h.view.render(h.cx).node, "prdiff-target-0")).toBeFalsy();
  expect(h.hcCalls.length).toBe(1);
});

test("No agent: × dismisses the strip too", async () => {
  const replies = (command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return ghPr(command, args);
  };
  const h = harness(source, "PrDiff", replies, ghProps, "/repo", { agents: () => [], panes: () => [], spaces: () => [] });
  h.view.init({}, h.cx);
  await h.settle();
  h.view.tab = "comments";
  findId(h.view.render(h.cx).node, "prdiff-send-1").click(null, h.cx);
  await h.settle();
  expect(findId(h.view.render(h.cx).node, "prdiff-start-agent")).toBeTruthy();
  findId(h.view.render(h.cx).node, "prdiff-sending-close").click(null, h.cx);
  expect(h.view.sending).toBe(null);
  expect(h.overlays.length).toBe(0);
});
