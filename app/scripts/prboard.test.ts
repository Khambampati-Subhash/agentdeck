import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// A mod's main.js with its own ./modules inlined, imports and exports dropped.
async function load(name: string, cls: string) {
  const read = (file: string) => readFile(new URL(`../defaults/mods/${name}/${file}`, import.meta.url), "utf8");
  let source = await read("main.js");
  for (const [line, file] of [...source.matchAll(/^import .* from "\.\/(.+)";\n/gm)]) {
    source = source.replace(line, (await read(file)).replace(/^import .*;\n/gm, "").replace(/^export /gm, ""));
  }
  return source.replace(/^import .*;\n/gm, "").replace(`export default class ${cls}`, `class ${cls}`);
}
const board = await load("prboard", "PrBoard");
const diff = await load("prdiff", "PrDiff");

// Execute conditional builders and retain text, without native GPUI layout.
function element(kind = "div") {
  const node = { kind, id: "", children: [] as any[], click: null as any };
  const el: any = new Proxy(node, { get: (_, method) => {
    if (method === "node") return node;
    return (...args: any[]) => {
      if (method === "id") node.id = args[0];
      if (method === "on_click") node.click = args[0];
      if (method === "child") node.children.push(args[0]?.node ?? args[0]);
      if (method === "children") node.children.push(...args[0].map((child: any) => child?.node ?? child));
      if (method === "when" && args[0]) args[1](el);
      return el;
    };
  } });
  return el;
}
const textOf = (node: any): string => typeof node === "string" ? node : (node?.children ?? []).map(textOf).join(" ");
const findId = (node: any, id: string): any => node?.id === id ? node : (node?.children ?? []).map((c: any) => findId(c, id)).find(Boolean);

type Reply = { code: number; stdout: string; stderr?: string };
function harness(source: string, cls: string, replies: (command: string, args: string[]) => Reply, props: any = {}, folder = "/repo") {
  const calls: any[] = [], overlays: any[] = [], store = new Map<string, string>();
  const tasks: Promise<unknown>[] = [];
  const cx: any = {
    focus_handle: () => ({ focus() {} }), timer: { every() {}, after() {} }, notify() {}, stop_propagation() {},
    spawn: (f: (cx: any) => Promise<unknown>) => { tasks.push(f(cx)); },
  };
  const globals: any = {
    View: class {}, div: () => element(), v_flex: () => element("v"), h_flex: () => element("h"),
    Input: { new: () => element() }, InputState: { new: () => ({ on() {}, value: () => "LGTM", set_value() {} }) },
    Scrollbar: { vertical: () => element() }, v_virtual_list: () => element(),
    theme: () => ({}), settings: () => ({}), props: () => props, notify() {}, closeOverlay() {},
    spaces: () => [{ id: "s1", active: true, folder, machine: null }], panes: () => [], focused: () => ({ pane: null, cwd: null }),
    openOverlay: (o: any) => overlays.push(o), watchFolder: async () => { throw new Error("not watched in tests"); },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    exec: async (command: string, args: string[], options: any) => { calls.push({ command, args, ...options }); return { stderr: "", ...replies(command, args) }; },
  };
  const View = new Function(...Object.keys(globals), `${source}; return ${cls};`)(...Object.values(globals));
  const view = new View();
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { view, cx, calls, overlays, store, settle };
}

// ---------------------------------------------------------------- fixtures

const ghRepoList = JSON.stringify([
  { number: 7, title: "Fix it", author: { login: "me" }, headRefName: "fix", baseRefName: "main", additions: 3, deletions: 1, changedFiles: 2, isDraft: false, reviewDecision: "REVIEW_REQUIRED", reviewRequests: [{ login: "Me" }], assignees: [], updatedAt: "2026-11-12T00:00:00Z", url: "https://github.com/o/r/pull/7" },
  { number: 8, title: "Other", author: { login: "you" }, headRefName: "x", baseRefName: "main", isDraft: true, reviewRequests: [{ slug: "team" }], assignees: [{ login: "me" }], url: "https://github.com/o/r/pull/8" },
]);
const hit = (n: number, repo: string, extra: any = {}) => ({ number: n, title: `PR ${n}`, repository: { nameWithOwner: repo }, url: `https://github.com/${repo}/pull/${n}`, isDraft: false, author: { login: "x" }, assignees: [], updatedAt: "2026-11-12T00:00:00Z", ...extra });
const ghSearch: Record<string, any[]> = {
  "--review-requested": [hit(1, "a/one"), hit(2, "b/two")],
  "--assignee": [hit(2, "b/two")],
  "--author": [hit(3, "c/three", { author: { login: "me" }, isDraft: true })],
};
const glMr = (iid: number, path: string, extra: any = {}) => ({ iid, project_id: 40 + iid, title: `MR ${iid}`, author: { username: "x" }, source_branch: "a", target_branch: "main", draft: false, detailed_merge_status: "not_approved", reviewers: [], assignees: [], web_url: `https://gitlab.example.com/${path}/-/merge_requests/${iid}`, references: { full: `${path}!${iid}` }, updated_at: "2026-11-12T00:00:00Z", ...extra });

