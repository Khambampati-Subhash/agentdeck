import { test, expect } from "bun:test";
import { load, harness, fns, textOf, findId, type Reply } from "./mod-harness";

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

// ---------------------------------------------------------------- start work

const { branchFor, issueTask, sameRepo } = fns(board, ["branchFor", "issueTask", "sameRepo"]);
const crash = { forge: "gh", num: 12, title: "Crash on empty config!", repo: "o/r", pid: null, labels: [], assigned: true, mine: false, url: "https://github.com/o/r/issues/12", at: "2026-11-12T00:00:00Z" };

test("branchFor makes a short, safe branch", () => {
  expect(branchFor({ num: 12, title: "Crash on empty config!" })).toBe("12-crash-on-empty-config");
  const long = branchFor({ num: 3, title: "Ünïcode & `$(x)` / spaces   here, and a very long tail that goes on" });
  expect(long.length).toBeLessThanOrEqual(43);
  expect(long).toMatch(/^3-[a-z0-9]+(-[a-z0-9]+)*$/);
  expect(branchFor({ num: 3, title: "!!!" })).toBe("3");
  expect(branchFor({ num: 9, title: "a".repeat(60) })).toBe("9-" + "a".repeat(40));
});

test("issueTask carries the title, link and body", () => {
  expect(issueTask(crash, "  Steps: run it.\n")).toBe(
    "Work on GitHub issue #12 in o/r: Crash on empty config!\nhttps://github.com/o/r/issues/12\n\nSteps: run it.\n\nWork on this branch and commit as you go. Don't push or open a pull request unless asked.");
  expect(issueTask(crash, "  ")).toContain("\n\n(no description)\n\n");
  expect(issueTask({ ...crash, forge: "glab" }, "x")).toStartWith("Work on GitLab issue #12 in o/r:");
  expect(issueTask(crash, "y".repeat(9000))).toContain("y".repeat(6000) + "\n\nWork on this branch");
  expect(issueTask(crash, "y".repeat(9000))).not.toContain("y".repeat(6001));
});

test("sameRepo matches ssh and https remotes, nothing else", () => {
  expect(sameRepo("git@github.com:A/One.git\n", "a/one")).toBe(true);
  expect(sameRepo("https://gitlab.example.com/g/sub/r.git", "g/sub/r")).toBe(true);
  expect(sameRepo("https://gitlab.example.com/g/sub/r/", "g/sub/r")).toBe(true);
  expect(sameRepo("ssh://git@github.com/a/one", "a/one")).toBe(true);
  expect(sameRepo("git@github.com:a/one-two.git", "a/one")).toBe(false);
});

// The board's replies, plus the issue's body.
const withBody = (base: (command: string, args: string[]) => Reply) => (command: string, args: string[]): Reply => {
  if (args[0] === "issue" && args[1] === "view" && args.includes("--json")) return { code: 0, stdout: JSON.stringify({ body: "Steps: …" }) };
  if (args[0] === "api" && /\/issues\/\d+$/.test(args[1])) return { code: 0, stdout: JSON.stringify({ description: "From GitLab." }) };
  return base(command, args);
};

