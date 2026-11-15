import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { load, harness, fns, findId, type Reply } from "./mod-harness";

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
