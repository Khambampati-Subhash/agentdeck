import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

const load = async (name: string, cls: string) => (await readFile(new URL(`../defaults/mods/${name}/main.js`, import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace(`export default class ${cls}`, `class ${cls}`);
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
function harness(source: string, cls: string, replies: (command: string, args: string[]) => Reply, props: any = {}) {
  const calls: any[] = [], overlays: any[] = [], store = new Map<string, string>();
  const tasks: Promise<unknown>[] = [];
  const cx: any = {
    focus_handle: () => ({ focus() {} }), timer: { every() {}, after() {} }, notify() {}, stop_propagation() {},
    spawn: (f: (cx: any) => Promise<unknown>) => { tasks.push(f(cx)); },
  };
  const globals: any = {
    View: class {}, div: () => element(), v_flex: () => element("v"), h_flex: () => element("h"),
    Input: { new: () => element() }, InputState: { new: () => ({ on() {}, value: () => "", set_value() {} }) },
    Scrollbar: { vertical: () => element() }, v_virtual_list: () => element(),
    theme: () => ({}), settings: () => ({}), props: () => props, notify() {}, closeOverlay() {},
    spaces: () => [{ id: "s1", active: true, folder: "/repo", machine: null }], panes: () => [], focused: () => ({ pane: null, cwd: null }),
    openOverlay: (o: any) => overlays.push(o), watchFolder: async () => { throw new Error("not watched in tests"); },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    exec: async (command: string, args: string[], options: any) => { calls.push({ command, args, ...options }); return { stderr: "", ...replies(command, args) }; },
  };
  const View = new Function(...Object.keys(globals), `${source}; return ${cls};`)(...Object.values(globals));
  const view = new View();
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { view, cx, calls, overlays, store, settle };
}

const GH_PRS = JSON.stringify([
  { number: 7, title: "Fix it", author: { login: "me" }, headRefName: "fix", baseRefName: "main", additions: 3, deletions: 1, changedFiles: 2, isDraft: false, reviewDecision: "REVIEW_REQUIRED", reviewRequests: [{ login: "Me" }], assignees: [], updatedAt: "2026-11-12T00:00:00Z", url: "https://github.com/o/r/pull/7" },
  { number: 8, title: "Other", author: { login: "you" }, headRefName: "x", baseRefName: "main", isDraft: true, reviewRequests: [{ slug: "team" }], assignees: [{ login: "me" }] },
]);
const GL_MRS = JSON.stringify([
  { iid: 3, title: "MR", author: { username: "me" }, source_branch: "a", target_branch: "main", draft: false, detailed_merge_status: "not_approved", reviewers: [{ username: "you" }], assignees: [], web_url: "u", updated_at: "2026-11-12T00:00:00Z" },
  { iid: 4, title: "Draft: wip", author: { username: "you" }, source_branch: "b", target_branch: "main", draft: true, reviewers: [{ username: "ME" }], assignees: [] },
]);

function github(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@github.com:o/r.git\n" };
  if (args[0] === "api") return { code: 0, stdout: JSON.stringify({ login: "me" }) };
  return { code: 0, stdout: GH_PRS };
}
function gitlab(command: string, args: string[]): Reply {
  if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n" };
  if (command === "git") return { code: 0, stdout: "git@gitlab.example.com:g/r.git\n" };
  if (args[0] === "api") return { code: 0, stdout: JSON.stringify({ username: "me" }) };
  return { code: 0, stdout: GL_MRS };
}

test("the board loads its pull requests as soon as it opens", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  const list = h.calls.find((c) => c.command === "gh" && c.args[0] === "pr");
  expect(list.args.slice(0, 4)).toEqual(["pr", "list", "--state", "open"]);
  expect(list.cwd).toBe("/repo");
  expect(h.view.loading).toBe(false);
  expect(h.view.cols.all.map((p: any) => p.num)).toEqual([7, 8]);
  expect(h.view.cols.review.map((p: any) => p.num)).toEqual([7]);
  expect(h.view.cols.assigned.map((p: any) => p.num)).toEqual([8]);
  expect(h.view.cols.created.map((p: any) => p.num)).toEqual([7]);
});

test("every exec argument is a string", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  for (const c of h.calls) for (const a of c.args) expect(typeof a).toBe("string");
});

test("GitLab repos list open merge requests with glab's own flags", async () => {
  const h = harness(board, "PrBoard", gitlab);
  h.view.init({}, h.cx);
  await h.settle();
  const list = h.calls.find((c) => c.command === "glab" && c.args[0] === "mr");
  expect(list.args).not.toContain("--state");
  expect(list.args).toContain("--output");
  const user = h.calls.find((c) => c.command === "glab" && c.args[0] === "api");
  expect(user.args).not.toContain("--jq");
  expect(h.view.error).toBe(null);
  expect(h.view.cols.review.map((p: any) => p.num)).toEqual([4]);
  expect(h.view.cols.created.map((p: any) => p.num)).toEqual([3]);
  expect(h.view.cols.all.find((p: any) => p.num === 4).draft).toBe(true);
});

test("the signed-in user is remembered per forge, not shared between them", async () => {
  const h = harness(board, "PrBoard", github);
  h.store.set("prboard.me.glab", "someone-else");
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.cols.created.map((p: any) => p.num)).toEqual([7]);
  expect(h.store.get("prboard.me.gh")).toBe("me");
});