function github(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
  if (args[0] === "api") return { code: 0, stdout: JSON.stringify({ login: "me", username: "me" }) };
  if (args[0] === "search") return { code: 0, stdout: JSON.stringify(ghSearch[args.find((a) => a in ghSearch)!]) };
  return { code: 0, stdout: ghRepoList };
}
function gitlab(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@gitlab.example.com:g/r.git\n" };
  if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: JSON.stringify({ username: "me" }) };
  if (args[0] === "api" && args[1].includes("reviewer_username=me")) return { code: 0, stdout: JSON.stringify([glMr(4, "g/r", { reviewers: [{ username: "ME" }], draft: true })]) };
  if (args[0] === "api" && args[1].includes("assigned_to_me")) return { code: 0, stdout: "[]" };
  if (args[0] === "api" && args[1].includes("created_by_me")) return { code: 0, stdout: JSON.stringify([glMr(3, "g/other", { author: { username: "me" } })]) };
  return { code: 0, stdout: JSON.stringify([glMr(3, "g/r", { author: { username: "me" } }), glMr(4, "g/r", { reviewers: [{ username: "ME" }], draft: true })]) };
}
const nums = (rows: any[]) => rows.map((p) => p.num);

// ---------------------------------------------------------------- the board

test("the board opens on GitHub, every repo, and loads at once", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  const searches = h.calls.filter((c) => c.command === "gh" && c.args[0] === "search").map((c) => c.args.slice(-2));
  expect(searches).toEqual([["--review-requested", "@me"], ["--assignee", "@me"], ["--author", "@me"]]);
  expect(h.view.loading).toBe(false);
  expect(nums(h.view.cols.review)).toEqual([1, 2]);
  expect(nums(h.view.cols.assigned)).toEqual([2]);
  expect(nums(h.view.cols.created)).toEqual([3]);
  expect(nums(h.view.cols.all)).toEqual([1, 2, 3]);
  expect(h.view.cols.all[1].repo).toBe("b/two");
  expect(textOf(h.view.render(h.cx).node)).toContain("a/one");
});

test("This repo lists the folder's pull requests", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.scope.gh", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  const list = h.calls.find((c) => c.command === "gh" && c.args[0] === "pr");
  expect(list.args.slice(0, 4)).toEqual(["pr", "list", "--state", "open"]);
  expect(list.cwd).toBe("/repo");
  expect(nums(h.view.cols.all)).toEqual([7, 8]);
  expect(nums(h.view.cols.review)).toEqual([7]);
  expect(nums(h.view.cols.assigned)).toEqual([8]);
  expect(nums(h.view.cols.created)).toEqual([7]);
  expect(h.view.cols.all[0].repo).toBe("o/r");
});

test("This repo on the other forge's tab points to the right tab", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.store.set("prboard.scope.gh", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.calls.some((c) => c.command === "gh")).toBe(false);
  expect(h.view.error).toContain("GitLab");
});

test("GitLab, every repo, asks GitLab's merge request API by scope", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.store.set("prboard.forge", "glab");
  h.view.init({}, h.cx);
  await h.settle();
  const asked = h.calls.filter((c) => c.command === "glab" && c.args[1] !== "user").map((c) => c.args[1]);
  expect(asked.every((a) => a.startsWith("merge_requests?state=opened"))).toBe(true);
  expect(asked.some((a) => a.includes("reviewer_username=me"))).toBe(true);
  expect(h.view.error).toBe(null);
  expect(nums(h.view.cols.review)).toEqual([4]);
  expect(nums(h.view.cols.created)).toEqual([3]);
  const mr = h.view.cols.all.find((p: any) => p.num === 3);
  expect([mr.repo, mr.pid, mr.forge]).toEqual(["g/other", 43, "glab"]);
});

test("GitLab, this repo, lists with glab's own flags", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.store.set("prboard.forge", "glab");
  h.store.set("prboard.scope.glab", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  const list = h.calls.find((c) => c.command === "glab" && c.args[0] === "mr");
  expect(list.args).not.toContain("--state");
  expect(list.args).toContain("--output");
  expect(nums(h.view.cols.review)).toEqual([4]);
  expect(h.view.cols.all.find((p: any) => p.num === 4).draft).toBe(true);
});

test("switching forge or scope is remembered and keeps what was loaded", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  h.view.setForge("glab", h.cx);
  await h.settle();
  expect(h.store.get("prboard.forge")).toBe("glab");
  h.view.setScope("repo", h.cx);
  await h.settle();
  expect(h.store.get("prboard.scope.glab")).toBe("repo");
  h.view.setForge("gh", h.cx);
  expect(nums(h.view.cols.all)).toEqual([1, 2, 3]);
  await h.settle();
});

