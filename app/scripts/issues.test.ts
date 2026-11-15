import { test, expect } from "bun:test";
import { load, harness, textOf, findId, type Reply } from "./mod-harness";

const board = await load("prboard", "PrBoard");

// ---------------------------------------------------------------- fixtures

const ghIssue = (n: number, repo: string, extra: any = {}) => ({ number: n, title: `Issue ${n}`, repository: { nameWithOwner: repo }, url: `https://github.com/${repo}/issues/${n}`, author: { login: "x" }, assignees: [], labels: [], updatedAt: "2026-11-12T00:00:00Z", ...extra });
const ghIssueSearch: Record<string, any[]> = {
  "--assignee": [ghIssue(1, "a/one", { labels: [{ name: "bug" }, { name: "ui" }, { name: "p1" }, { name: "extra" }] }), ghIssue(2, "b/two", { author: { login: "me" } })],
  "--author": [ghIssue(2, "b/two", { author: { login: "me" } }), ghIssue(3, "c/three", { author: { login: "me" } })],
};
const ghPulls = JSON.stringify([{ number: 7, title: "Fix it", author: { login: "me" }, reviewRequests: [], assignees: [], url: "https://github.com/o/r/pull/7" }]);
const glIssue = (iid: number, path: string, extra: any = {}) => ({ iid, project_id: 40 + iid, title: `Issue ${iid}`, author: { username: "x" }, assignees: [], labels: [], web_url: `https://gitlab.example.com/${path}/-/issues/${iid}`, references: { full: `${path}#${iid}` }, updated_at: "2026-11-12T00:00:00Z", ...extra });

function github(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
  if (args[0] === "api") return { code: 0, stdout: JSON.stringify({ login: "me" }) };
  if (args[0] === "search" && args[1] === "issues") return { code: 0, stdout: JSON.stringify(ghIssueSearch[args.find((a) => a in ghIssueSearch)!]) };
  if (args[0] === "search") return { code: 0, stdout: "[]" };
  if (args[0] === "issue" && args[1] === "list") return { code: 0, stdout: JSON.stringify([ghIssue(5, "o/r", { assignees: [{ login: "me" }] })]) };
  if (args[0] === "issue") return { code: 0, stdout: "" };
  return { code: 0, stdout: ghPulls };
}
function gitlab(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@gitlab.example.com:g/r.git\n" };
  if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: JSON.stringify({ username: "me" }) };
  if (args[0] === "api" && args[1].includes("assigned_to_me")) return { code: 0, stdout: JSON.stringify([glIssue(4, "g/other", { assignees: [{ username: "ME" }] })]) };
  if (args[0] === "api" && args[1].includes("created_by_me")) return { code: 0, stdout: JSON.stringify([glIssue(6, "g/r", { author: { username: "me" } })]) };
  if (args[0] === "api") return { code: 0, stdout: "[]" };
  if (args[0] === "issue" && args[1] === "list") return { code: 0, stdout: JSON.stringify([glIssue(3, "g/r", { labels: ["bug"], author: { username: "me" } })]) };
  return { code: 0, stdout: "[]" };
}
const nums = (rows: any[]) => rows.map((p) => p.num);

// ---------------------------------------------------------------- issues

test("Issues, every repo, on GitHub asks two searches and merges by url", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.kind", "issues");
  h.view.init({}, h.cx);
  await h.settle();
  const searches = h.calls.filter((c) => c.command === "gh" && c.args[0] === "search");
  expect(searches.every((c) => c.args[1] === "issues")).toBe(true);
  expect(searches.map((c) => c.args.slice(-2))).toEqual([["--assignee", "@me"], ["--author", "@me"]]);
  expect(searches[0].args.slice(0, 7)).toEqual(["search", "issues", "--state", "open", "--limit", "50", "--json"]);
  expect(nums(h.view.cols.assigned)).toEqual([1, 2]);
  expect(nums(h.view.cols.created)).toEqual([2, 3]);
  expect(nums(h.view.cols.all)).toEqual([1, 2, 3]);
  const both = h.view.cols.all.find((p: any) => p.num === 2);
  expect([both.assigned, both.mine, both.repo, both.forge]).toEqual([true, true, "b/two", "gh"]);
  expect(h.view.cols.all[0].labels).toEqual(["bug", "ui", "p1", "extra"]);
  const text = textOf(h.view.render(h.cx).node);
  expect(text).toContain("Assigned");
  expect(text).not.toContain("Review");
  expect(text).toContain("a/one");
  expect(text).toContain("#1");
  expect(text).toContain("p1");
  expect(text).not.toContain("extra");
});

