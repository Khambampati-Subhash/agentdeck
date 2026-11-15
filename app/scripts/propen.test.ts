// Opening a pull or merge request from a worktree's branch (propen), and the
// two ways to it: the space menu and the board's ＋.

import { test, expect } from "bun:test";
import { load, harness, fns, textOf, findId, element, type Reply } from "./mod-harness.ts";

const source = await load("propen", "ProOpen");
const menu = await load("menu", "Menu");
const board = await load("prboard", "PrBoard");

const ok = (stdout: string): Reply => ({ code: 0, stdout });
const ONE = "a1\x1fFix crash\x1fBecause.\n\x1e\n";
const TWO = "a1\x1fFirst\x1f\x1e\nb2\x1fSecond\x1fWhy\nand how.\n\x1e\n";

// A checkout of o/r on branch fix, base main.
function repo(o: { head?: string; origin?: string; status?: string; log?: string; list?: string; push?: Reply; create?: Reply } = {}) {
  return (command: string, args: string[]): Reply => {
    const a = args.join(" ");
    if (command === "git") {
      if (a === "rev-parse --show-toplevel") return ok("/wt/fix\n");
      if (a === "rev-parse --abbrev-ref HEAD") return ok(`${o.head ?? "fix"}\n`);
      if (a === "remote get-url origin") return ok(o.origin ?? "git@github.com:o/r.git\n");
      if (args[0] === "symbolic-ref") return ok("origin/main\n");
      if (args[0] === "log") return ok(o.log ?? ONE);
      if (args[0] === "status") return ok(o.status ?? "");
      if (args[0] === "push") return o.push ?? ok("");
    }
    if (args[1] === "list") return ok(o.list ?? "[]");
    if (args[1] === "create") return o.create ?? ok("Creating pull request\nhttps://github.com/o/r/pull/9\n");
    return { code: 1, stdout: "", stderr: `unexpected ${command} ${a}` };
  };
}

async function open(replies: (c: string, a: string[]) => Reply, machine: string | null = null) {
  const h = harness(source, "ProOpen", replies, { folder: "/wt/fix", machine, overlay: "o1" });
  h.view.init({}, h.cx);
  await h.settle();
  return h;
}
const outward = (h: any) => h.calls.filter((c: any) => c.args[0] === "push" || c.args[1] === "create");

// ---------------------------------------------------------------- the draft

test("draft: one commit is its own title and body", () => {
  const { draft } = fns(source, ["draft"]);
  expect(draft("12-x", [{ subject: "Fix crash", body: "Because.\n" }])).toEqual({ title: "Fix crash", body: "Because." });
});

test("draft: many commits list their subjects under the branch's name", () => {
  const { draft } = fns(source, ["draft"]);
  expect(draft("12-crash-on-empty", [{ subject: "a" }, { subject: "b" }])).toEqual({ title: "Crash on empty", body: "- a\n- b" });
  expect(draft("feat/new_thing", [{ subject: "a" }, { subject: "b" }]).title).toBe("Feat new thing");
});

test("readBranch reads the branch, base, repo and commits oldest first", async () => {
  const h = await open(repo({ log: TWO, origin: "https://gitlab.example.com/g/sub/r.git\n" }));
  expect(h.view.info).toMatchObject({ root: "/wt/fix", branch: "fix", base: "main", forge: "glab", repo: "g/sub/r", dirty: 0 });
  expect(h.view.info.commits).toEqual([{ sha: "a1", subject: "First", body: "" }, { sha: "b2", subject: "Second", body: "Why\nand how.\n" }]);
  const log = h.calls.find((c: any) => c.args[0] === "log");
  expect(log.args).toEqual(["log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", "origin/main..HEAD"]);
  expect(h.view.title.value()).toBe("Fix");
  expect(h.view.body.value()).toBe("- First\n- Second");
  expect(h.view.base.value()).toBe("main");
  expect(outward(h)).toEqual([]); // nothing goes out on load
});

test("the base falls back to main, then master, when origin/HEAD isn't set", async () => {
  for (const [main, base] of [[0, "main"], [1, "master"]] as const) {
    const inner = repo();
    const h = await open((c, a) => (a[0] === "symbolic-ref" ? { code: 1, stdout: "" } : a[0] === "show-ref" ? { code: main, stdout: "" } : inner(c, a)));
    expect(h.view.info.base).toBe(base);
    expect(h.calls.find((c: any) => c.args[0] === "show-ref").args).toEqual(["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"]);
  }
});

// ---------------------------------------------------------------- the dialog