test("the signed-in user is remembered per forge", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.me.glab", "someone-else");
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.store.get("prboard.me.gh")).toBe("me");
});

test("signed out says how to sign in", async () => {
  const h = harness(board, "PrBoard", (c, a) => c === "glab" ? { code: 1, stdout: "", stderr: "GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}" } : gitlab(c, a));
  h.store.set("prboard.forge", "glab");
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.error).toContain("glab auth login");
});

test("a missing CLI is explained, not thrown", async () => {
  const h = harness(board, "PrBoard", () => { throw new Error("cannot start gh"); });
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.error).toContain("gh");
  expect(h.view.loading).toBe(false);
});

test("every exec argument is a string", async () => {
  for (const [forge, scope, replies] of [["gh", "all", github], ["gh", "repo", github], ["glab", "all", gitlab], ["glab", "repo", gitlab]] as const) {
    const h = harness(board, "PrBoard", replies);
    h.store.set("prboard.forge", forge);
    h.store.set(`prboard.scope.${forge}`, scope);
    h.view.init({}, h.cx);
    await h.settle();
    for (const c of h.calls) for (const a of c.args) expect(typeof a).toBe("string");
  }
});

test("a card opens its window with the forge and repo it came from", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.store.set("prboard.forge", "glab");
  h.store.set("prboard.column", "all");
  h.view.init({}, h.cx);
  await h.settle();
  const tree = h.view.render(h.cx).node;
  const card = findId(tree, "pr-g/other-3");
  expect(card.kind).toBe("v");
  card.click({}, h.cx);
  const p = h.overlays[0].props;
  expect(h.overlays[0].mod).toBe("prdiff");
  expect([p.forge, p.repo, p.pid, p.pr.num, p.pr.url]).toEqual(["glab", "g/other", 43, 3, "https://gitlab.example.com/g/other/-/merge_requests/3"]);
});

// ---------------------------------------------------------------- the window

const DIFF = [
  "diff --git a/src/a.rs b/src/a.rs", "index 1..2 100644", "--- a/src/a.rs", "+++ b/src/a.rs",
  "@@ -1,2 +1,2 @@", " keep", "-old", "+new", "+more",
  "diff --git a/gone.txt b/gone.txt", "deleted file mode 100644", "--- a/gone.txt", "+++ /dev/null",
  "@@ -1 +0,0 @@", "-bye", "",
].join("\n");

const ghView = JSON.stringify({
  title: "Fix it", headRefName: "fix", baseRefName: "main", reviewDecision: "CHANGES_REQUESTED", isDraft: false,
  author: { login: "can" }, assignees: [{ login: "sub" }], reviewRequests: [{ login: "jon" }, { slug: "core-team", name: "Core" }],
  latestReviews: [{ author: { login: "mira" }, state: "APPROVED" }],
  reviews: [{ author: { login: "mira" }, state: "APPROVED", body: "Looks good", submittedAt: "2026-11-12T02:00:00Z" }, { author: { login: "x" }, state: "COMMENTED", body: "", submittedAt: "2026-11-12T03:00:00Z" }],
  comments: [{ author: { login: "jon" }, body: "First", createdAt: "2026-11-12T01:00:00Z" }],
  commits: [{ oid: "a1f3c9e0000", messageHeadline: "core: shorter path", authors: [{ login: "can", name: "Can" }], committedDate: "2026-11-12T00:00:00Z" }],
});
function ghPr(command: string, args: string[]): Reply {
  if (args[1] === "diff") return { code: 0, stdout: DIFF };
  if (args[1] === "view") return { code: 0, stdout: ghView };
  return { code: 0, stdout: "" };
}
const ghProps = { pr: { num: 7, title: "Fix it" }, forge: "gh", repo: "o/r", cwd: "/repo", overlay: "o1" };

test("the window splits the diff into files and shows the first", async () => {
  const h = harness(diff, "PrDiff", ghPr, ghProps);
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.files.map((f: any) => [f.path, f.add, f.del])).toEqual([["src/a.rs", 2, 1], ["gone.txt", 0, 1]]);
  expect(h.view.file).toBe(0);
  expect(h.view.files[0].rows.map((r: any) => r.kind)).toEqual(["@", " ", "-", "+", "+"]);
  h.view.pick(1, h.cx);
  expect(h.view.files[h.view.file].rows.map((r: any) => r.text)).toEqual(["@@ -1 +0,0 @@", "bye"]);
});