test("a failed list shows the CLI's message", async () => {
  const h = harness(board, "PrBoard", (c, a) => c === "gh" && a[0] === "pr" ? { code: 1, stdout: "", stderr: "gh auth login first\n" } : github(c, a));
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.view.error).toBe("gh auth login first");
});

test("a missing CLI is explained, not thrown", async () => {
  const failing = harness(board, "PrBoard", () => { throw new Error("cannot start gh"); });
  failing.view.init({}, failing.cx);
  await failing.settle();
  expect(failing.view.error).toContain("gh");
  expect(failing.view.loading).toBe(false);
});

test("cards stack their lines and open the diff window with the repo", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  const tree = h.view.render(h.cx).node;
  expect(textOf(tree)).toContain("Fix it");
  const card = findId(tree, "pr-7");
  expect(card.kind).toBe("v");
  card.click({}, h.cx);
  expect(h.overlays[0].mod).toBe("prdiff");
  expect(h.overlays[0].props.cwd).toBe("/repo");
  expect(h.overlays[0].props.kind).toBe("gh");
});

test("a refresh keeps the repo a click needs", async () => {
  const h = harness(board, "PrBoard", github);
  h.view.init({}, h.cx);
  await h.settle();
  h.view.refresh(h.cx);
  h.view.open(h.view.cols.all[0]);
  expect(h.overlays[0].props.cwd).toBe("/repo");
  await h.settle();
});

test("the diff window loads the diff as soon as it opens", async () => {
  const h = harness(diff, "PrDiff", (c, a) => ({ code: 0, stdout: "diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n" }), { pr: { num: 7 }, cwd: "/repo", kind: "gh" });
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.calls[0].command).toBe("gh");
  expect(h.calls[0].args.slice(0, 3)).toEqual(["pr", "diff", "7"]);
  expect(h.calls[0].args).toContain("never");
  expect(h.view.loading).toBe(false);
  expect(h.view.rows.map((r: any) => r.kind)).toEqual(["", "@", "-", "+"]);
});

test("an empty diff has no rows", async () => {
  const h = harness(diff, "PrDiff", () => ({ code: 0, stdout: "" }), { pr: { num: 3 }, cwd: "/repo", kind: "glab" });
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.calls[0].command).toBe("glab");
  expect(h.view.rows).toEqual([]);
});

test("the diff window without a pull request asks no CLI", async () => {
  const h = harness(diff, "PrDiff", () => ({ code: 0, stdout: "" }), { overlay: "o1" });
  h.view.init({}, h.cx);
  await h.settle();
  expect(h.calls).toEqual([]);
  expect(h.view.error).toContain("Pull requests panel");
});