test("the dialog warns about uncommitted changes and refuses an empty branch", async () => {
  const dirty = await open(repo({ status: " M a.rs\n?? b.rs\n" }));
  expect(dirty.view.info.dirty).toBe(2);
  expect(textOf(dirty.view.render(dirty.cx).node)).toContain("2 uncommitted changes won't be in it.");
  expect(findId(dirty.view.render(dirty.cx).node, "propen-create").click).toBeTruthy();

  const one = await open(repo({ status: " M a.rs\n" }));
  expect(textOf(one.view.render(one.cx).node)).toContain("1 uncommitted change won't be in it.");

  const empty = await open(repo({ log: "" }));
  const root = empty.view.render(empty.cx).node;
  expect(textOf(root)).toContain("Nothing to open: no commits ahead of origin/main.");
  expect(findId(root, "propen-create").click).toBeNull();
  empty.view.title.fire("submit", empty.cx);
  await empty.settle();
  expect(outward(empty)).toEqual([]);
});

test("an existing PR for the branch is offered instead of a second one", async () => {
  const h = await open(repo({ list: JSON.stringify([{ number: 7, url: "https://github.com/o/r/pull/7", title: "Fix it" }]) }));
  const list = h.calls.find((c: any) => c.args[1] === "list");
  expect(list).toMatchObject({ command: "gh", cwd: "/wt/fix", args: ["pr", "list", "--head", "fix", "--state", "open", "--json", "number,url,title"] });
  const root = h.view.render(h.cx).node;
  expect(textOf(root)).toContain("Already open: #7 Fix it");
  expect(findId(root, "propen-create")).toBeFalsy();
  findId(root, "propen-open").click({}, h.cx);
  expect(h.notes).toEqual([{ title: "Opened https://github.com/o/r/pull/7", level: "success" }]);
  expect(h.overlays[0]).toMatchObject({ mod: "prdiff", kind: "window", props: { pr: { num: 7, url: "https://github.com/o/r/pull/7", title: "Fix it", branch: "fix" }, forge: "gh", repo: "o/r", cwd: "/wt/fix" } });
  expect(outward(h)).toEqual([]);
});

test("an existing GitLab MR shows as !N", async () => {
  const h = await open(repo({ origin: "git@gitlab.com:g/r.git\n", list: JSON.stringify([{ iid: 4, web_url: "https://gitlab.com/g/r/-/merge_requests/4", title: "Fix it" }]) }));
  expect(h.calls.find((c: any) => c.args[1] === "list").args).toEqual(["mr", "list", "--source-branch=fix", "--output", "json"]);
  expect(textOf(h.view.render(h.cx).node)).toContain("Already open: !4 Fix it");
});

test("detached HEAD is explained", async () => {
  const h = await open(repo({ head: "HEAD" }));
  expect(h.view.info).toBeNull();
  expect(textOf(h.view.render(h.cx).node)).toContain("Detached HEAD: check out a branch first.");
  expect(h.calls.some((c: any) => c.command === "gh")).toBe(false);
});

// ---------------------------------------------------------------- creating

test("create pushes, then creates with --flag=value args, then opens the PR window", async () => {
  const h = await open(repo(), "vps");
  h.view.title.set_value("--force $(x)");
  h.view.body.set_value("-b 'quoted'\nline two");
  const root = h.view.render(h.cx).node;
  expect(textOf(root)).toContain("Create draft pull request");
  findId(root, "propen-create").click({}, h.cx);
  await h.settle();
  expect(outward(h).map((c: any) => [c.command, ...c.args])).toEqual([
    ["git", "push", "-u", "origin", "fix"],
    ["gh", "pr", "create", "--title=--force $(x)", "--body=-b 'quoted'\nline two", "--base=main", "--head=fix", "--draft"],
  ]);
  expect(outward(h)[0]).toMatchObject({ cwd: "/wt/fix", on: "vps", timeout: 120000 });
  expect(outward(h)[1]).toMatchObject({ cwd: "/wt/fix", on: "vps" });
  expect(h.notes).toEqual([{ title: "Opened https://github.com/o/r/pull/9", level: "success" }]);
  expect(h.overlays).toHaveLength(1);
  expect(h.overlays[0]).toMatchObject({ mod: "prdiff", props: { pr: { num: 9, url: "https://github.com/o/r/pull/9", title: "--force $(x)", branch: "fix" }, forge: "gh", repo: "o/r", cwd: "/wt/fix", on: "vps" } });
});