test("GitHub details: people, commits, and comments with reviews in order", async () => {
  const h = harness(diff, "PrDiff", ghPr, ghProps);
  h.view.init({}, h.cx);
  await h.settle();
  const view = h.calls.find((c) => c.args[1] === "view");
  expect(view.args.slice(0, 5)).toEqual(["pr", "view", "7", "--repo", "o/r"]);
  expect(h.calls.find((c) => c.args[1] === "diff").args).toEqual(["pr", "diff", "7", "--repo", "o/r", "--color", "never"]);
  expect(h.view.people.author).toBe("can");
  expect(h.view.people.assignees).toEqual(["sub"]);
  expect(h.view.people.reviewers).toEqual([{ login: "mira", state: "APPROVED" }, { login: "jon", state: "PENDING" }, { login: "Core", state: "PENDING" }]);
  expect(h.view.commits).toEqual([{ sha: "a1f3c9e", title: "core: shorter path", author: "can", at: "2026-11-12T00:00:00Z" }]);
  expect(h.view.comments.map((c: any) => [c.author, c.body, c.state])).toEqual([["jon", "First", null], ["mira", "Looks good", "APPROVED"]]);
  expect(h.view.pr.decision).toBe("CHANGES_REQUESTED");
  expect(h.view.pr.branch).toBe("fix");
});

test("GitLab details come from the project's API by id", async () => {
  const replies = (command: string, args: string[]): Reply => {
    if (args[1] === "diff") return { code: 0, stdout: DIFF };
    const path = args[1] ?? "";
    if (path.endsWith("/approvals")) return { code: 0, stdout: JSON.stringify({ approved_by: [{ user: { username: "mira" } }] }) };
    if (path.includes("/commits")) return { code: 0, stdout: JSON.stringify([{ short_id: "77be012", title: "test it", author_name: "Can", created_at: "2026-11-12T00:00:00Z" }]) };
    if (path.includes("/notes")) return { code: 0, stdout: JSON.stringify([{ author: { username: "jon" }, body: "Why?", created_at: "2026-11-12T01:00:00Z", system: false }, { author: { username: "bot" }, body: "added 1 commit", system: true }]) };
    return { code: 0, stdout: JSON.stringify({ title: "MR", source_branch: "a", target_branch: "main", draft: false, detailed_merge_status: "mergeable", author: { username: "can" }, assignees: [{ username: "sub" }], reviewers: [{ username: "mira" }, { username: "jon" }] }) };
  };
  const h = harness(diff, "PrDiff", replies, { pr: { num: 3, url: "https://gitlab.example.com/g/r/-/merge_requests/3" }, forge: "glab", repo: "g/r", pid: 43, overlay: "o1" });
  h.view.init({}, h.cx);
  await h.settle();
  const asked = h.calls.filter((c) => c.args[0] === "api").map((c) => c.args[1].split("?")[0]);
  expect(asked.sort()).toEqual(["projects/43/merge_requests/3", "projects/43/merge_requests/3/approvals", "projects/43/merge_requests/3/commits", "projects/43/merge_requests/3/notes"]);
  expect(h.calls.find((c) => c.args[1] === "diff").args).toEqual(["mr", "diff", "3", "-R", "https://gitlab.example.com/g/r", "--color", "never"]);
  expect(h.view.people.reviewers).toEqual([{ login: "mira", state: "APPROVED" }, { login: "jon", state: "PENDING" }]);
  expect(h.view.commits[0].sha).toBe("77be012");
  expect(h.view.comments.map((c: any) => c.body)).toEqual(["Why?"]);
  expect(h.view.pr.decision).toBe("mergeable");
});

test("a failing section doesn't hide the others", async () => {
  const h = harness(diff, "PrDiff", (c, a) => a[1] === "view" ? { code: 1, stdout: "", stderr: "boom" } : ghPr(c, a), ghProps);
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.files.length).toBe(2);
  expect(h.view.error).toContain("boom");
});

test("posting a comment names the repo and reloads the conversation", async () => {
  const h = harness(diff, "PrDiff", ghPr, ghProps);
  h.view.init({}, h.cx);
  await h.settle();
  h.calls.length = 0;
  h.view.postComment(h.cx);
  await h.settle();
  expect(h.calls[0].args).toEqual(["pr", "comment", "7", "--repo", "o/r", "--body", "LGTM"]);
  expect(h.calls.some((c) => c.args[1] === "view")).toBe(true);
});

test("the window without a pull request asks no CLI", async () => {
  const h = harness(diff, "PrDiff", () => ({ code: 0, stdout: "" }), { overlay: "o1" });
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.calls).toEqual([]);
  expect(h.view.error).toContain("Pull requests panel");
});

test("an empty diff has no files", async () => {
  const h = harness(diff, "PrDiff", (c, a) => a[1] === "diff" ? { code: 0, stdout: "" } : ghPr(c, a), ghProps);
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.files).toEqual([]);
  expect(textOf(h.view.render(h.cx).node)).toContain("No changes");
});
