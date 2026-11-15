import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { load, harness, fns, findId, textOf, type Reply } from "./mod-harness";

const board = await load("prboard", "PrBoard");
const forgeRaw = await readFile(new URL("../defaults/mods/prboard/forge.js", import.meta.url), "utf8");
const forgeSource = forgeRaw.replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const { rollup } = fns(forgeSource, ["rollup"]);

// ---------------------------------------------------------------- rollup

test("rollup: fail beats pending beats pass; nothing is null", () => {
  expect(rollup([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "FAILURE" }])).toBe("fail");
  expect(rollup([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("pending");
  expect(rollup([{ status: "COMPLETED", conclusion: "SKIPPED" }, { state: "SUCCESS" }])).toBe("pass");
  expect(rollup([])).toBe(null);
  expect(rollup(undefined)).toBe(null);
});

// ---------------------------------------------------------------- fixtures

const ghRepoListWithCI = JSON.stringify([
  {
    number: 7, title: "Failing PR", author: { login: "me" }, headRefName: "fix", baseRefName: "main",
    additions: 3, deletions: 1, changedFiles: 2, isDraft: false, reviewDecision: "REVIEW_REQUIRED",
    reviewRequests: [{ login: "Me" }], assignees: [], updatedAt: "2026-11-12T00:00:00Z",
    url: "https://github.com/o/r/pull/7",
    statusCheckRollup: [{ state: "FAILURE" }],
  },
  {
    number: 8, title: "Passing PR", author: { login: "you" }, headRefName: "x", baseRefName: "main",
    isDraft: true, reviewRequests: [{ slug: "team" }], assignees: [{ login: "me" }],
    url: "https://github.com/o/r/pull/8",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  },
  {
    number: 9, title: "Pending PR", author: { login: "me" }, headRefName: "wip", baseRefName: "main",
    isDraft: false, reviewRequests: [], assignees: [],
    url: "https://github.com/o/r/pull/9",
    statusCheckRollup: [{ status: "IN_PROGRESS" }],
  },
  {
    number: 10, title: "No checks", author: { login: "me" }, headRefName: "docs", baseRefName: "main",
    isDraft: false, reviewRequests: [], assignees: [],
    url: "https://github.com/o/r/pull/10",
    statusCheckRollup: [],
  },
]);

function githubWithCI(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
  if (args[0] === "api") return { code: 0, stdout: JSON.stringify({ login: "me", username: "me" }) };
  return { code: 0, stdout: ghRepoListWithCI };
}

// ---------------------------------------------------------------- board CI dots

test("This repo cards show the CI dot; other rows don't", async () => {
  const h = harness(board, "PrBoard", githubWithCI);
  h.store.set("prboard.scope.gh", "repo");
  h.store.set("prboard.column", "all");
  h.view.init({}, h.cx);
  await h.settle();

  // Check that PRs loaded with CI data
  expect(h.view.cols.all.length).toBe(4);
  expect(h.view.cols.all[0].num).toBe(7);
  expect(h.view.cols.all[0].ci).toBe("fail");
  expect(h.view.cols.all[1].num).toBe(8);
  expect(h.view.cols.all[1].ci).toBe("pass");

  const tree = h.view.render(h.cx).node;

  // PR #7 has CI failure
  const dot7 = findId(tree, "pr-ci-o/r-7");
  expect(dot7).toBeTruthy();
  expect(dot7.tooltip).toBe("Checks failing");

  // PR #8 has CI pass
  const dot8 = findId(tree, "pr-ci-o/r-8");
  expect(dot8).toBeTruthy();
  expect(dot8.tooltip).toBe("Checks passed");

  // PR #9 has CI pending
  const dot9 = findId(tree, "pr-ci-o/r-9");
  expect(dot9).toBeTruthy();
  expect(dot9.tooltip).toBe("Checks running");

  // PR #10 has no checks
  const dot10 = findId(tree, "pr-ci-o/r-10");
  expect(dot10).toBeFalsy();
});

// ---------------------------------------------------------------- PR window Checks tab

const diff = await load("prdiff", "PrDiff");

test("GitHub checks parse even when gh exits 8 (pending) or 1 (failed)", async () => {
  const checksJson = JSON.stringify([
    { name: "build", bucket: "pass", workflow: "CI", link: "https://github.com/o/r/actions/runs/100/job/200", startedAt: "2026-11-14T10:00:00Z", completedAt: "2026-11-14T10:05:00Z" },
    { name: "test", bucket: "fail", workflow: "CI", link: "https://github.com/o/r/actions/runs/11/job/22", startedAt: "2026-11-14T10:00:00Z", completedAt: "2026-11-14T10:10:00Z" },
    { name: "lint", bucket: "pending", workflow: "Lint", link: "https://github.com/o/r/actions/runs/33", startedAt: "2026-11-14T10:15:00Z" },
  ]);

  function withChecks(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") return { code: 8, stdout: checksJson };
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", withChecks, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  expect(h.view.checks.length).toBe(3);
  const states = h.view.checks.map((c: any) => [c.name, c.state, c.run, c.job]);
  expect(states).toEqual([["test", "fail", "11", "22"], ["lint", "pending", "33", null], ["build", "pass", "100", "200"]]);
  expect(h.view.checkError).toBe(null);

  const tree = h.view.render(h.cx).node;
  const tabBar = findId(tree, "prdiff-tabs");
  expect(textOf(tabBar)).toContain("Checks 1");

  // Test with exit code 1 (failed checks)
  const withChecks1 = (command: string, args: string[]): Reply => {
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") return { code: 1, stdout: checksJson };
    return withChecks(command, args);
  };
  const h2 = harness(diff, "PrDiff", withChecks1, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h2.view.init({}, h2.cx);
  await h2.settle();
  expect(h2.view.checks.length).toBe(3);
  expect(h2.view.checkError).toBe(null);
});

test("no checks reported is an empty list, not an error", async () => {
  function noChecks(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") return { code: 1, stdout: "", stderr: "no checks reported on the 'fix' branch" };
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", noChecks, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  expect(h.view.checks).toEqual([]);
  expect(h.view.checkError).toBe(null);
});

test("GitLab checks are the head pipeline's jobs", async () => {
  function gitlabChecks(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@gitlab.example.com:g/r.git\n" };
    if (command === "glab" && args[0] === "api" && args[1] === "user") return { code: 0, stdout: JSON.stringify({ username: "me" }) };
    if (command === "glab" && args[0] === "api" && args[1] === "projects/43/merge_requests/5") {
      return { code: 0, stdout: JSON.stringify({ iid: 5, title: "Test MR", source_branch: "fix", target_branch: "main", author: { username: "me" }, head_pipeline: { id: 90 } }) };
    }
    if (command === "glab" && args[0] === "api" && args[1].startsWith("projects/43/merge_requests/5/")) {
      return { code: 0, stdout: "[]" };
    }
    if (command === "glab" && args[0] === "api" && args[1] === "projects/43/pipelines/90/jobs?per_page=100") {
      return { code: 0, stdout: JSON.stringify([
        { id: 5, name: "rspec", stage: "test", status: "failed", web_url: "https://gitlab.example.com/g/r/-/jobs/5", pipeline: { id: 90 } },
        { id: 6, name: "deploy", stage: "deploy", status: "manual", web_url: "https://gitlab.example.com/g/r/-/jobs/6", pipeline: { id: 90 } },
      ]) };
    }
    if (command === "glab" && args[0] === "mr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "[]" };
  }

  const h = harness(diff, "PrDiff", gitlabChecks, { pr: { num: 5, url: "https://gitlab.example.com/g/r/-/merge_requests/5" }, forge: "glab", repo: "g/r", pid: 43 });
  h.view.init({}, h.cx);
  await h.settle();

  expect(h.view.checks.length).toBe(2);
  const states = h.view.checks.map((c: any) => [c.name, c.state, c.run, c.job]);
  expect(states).toEqual([["test: rspec", "fail", "90", "5"], ["deploy: deploy", "skip", "90", "6"]]);
});

test("checks reload on the timer only while one is pending", async () => {
  let callCount = 0;
  const checksJson = JSON.stringify([
    { name: "build", bucket: "pending", workflow: "CI", link: "https://github.com/o/r/actions/runs/100", startedAt: "2026-11-14T10:00:00Z" },
  ]);
  const checksJsonDone = JSON.stringify([
    { name: "build", bucket: "pass", workflow: "CI", link: "https://github.com/o/r/actions/runs/100/job/200", startedAt: "2026-11-14T10:00:00Z", completedAt: "2026-11-14T10:05:00Z" },
  ]);

  function withTimer(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      callCount++;
      return { code: 0, stdout: callCount === 1 ? checksJson : checksJsonDone };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", withTimer, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  expect(h.view.checks.length).toBe(1);
  expect(h.view.checks[0].state).toBe("pending");
  expect(h.timers.length).toBe(1);
  expect(h.timers[0].ms).toBe(30000);

  const initialCallCount = callCount;
  h.timers[0].f();
  await h.settle();

  expect(callCount).toBe(initialCallCount + 1);
  expect(h.view.checks[0].state).toBe("pass");

  // Fire timer again, should not reload (no pending checks)
  h.timers[0].f();
  await h.settle();
  expect(callCount).toBe(initialCallCount + 1);
});

// ---------------------------------------------------------------- log view

test("a failed Actions check opens its failed steps' log, tailed and uncoloured", async () => {
  const logLines = Array(400).fill(0).map((_, i) => `\x1b[31mLine ${i}\x1b[0m`).join("\n");

  function withLog(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([
        { name: "test", bucket: "fail", workflow: "CI", link: "https://github.com/o/r/actions/runs/11/job/22" },
      ]) };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "view" && args.includes("--log-failed")) {
      return { code: 0, stdout: logLines };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", withLog, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  expect(h.view.checks.length).toBe(1);
  const check = h.view.checks[0];

  h.view.openLog(0, h.cx);
  await h.settle();

  expect(h.view.log).toBeTruthy();
  expect(h.view.log.check.name).toBe("test");
  expect(h.view.log.text).toBeTruthy();
  expect(h.view.log.text.split("\n").length).toBe(300);
  expect(h.view.log.text).not.toContain("\x1b");
  expect(h.view.log.error).toBe(null);
});

test("an empty --log-failed falls back to the full log", async () => {
  const fullLog = "all of it";
  let fallbackCalled = false;

  function withFallback(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([
        { name: "test", bucket: "fail", workflow: "CI", link: "https://github.com/o/r/actions/runs/11/job/22" },
      ]) };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "view") {
      if (args.includes("--log-failed")) return { code: 0, stdout: "" };
      if (args.includes("--log")) {
        fallbackCalled = true;
        return { code: 0, stdout: fullLog };
      }
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", withFallback, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  h.view.openLog(0, h.cx);
  await h.settle();

  expect(fallbackCalled).toBe(true);
  expect(h.view.log.text).toBe("all of it");
});

test("a non-Actions check says where its log is", async () => {
  function noJob(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([
        { name: "external", bucket: "fail", workflow: "External", link: "https://external.com/check" },
      ]) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", noJob, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  h.view.openLog(0, h.cx);
  await h.settle();

  expect(h.view.log.error).toBe("This check's log is on its own site: open checks in browser.");
  expect(h.view.log.text).toBe(null);
});

test("Fix with agent sends the check task with the log's last 120 lines", async () => {
  const logLines = Array(200).fill(0).map((_, i) => `Line ${i}`).join("\n");
  const agents = [{ address: "t1", pane: "p1", space: "s1", tab_name: "Tab 1", program: { name: "Claude" } }];
  const panes = [{ pane: "p1", branch: "fix", cwd: "/a" }];
  const spaces = [{ id: "s1", machine: null }];

  function withAgent(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([
        { name: "test", bucket: "fail", workflow: "CI", link: "https://github.com/o/r/actions/runs/11/job/22" },
      ]) };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "view") {
      return { code: 0, stdout: logLines };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const { checkTask, tail } = fns(diff, ["checkTask", "tail"]);
  const h = harness(diff, "PrDiff", withAgent, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r", cwd: "/a" }, "/a", { agents: () => agents, panes: () => panes, spaces: () => spaces });
  h.view.init({}, h.cx);
  await h.settle();

  h.view.tab = "checks";
  h.view.openLog(0, h.cx);
  await h.settle();

  expect(h.view.log).toBeTruthy();
  expect(h.view.log.text).toBeTruthy();

  const check = h.view.checks[0];
  const expectedTask = checkTask(h.view.p, check, tail(h.view.log.text));

  const tree = h.view.render(h.cx).node;
  const fixButton = findId(tree, "prdiff-fix");
  expect(fixButton).toBeTruthy();

  expect(typeof fixButton.click).toBe("function");
  fixButton.click({}, h.cx);
  await h.settle();

  expect(h.hcCalls.length).toBe(1);
  expect(h.hcCalls[0][0]).toBe("send");
  expect(h.hcCalls[0][3]).toBe(expectedTask);
});

test("Re-run calls the forge's re-run and reloads checks", async () => {
  let rerunCalled = false;
  let checkLoads = 0;

  function withRerun(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    if (command === "gh" && args[0] === "pr" && args[1] === "checks") {
      checkLoads++;
      return { code: 0, stdout: JSON.stringify([
        { name: "test", bucket: "fail", workflow: "CI", link: "https://github.com/o/r/actions/runs/11/job/22" },
      ]) };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "view") {
      return { code: 0, stdout: "log content" };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "rerun") {
      rerunCalled = true;
      expect(args).toEqual(["run", "rerun", "11", "--failed", "--repo", "o/r"]);
      return { code: 0, stdout: "" };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ title: "Test PR", headRefName: "fix", headRefOid: "abc123", baseRefName: "main", isDraft: false, author: { login: "me" } }) };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "" };
  }

  const h = harness(diff, "PrDiff", withRerun, { pr: { num: 7, url: "https://github.com/o/r/pull/7" }, forge: "gh", repo: "o/r" });
  h.view.init({}, h.cx);
  await h.settle();

  h.view.tab = "checks";
  h.view.openLog(0, h.cx);
  await h.settle();

  expect(h.view.log).toBeTruthy();
  expect(h.view.log.text).toBeTruthy();
  const tree = h.view.render(h.cx).node;
  const backButton = findId(tree, "prdiff-log-back");
  const rerunButton = findId(tree, "prdiff-rerun");
  expect(backButton).toBeTruthy();
  expect(rerunButton).toBeTruthy();

  const loadsBefore = checkLoads;
  expect(typeof rerunButton.click).toBe("function");
  rerunButton.click({}, h.cx);
  await h.settle();

  expect(rerunCalled).toBe(true);
  expect(checkLoads).toBe(loadsBefore + 1);
  expect(h.notes.length).toBeGreaterThan(0);
  expect(h.notes[h.notes.length - 1].title).toContain("Re-running");
});

test("GitLab re-run calls the API correctly", async () => {
  let rerunCalled = false;

  function glabRerun(command: string, args: string[]): Reply {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
    if (command === "git") return { code: 0, stdout: "git@gitlab.example.com:g/r.git\n" };
    if (command === "glab" && args[0] === "api" && args[1] === "user") return { code: 0, stdout: JSON.stringify({ username: "me" }) };
    if (command === "glab" && args[0] === "api" && args[1] === "projects/43/merge_requests/5") {
      return { code: 0, stdout: JSON.stringify({ iid: 5, title: "Test MR", source_branch: "fix", target_branch: "main", author: { username: "me" }, head_pipeline: { id: 90 } }) };
    }
    if (command === "glab" && args[0] === "api" && args[1].startsWith("projects/43/merge_requests/5/")) {
      return { code: 0, stdout: "[]" };
    }
    if (command === "glab" && args[0] === "api" && args[1] === "projects/43/pipelines/90/jobs?per_page=100") {
      return { code: 0, stdout: JSON.stringify([
        { id: 5, name: "rspec", stage: "test", status: "failed", web_url: "https://gitlab.example.com/g/r/-/jobs/5", pipeline: { id: 90 } },
      ]) };
    }
    if (command === "glab" && args[0] === "api" && args[1] === "projects/43/jobs/5/trace") {
      return { code: 0, stdout: "job log" };
    }
    if (command === "glab" && args[0] === "api" && args.includes("-X") && args.includes("POST") && args.includes("projects/43/jobs/5/retry")) {
      rerunCalled = true;
      expect(args).toContain("--hostname");
      expect(args).toContain("gitlab.example.com");
      return { code: 0, stdout: "{}" };
    }
    if (command === "glab" && args[0] === "mr" && args[1] === "diff") return { code: 0, stdout: "" };
    return { code: 0, stdout: "[]" };
  }

  const h = harness(diff, "PrDiff", glabRerun, { pr: { num: 5, url: "https://gitlab.example.com/g/r/-/merge_requests/5" }, forge: "glab", repo: "g/r", pid: 43 });
  h.view.init({}, h.cx);
  await h.settle();

  h.view.tab = "checks";
  h.view.openLog(0, h.cx);
  await h.settle();

  expect(h.view.log).toBeTruthy();
  expect(h.view.log.text).toBeTruthy();
  const tree = h.view.render(h.cx).node;
  const backButton = findId(tree, "prdiff-log-back");
  const rerunButton = findId(tree, "prdiff-rerun");
  expect(backButton).toBeTruthy();
  expect(rerunButton).toBeTruthy();

  expect(typeof rerunButton.click).toBe("function");
  rerunButton.click({}, h.cx);
  await h.settle();

  expect(rerunCalled).toBe(true);
});