test("Enter in the title creates; Draft off drops --draft", async () => {
  const h = await open(repo());
  findId(h.view.render(h.cx).node, "propen-draft").click({}, h.cx);
  expect(textOf(h.view.render(h.cx).node)).toContain("Create pull request");
  h.view.title.fire("submit", h.cx);
  await h.settle();
  expect(outward(h)[1].args).toEqual(["pr", "create", "--title=Fix crash", "--body=Because.", "--base=main", "--head=fix"]);
});

test("GitLab uses glab mr create with its own flags", async () => {
  const h = await open(repo({ origin: "git@gitlab.com:g/r.git\n", create: ok("https://gitlab.com/g/r/-/merge_requests/5\n") }));
  const root = h.view.render(h.cx).node;
  expect(textOf(root)).toContain("Create draft merge request");
  findId(root, "propen-create").click({}, h.cx);
  await h.settle();
  expect(outward(h)[1]).toMatchObject({ command: "glab", args: ["mr", "create", "--title=Fix crash", "--description=Because.", "--target-branch=main", "--source-branch=fix", "--yes", "--draft"] });
  expect(h.overlays[0]).toMatchObject({ mod: "prdiff", props: { pr: { num: 5 }, forge: "glab", repo: "g/r" } });
});

test("a failed push stops before creating", async () => {
  const h = await open(repo({ push: { code: 1, stdout: "", stderr: "! [rejected] fix -> fix (non-fast-forward)\n" } }));
  findId(h.view.render(h.cx).node, "propen-create").click({}, h.cx);
  await h.settle();
  expect(outward(h).map((c: any) => c.args[0])).toEqual(["push"]);
  expect(textOf(h.view.render(h.cx).node)).toContain("! [rejected] fix -> fix (non-fast-forward)");
  expect(h.overlays).toEqual([]);
});

test("a failed create shows the CLI's message", async () => {
  const h = await open(repo({ create: { code: 1, stdout: "", stderr: "a pull request for branch \"fix\" already exists" } }));
  findId(h.view.render(h.cx).node, "propen-create").click({}, h.cx);
  await h.settle();
  expect(textOf(h.view.render(h.cx).node)).toContain('a pull request for branch "fix" already exists');
  expect(h.overlays).toEqual([]);
});

// ---------------------------------------------------------------- the ways in

test("the space menu offers Open pull request on git spaces", async () => {
  const spaces = () => [{ id: "s1", folder: "/made/here", machine: "vps", tabs: [{ id: "t1" }] }];
  const panes = () => [{ tab: "t1", cwd: "/wt/fix" }];
  const replies = (_c: string, a: string[]): Reply => ok(a.includes("--show-toplevel") ? "/wt/fix\n" : "/repo/.git/worktrees/fix\n");
  const h = harness(menu, "Menu", replies, { tab: "space", target: { id: "s1" } }, "/repo", { spaces, panes, svg: () => element(), keys: () => [], terminals: () => [] });
  h.view.init({}, h.cx);
  await h.settle();
  const root = h.view.render(h.cx).node;
  const labels = textOf(root);
  expect(labels).toContain("Open pull request");
  const i = [...Array(10).keys()].find((n) => textOf(findId(root, `mi-${n}`)).includes("Open pull request"));
  findId(root, `mi-${i}`).click({}, h.cx);
  expect(h.overlays).toEqual([{ mod: "propen", kind: "dialog", width: 560, height: 460, props: { folder: "/wt/fix", machine: "vps" } }]);
});

test("the space menu has no Open pull request outside git", async () => {
  const h = harness(menu, "Menu", () => ({ code: 128, stdout: "" }), { tab: "space", target: { id: "s1" } }, "/tmp", { svg: () => element(), keys: () => [], terminals: () => [] });
  h.view.init({}, h.cx);
  await h.settle();
  expect(textOf(h.view.render(h.cx).node)).not.toContain("Open pull request");
});

function github(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return ok("/repo\n");
  if (command === "git") return ok("git@github.com:o/r.git\n");
  if (args[0] === "api") return ok(JSON.stringify({ login: "me" }));
  return ok("[]");
}

test("the board's ＋ opens the dialog on This repo's checkout", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.scope.gh", "repo");
  h.view.init({}, h.cx);
  await h.settle();
  findId(h.view.render(h.cx).node, "prboard-new").click({}, h.cx);
  expect(h.overlays).toEqual([{ mod: "propen", kind: "dialog", width: 560, height: 460, props: { folder: "/repo", machine: null } }]);
});

test("the board has no ＋ over All repos", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  expect(findId(h.view.render(h.cx).node, "prboard-new")).toBeFalsy();
});