test("Start work in This repo opens the worktree dialog with branch and task", async () => {
  const replies = withBody((command, args) => {
    if (args[0] === "issue" && args[1] === "list") return { code: 0, stdout: JSON.stringify([ghIssue(12, "o/r", { title: "Crash on empty config!", assignees: [{ login: "me" }] })]) };
    return github(command, args);
  });
  const h = harness(board, "PrBoard", replies);
  h.store.set("prboard.kind", "issues");
  h.store.set("prboard.scope.gh", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  // Nothing is fetched or opened on load.
  expect(h.overlays).toEqual([]);
  expect(h.calls.some((c) => c.args.includes("body"))).toBe(false);
  findId(h.view.render(h.cx).node, "issue-start-o/r-12").click({}, h.cx);
  await h.settle();
  expect(h.calls.find((c) => c.args.includes("body")).args).toEqual(["issue", "view", "12", "--repo", "o/r", "--json", "body"]);
  expect(h.overlays.length).toBe(1);
  const o = h.overlays[0];
  expect([o.mod, o.kind, o.width, o.height]).toEqual(["worktree", "dialog", 440, 300]);
  expect(o.props).toEqual({ folder: "/repo", machine: null, action: "new", branch: "12-crash-on-empty-config", task: issueTask(crash, "Steps: …") });
});

test("Enter on the selected issue starts work too", async () => {
  const h = harness(board, "PrBoard", withBody(github));
  h.store.set("prboard.kind", "issues");
  h.store.set("prboard.scope.gh", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  h.view.render(h.cx).node.key({ key: "enter" }, h.cx);
  await h.settle();
  expect(h.overlays.length).toBe(1);
  expect(h.overlays[0].props.branch).toBe("5-issue-5");
});

test("Start work in All repos finds the space cloned from that repo", async () => {
  const origins: Record<string, string> = { "/x": "git@github.com:other/x.git\n", "/y": "git@github.com:a/one.git\n" };
  const spaces = () => [
    { id: "s0", active: false, folder: "/far", machine: "box" },
    { id: "s1", active: true, folder: "/x", machine: null },
    { id: "s1b", active: false, folder: "/x", machine: null },
    { id: "s2", active: false, folder: "/y", machine: null },
    { id: "s3", active: false, folder: "/z", machine: null },
  ];
  // The harness's replies don't see the cwd: the call, just recorded, has it.
  let calls: any[] = [];
  const replies = withBody((command, args) => {
    if (command === "git" && args[0] === "remote" && calls.at(-1).cwd !== "/repo") return { code: 0, stdout: origins[calls.at(-1).cwd] ?? "" };
    return github(command, args);
  });
  const h = harness(board, "PrBoard", replies, {}, "/repo", { spaces });
  calls = h.calls;
  h.store.set("prboard.kind", "issues");
  h.view.init({}, h.cx);
  await h.settle();
  const before = h.calls.length;
  h.view.startWork(h.view.cols.all.find((r: any) => r.repo === "a/one"), h.cx);
  await h.settle();
  const remotes = h.calls.slice(before).filter((c) => c.command === "git");
  expect(remotes.map((c) => c.cwd)).toEqual(["/x", "/y"]);
  expect(remotes.every((c) => c.args.join(" ") === "remote get-url origin")).toBe(true);
  expect(h.overlays.length).toBe(1);
  expect(h.overlays[0].props).toMatchObject({ folder: "/y", machine: null, action: "new", branch: "1-issue-1" });
});

test("Start work with no checkout says so and opens nothing", async () => {
  const h = harness(board, "PrBoard", withBody(github), {}, "/repo", { spaces: () => [{ id: "s1", active: true, folder: "/x", machine: null }] });
  h.store.set("prboard.kind", "issues");
  h.view.init({}, h.cx);
  await h.settle();
  findId(h.view.render(h.cx).node, "issue-start-a/one-1").click({}, h.cx);
  await h.settle();
  expect(h.overlays).toEqual([]);
  expect(h.notes[0]).toEqual({ title: "No checkout of a/one", body: "Open a space in a clone of it, then Start work again.", level: "warning" });
});

test("Start work on GitLab reads the description from the issues API", async () => {
  const h = harness(board, "PrBoard", withBody(gitlab));
  h.store.set("prboard.kind", "issues");
  h.store.set("prboard.forge", "glab");
  h.store.set("prboard.scope.glab", "repo");
  h.store.set("prboard.column", "all");
  h.view.init({}, h.cx);
  await h.settle();
  findId(h.view.render(h.cx).node, "issue-start-g/r-3").click({}, h.cx);
  await h.settle();
  const asked = h.calls.find((c) => c.command === "glab" && /\/issues\/3$/.test(c.args[1] ?? ""));
  expect(asked.args).toEqual(["api", "projects/43/issues/3", "--hostname", "gitlab.example.com"]);
  expect(h.overlays[0].props.task).toContain("Work on GitLab issue #3 in g/r: Issue 3\nhttps://gitlab.example.com/g/r/-/issues/3\n\nFrom GitLab.\n\n");
});