test("Issues, this repo, on GitLab uses glab issue list", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.store.set("prboard.kind", "issues");
  h.store.set("prboard.forge", "glab");
  h.store.set("prboard.scope.glab", "repo");
  h.store.set("prboard.column", "all");
  h.view.init({}, h.cx);
  await h.settle();
  const list = h.calls.find((c) => c.command === "glab" && c.args[0] === "issue");
  expect(list.args).toEqual(["issue", "list", "--per-page", "60", "--output", "json"]);
  expect(list.cwd).toBe("/repo");
  expect(h.view.error).toBe(null);
  const row = h.view.cols.all[0];
  expect([row.num, row.repo, row.pid, row.labels, row.mine, row.assigned]).toEqual([3, "g/r", 43, ["bug"], true, false]);
  expect(nums(h.view.cols.created)).toEqual([3]);
  // GitLab writes issues as #N too; !N is a merge request.
  const text = textOf(h.view.render(h.cx).node);
  expect(text).toContain("#3");
  expect(text).not.toContain("!3");
});

test("Issues, every repo, on GitLab asks the issues API by scope", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.store.set("prboard.kind", "issues");
  h.store.set("prboard.forge", "glab");
  h.view.init({}, h.cx);
  await h.settle();
  const asked = h.calls.filter((c) => c.command === "glab" && c.args[1] !== "user").map((c) => c.args[1]);
  expect(asked).toEqual(["issues?state=opened&per_page=50&scope=assigned_to_me", "issues?state=opened&per_page=50&scope=created_by_me"]);
  expect(nums(h.view.cols.assigned)).toEqual([4]);
  expect(nums(h.view.cols.created)).toEqual([6]);
  expect(h.view.cols.all.find((p: any) => p.num === 4).repo).toBe("g/other");
});

test("the kind is remembered and keeps each kind's cache", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.scope.gh", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  expect(nums(h.view.cols.all)).toEqual([7]);
  h.view.setKind("issues", h.cx);
  await h.settle();
  expect(h.store.get("prboard.kind")).toBe("issues");
  expect(nums(h.view.cols.all)).toEqual([5]);
  expect(h.view.cols.all[0].assigned).toBe(true);
  h.view.setKind("pulls", h.cx);
  expect(nums(h.view.cols.all)).toEqual([7]);
  await h.settle();
});

test("a stored Review column falls back to Assigned on Issues", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.kind", "issues");
  h.store.set("prboard.column", "review");
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.column).toBe("assigned");
  const h2 = harness(board, "PrBoard", github);
  h2.store.set("prboard.column", "review");
  h2.view.init({}, h2.cx);
  await h2.settle();
  h2.view.setKind("issues", h2.cx);
  expect(h2.view.column).toBe("assigned");
  await h2.settle();
});

test("↗ opens an issue in the browser, and only on a click", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.kind", "issues");
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.calls.some((c) => c.args.includes("--web"))).toBe(false);
  const tree = h.view.render(h.cx).node;
  expect(findId(tree, "issue-a/one-1")).toBeTruthy();
  findId(tree, "issue-web-a/one-1").click({}, h.cx);
  await h.settle();
  expect(h.calls.at(-1).args).toEqual(["issue", "view", "1", "--repo", "a/one", "--web"]);

  const g = harness(board, "PrBoard", gitlab);
  g.store.set("prboard.kind", "issues");
  g.store.set("prboard.forge", "glab");
  g.view.init({}, g.cx);
  await g.settle();
  findId(g.view.render(g.cx).node, "issue-web-g/other-4").click({}, g.cx);
  await g.settle();
  expect(g.calls.at(-1).args).toEqual(["issue", "view", "4", "-R", "https://gitlab.example.com/g/other", "--web"]);
});

test("every exec argument is a string, issues too", async () => {
  for (const [forge, scope, replies] of [["gh", "all", github], ["gh", "repo", github], ["glab", "all", gitlab], ["glab", "repo", gitlab]] as const) {
    const h = harness(board, "PrBoard", replies);
    h.store.set("prboard.kind", "issues");
    h.store.set("prboard.forge", forge);
    h.store.set(`prboard.scope.${forge}`, scope);
    h.store.set("prboard.column", "all");
    h.view.init({}, h.cx);
    await h.settle();
    const row = h.view.cols.all[0];
    findId(h.view.render(h.cx).node, `issue-web-${row.repo}-${row.num}`).click({}, h.cx);
    await h.settle();
    expect(h.calls.some((c) => c.args.includes("--web"))).toBe(true);
    for (const c of h.calls) for (const a of c.args) expect(typeof a).toBe("string");
  }
});
