import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, fns, harness as modHarness, findId as modFindId, textOf as modTextOf, element as modElement, type Reply } from "./mod-harness.ts";

const source = await load("worktree", "Worktree");
const menu = await load("menu", "Menu");

// Execute conditional builders and retain text, without native GPUI layout.
function element() {
  const node = { id: "", children: [] as any[], click: null as any };
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
function textOf(node: any): string {
  return typeof node === "string" ? node : (node?.children ?? []).map(textOf).join(" ");
}
function rowsOf(node: any): any[] {
  return node?.id?.match(/^wt-\d+$/) ? [node] : (node?.children ?? []).flatMap(rowsOf);
}
function findId(node: any, id: string): any {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findId(child, id);
    if (found) return found;
  }
  return null;
}

function harness(focusedMachine: string | null = null, raw: string | null = null, overrides: Record<string, unknown> = {}, replies: (command: string, args: string[], options?: any) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0, stdout: "" })) {
  let spaceList: any[] = [];
  let paneList: any[] = [];
  let agentsList: any[] = [];
  let currentProps: any = { overlay: "overlay" };
  const reads = { spaces: 0, panes: 0 };
  const writes: unknown[] = [];
  const destinations: (string | null)[] = [];
  const executions: any[] = [];
  const storage: Record<string, string> = {};
  const inputs: any[] = [];
  const globals = {
    View: class {}, div: element, v_flex: element, h_flex: element,
    InputState: { new: (opts: any) => { const input: any = { handlers: {}, value: () => opts.value, on: (event: string, fn: any) => { input.handlers[event] = fn; }, focus: () => {} }; inputs.push(input); return input; } },
    Input: { new: element }, Scrollbar: { vertical: element }, theme: () => ({}),
    appHome: () => "/app", readTextFile: async () => raw,
    spaces: () => { reads.spaces++; return structuredClone(spaceList); },
    panes: () => { reads.panes++; return structuredClone(paneList); },
    props: () => currentProps, closeOverlay: () => {},
    run: (command: string, args: any) => {
      writes.push([command, args]);
      if (command === "space.new") destinations.push(args.machine === "" ? null : args.machine ?? focusedMachine);
    },
    exec: async (command: string, args: string[], options: any) => {
      executions.push({ command, args, ...options });
      const reply = replies(command, args, options);
      return { code: reply.code, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
    },
    knownAgents: async () => structuredClone(agentsList),
    localStorage: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
    },
    home: () => "/home/user",
    ...overrides,
  };
  const { Worktree, root } = new Function(...Object.keys(globals), `${source}; return { Worktree, root };`)(...Object.values(globals));
  const worktree = new Worktree();
  Object.assign(worktree, { opening: true, text: "", at: 0, repo: { name: "repo" }, userHome: "/home/user", root: "/home/user/.agentdeck/worktrees" });
  return { worktree, root, reads, writes, destinations, executions, snapshot: (spaces: any[], panes: any[]) => { spaceList = spaces; paneList = panes; }, agents: (list: any[]) => { agentsList = list; }, storage, inputs, setProps: (p: any) => { currentProps = { ...currentProps, ...p }; } };
}

test("open render reads spaces and panes once and refreshes both on the next render", () => {
  const { worktree, reads, snapshot } = harness();
  worktree.list = Array.from({ length: 80 }, (_, i) => ({ path: `/repo/wt-${i}`, branch: `branch-${i}`, at: 0 }));
  const spaces = worktree.list.map((c: any, i: number) => ({ id: `s${i}`, tabs: [{ id: `tab${i}` }] }));
  const panes = worktree.list.map((c: any, i: number) => ({ tab: `tab${i}`, cwd: `${c.path}/src` }));
  snapshot(spaces, panes);
  const first = rowsOf(worktree.render({}).node);
  expect(reads).toEqual({ spaces: 1, panes: 1 });
  expect(first).toHaveLength(80);
  for (let i = 0; i < first.length; i++) {
    expect(textOf(first[i])).toContain(`branch-${i}`);
    expect(textOf(first[i])).toContain(" open ");
  }
  snapshot(spaces.slice(0, -1), panes.map((p: any, i: number) => i === 0 ? { ...p, cwd: "/elsewhere" } : p));
  const second = rowsOf(worktree.render({}).node);
  expect(reads).toEqual({ spaces: 2, panes: 2 });
  expect(textOf(second[0])).not.toContain(" open ");
  expect(textOf(second[79])).not.toContain(" open ");
  expect(textOf(second[1])).toContain(" open ");
});

test("open clicks read fresh snapshots once and select an existing space or create one", () => {
  const { worktree, reads, writes, snapshot } = harness();
  const checkout = { path: "/repo/worktree", branch: "branch", at: 0 };
  worktree.list = [checkout];
  snapshot([], []);
  worktree.render({});
  snapshot([{ id: "existing", tabs: [{ id: "tab" }] }], [{ tab: "tab", cwd: checkout.path }]);
  worktree.open(checkout);
  expect(reads).toEqual({ spaces: 2, panes: 2 });
  expect(writes).toEqual([["space.select", { id: "existing" }]]);
  snapshot([], []);
  worktree.open(checkout);
  expect(reads).toEqual({ spaces: 3, panes: 3 });
  expect(writes[1]).toEqual(["space.new", { folder: checkout.path, machine: "" }]);
  worktree.open(undefined);
  expect(reads).toEqual({ spaces: 3, panes: 3 });
});

for (const on of [undefined, null, "server"]) {
  for (const focused of [null, "server"]) {
    test(`create and open stay on ${on ?? "local"} while ${focused ?? "local"} is focused`, async () => {
      const { worktree, destinations, executions } = harness(focused);
      Object.assign(worktree, {
        on, text: "feature", repo: { name: "repo", main: "/repo", top: "/repo" }, list: [],
      });
      expect(await worktree.create()).toBe("");
      expect(executions).toHaveLength(2);
      expect(executions.every(e => (e.on ?? null) === (on ?? null))).toBe(true);
      expect(executions[1].args).toEqual(["worktree", "add", "/home/user/.agentdeck/worktrees/repo/feature", "feature"]);
      worktree.open({ path: "/repo/existing" });
      expect(destinations).toEqual([on ?? null, on ?? null]);
    });
  }
}

for (const [branch, folder] of [
  ["음악수행", "음악수행"], ["쪼지학", "쪼지학"],
  ["हिन्दी", "हिन्दी"], ["हिंदी", "हिंदी"],
  ["का", "का"], ["कि", "कि"],
  ["বাংলা", "বাংলা"],
  ["feature/हिन्दी", "feature-हिन्दी"],
  ["feature/음악수행-１２٣", "feature-음악수행-１２٣"],
  ["음악수행".normalize("NFD"), "음악수행"],
  ["feature/ASCII_1.2--fix", "feature-ASCII_1.2--fix"],
]) {
  test(`branch ${branch} uses folder ${folder}`, async () => {
    const { worktree, executions, writes } = harness();
    Object.assign(worktree, { text: branch, repo: { name: "repo", main: "/repo", top: "/repo" } });
    expect(await worktree.create()).toBe("");
    const path = `/home/user/.agentdeck/worktrees/repo/${folder}`;
    expect(executions[1].args).toEqual(["worktree", "add", path, branch]);
    expect(writes[0][1].folder).toBe(path);
  });
}

test("symbol-only branches get stable distinct non-empty folders", async () => {
  const folders: string[] = [];
  for (const branch of ["🎵", "🎶", "🎵"]) {
    const { worktree, executions } = harness();
    Object.assign(worktree, { text: branch, repo: { name: "repo", main: "/repo", top: "/repo" } });
    expect(await worktree.create()).toBe("");
    const path = executions[1].args[2];
    expect(path).toMatch(/\/repo\/branch-[0-9a-f]{8}$/);
    folders.push(path);
  }
  expect(folders[0]).toBe(folders[2]);
  expect(folders[0]).not.toBe(folders[1]);
});

test("space matching keeps deepest checkout, machine, live-folder and fallback rules", () => {
  const { worktree, reads, writes, snapshot } = harness();
  const paths = ["C:/repo", "C:/repo/nested", "C:/repo/fallback", "C:/repo-other"];
  worktree.list = paths.map(path => ({ path }));
  snapshot([
    { id: "remote", machine: "server", folder: paths[0] },
    { id: "nested", folder: paths[0], tabs: [{ id: "tab" }] },
    { id: "fallback", folder: paths[2] },
    { id: "other", folder: paths[3] },
  ], [
    { tab: "tab" },
    { tab: "tab", cwd: "C:\\repo\\nested\\src" },
    { tab: "tab", cwd: paths[0] },
  ]);
  for (const checkout of worktree.list) worktree.open(checkout);
  expect(writes).toEqual([
    ["space.new", { folder: paths[0], machine: "" }],
    ["space.select", { id: "nested" }],
    ["space.select", { id: "fallback" }],
    ["space.select", { id: "other" }],
  ]);
  worktree.on = "server";
  worktree.open(worktree.list[0]);
  expect(writes[4]).toEqual(["space.select", { id: "remote" }]);
  expect(reads).toEqual({ spaces: 5, panes: 5 });
});

test("a task brings an agent picker; Enter starts that agent with the task", async () => {
  const { worktree, writes, storage, setProps } = harness();
  const agentsList = [
    { key: "claude", name: "Claude Code", run: ["claude"], installed: true },
    { key: "codex", name: "Codex", run: ["codex"], installed: true },
    { key: "pi", name: "Pi", run: ["pi"], installed: false },
  ];
  const installed = agentsList.filter(a => a.installed);
  storage["worktree.agent"] = "codex";
  const pick = installed.findIndex(a => a.key === "codex");
  setProps({ folder: "/repo", action: "new", branch: "12-fix", task: "Work on #12" });
  Object.assign(worktree, {
    opening: false, text: "12-fix", repo: { name: "repo", main: "/repo", top: "/repo" },
    userHome: "/home/user", agents: installed, pick,
  });
  const rendered = worktree.render({}).node;
  const text = textOf(rendered);
  expect(text).toContain("Codex");
  expect(text).not.toContain("Pi");
  await worktree.create();
  expect(writes[0]).toEqual(["space.new", {
    folder: "/home/user/.agentdeck/worktrees/repo/12-fix",
    machine: "",
    tab: undefined,
    argv: ["codex"],
    task: "Work on #12",
  }]);
});

test("picking another agent is remembered", () => {
  const { worktree, storage, setProps } = harness();
  const installed = [
    { key: "claude", name: "Claude Code", run: ["claude"], installed: true },
    { key: "codex", name: "Codex", run: ["codex"], installed: true },
  ];
  setProps({ folder: "/repo", action: "new", task: "Work" });
  Object.assign(worktree, {
    opening: false, text: "fix", repo: { name: "repo", main: "/repo", top: "/repo" },
    userHome: "/home/user", agents: installed, pick: 0,
  });
  worktree.pickAgent(0);
  expect(worktree.pick).toBe(0);
  expect(storage["worktree.agent"]).toBe("claude");
  // A click on a pill moves the highlight: it must redraw.
  let notified = 0;
  findId(worktree.render({}).node, "wt-agent-1").click({}, { notify: () => { notified++; } });
  expect(worktree.pick).toBe(1);
  expect(storage["worktree.agent"]).toBe("codex");
  expect(notified).toBe(1);
});

test("a task with no installed agent says so as soon as it opens", async () => {
  const { worktree, writes, agents, setProps } = harness(null, null, {}, gitRepo);
  agents([{ key: "pi", name: "Pi", run: ["pi"], installed: false }]);
  setProps({ folder: "/repo", action: "new", branch: "12-fix", task: "Work on #12" });
  const { cx, settle } = fakeCx();
  worktree.init({}, cx);
  await settle();
  const root = worktree.render(cx).node;
  expect(textOf(root)).toContain("No agent is installed to take this task.");
  expect(findId(root, "wt-agent-0")).toBeNull();
  expect(writes).toEqual([]);
});

test("a task with no installed agent says so and creates nothing", async () => {
  const { worktree, writes, setProps } = harness();
  setProps({ folder: "/repo", action: "new", task: "Work" });
  Object.assign(worktree, {
    opening: false, text: "fix", repo: { name: "repo", main: "/repo", top: "/repo" },
    userHome: "/home/user", agents: [],
  });
  const error = await worktree.create();
  expect(error).toBe("No agent is installed to take this task.");
  expect(writes).toEqual([]);
});

test("a branch checked out elsewhere shows git's words and opens no space", async () => {
  const { worktree, writes, setProps } = harness(null, null, {}, (command, args) => {
    if (command === "git" && args.includes("show-ref")) return { code: 0, stdout: "" };
    if (command === "git" && args.includes("worktree") && args.includes("add")) {
      return { code: 128, stdout: "", stderr: "fatal: '12-fix' is already checked out at '/repo'" };
    }
    return { code: 0, stdout: "" };
  });
  setProps({ folder: "/repo", action: "new", branch: "12-fix" });
  Object.assign(worktree, {
    opening: false, text: "12-fix", repo: { name: "repo", main: "/repo", top: "/repo" },
    userHome: "/home/user",
  });
  const error = await worktree.create();
  expect(error).toContain("already checked out");
  expect(writes).toEqual([]);
});

test("no task, no picker: today's dialog is unchanged", async () => {
  const { worktree, writes, setProps } = harness();
  setProps({ folder: "/repo", action: "new", branch: "fix" });
  Object.assign(worktree, {
    opening: false, text: "fix", repo: { name: "repo", main: "/repo", top: "/repo" },
    userHome: "/home/user",
  });
  const rendered = worktree.render({}).node;
  const text = textOf(rendered);
  expect(text).not.toContain("Claude Code");
  expect(text).not.toContain("Codex");
  expect(worktree.agents).toBeUndefined();
  await worktree.create();
  expect(writes[0]).toEqual(["space.new", {
    folder: "/home/user/.agentdeck/worktrees/repo/fix",
    machine: "",
    tab: undefined,
    argv: undefined,
    task: undefined,
  }]);
});

// Opens the dialog the way the app does: init, then wait for its loading spawn.
function fakeCx() {
  const spawned: Promise<unknown>[] = [];
  const cx: any = {
    notify: () => {}, stop_propagation: () => {},
    focus_handle: () => ({ focus: () => {} }),
    timer: { after: (_ms: number, fn: () => void) => fn() },
    spawn: (fn: (cx: any) => Promise<unknown>) => { spawned.push(fn(cx)); },
  };
  return { cx, settle: async () => { while (spawned.length) await spawned.shift(); } };
}
function gitRepo(command: string, args: string[]) {
  if (command === "git" && args.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n" };
  if (command === "git" && args.includes("--git-common-dir")) return { code: 0, stdout: "/repo/.git\n" };
  if (command === "git" && args.includes("show-ref")) return { code: 1, stdout: "" };
  return { code: 0, stdout: "" };
}

test("a branch with a task waits for Enter before it creates anything", async () => {
  const { worktree, writes, executions, inputs, agents, setProps } = harness(null, null, {}, gitRepo);
  agents([{ key: "claude", name: "Claude Code", run: ["claude"], installed: true }]);
  setProps({ folder: "/repo", action: "new", branch: "12-fix", task: "Work on #12" });
  const { cx, settle } = fakeCx();
  worktree.init({}, cx);
  await settle();
  expect(worktree.repo?.top).toBe("/repo");
  expect(writes).toEqual([]);
  expect(executions.some((e) => e.args.includes("worktree") && e.args.includes("add"))).toBe(false);
  inputs[0].handlers.submit({}, cx);
  await settle();
  expect(executions.filter((e) => e.args.includes("worktree") && e.args.includes("add")).length).toBe(1);
  expect(writes).toEqual([["space.new", {
    folder: "/home/user/.agentdeck/worktrees/repo/12-fix", machine: "", tab: undefined, argv: ["claude"], task: "Work on #12",
  }]]);
});

test("a branch with no task still creates it on load", async () => {
  const { worktree, writes, setProps } = harness(null, null, {}, gitRepo);
  setProps({ folder: "/repo", action: "new", branch: "fix" });
  const { cx, settle } = fakeCx();
  worktree.init({}, cx);
  await settle();
  expect(writes).toEqual([["space.new", {
    folder: "/home/user/.agentdeck/worktrees/repo/fix", machine: "", tab: undefined, argv: undefined, task: undefined,
  }]]);
});

// ---------------------------------------------------------------- clean up

const pure = () => fns(source, ["listAll", "goneBranches", "classify"]);

test("listAll keeps linked worktrees and marks missing ones", () => {
  const { listAll } = pure();
  const porcelain = [
    "worktree /r\nHEAD 1111\nbranch refs/heads/main",
    "worktree /w/a\nHEAD 2222\nbranch refs/heads/a",
    "worktree /w/b\nHEAD 3333\nbranch refs/heads/b\nprunable gitdir file points to non-existent location",
    "worktree /w/bare\nbare",
  ].join("\n\n") + "\n";
  expect(listAll(porcelain)).toEqual([
    { path: "/w/a", branch: "a", missing: false },
    { path: "/w/b", branch: "b", missing: true },
  ]);
  expect(listAll("worktree /r\nHEAD 1\ndetached\n\nworktree /w/x\nHEAD 2\ndetached\n")).toEqual([{ path: "/w/x", branch: null, missing: false }]);
});

test("goneBranches reads the branches whose upstream is gone", () => {
  const { goneBranches } = pure();
  expect([...goneBranches("main\t\nb\t[gone]\ne\t[ahead 1]\nf\t[gone]\n")]).toEqual(["b", "f"]);
  expect(goneBranches("").size).toBe(0);
});

test("classify: in use and dirty can't be picked; merged, gone and missing are picked", () => {
  const { classify } = pure();
  const f = { branch: "x", missing: false, inUse: null, dirty: 0, merged: false, gone: false, base: "main" };
  expect(classify({ ...f, inUse: "fix", missing: true, merged: true })).toEqual({ reason: "In use by fix", selectable: false, picked: false });
  expect(classify({ ...f, missing: true, dirty: 2 })).toEqual({ reason: "Folder is gone", selectable: true, picked: true });
  expect(classify({ ...f, dirty: 1, merged: true })).toEqual({ reason: "1 uncommitted change", selectable: false, picked: false });
  expect(classify({ ...f, dirty: 3 })).toEqual({ reason: "3 uncommitted changes", selectable: false, picked: false });
  expect(classify({ ...f, merged: true, gone: true })).toEqual({ reason: "Merged into main", selectable: true, picked: true });
  expect(classify({ ...f, gone: true })).toEqual({ reason: "Branch deleted on origin", selectable: true, picked: true });
  expect(classify(f)).toEqual({ reason: "Not merged", selectable: true, picked: false });
  // Detached: its commits may be reachable from nowhere else.
  const detached = { reason: "Detached HEAD; its commits could be lost", selectable: false, picked: false };
  expect(classify({ ...f, branch: null })).toEqual(detached);
  expect(classify({ ...f, branch: null, merged: true, gone: true })).toEqual(detached);
  expect(classify({ ...f, branch: null, dirty: 1 })).toEqual({ reason: "1 uncommitted change", selectable: false, picked: false });
  expect(classify({ ...f, branch: null, missing: true })).toEqual({ reason: "Folder is gone", selectable: true, picked: true });
  // The base branch: removable by hand, never picked, never "merged".
  const baseRow = { reason: "Base branch", selectable: true, picked: false };
  expect(classify({ ...f, branch: "main" })).toEqual(baseRow);
  expect(classify({ ...f, branch: "main", merged: true, gone: true })).toEqual(baseRow);
});

test("a worktree on the base branch can be removed but its branch is never deleted", async () => {
  const porcelain = ["worktree /r\nHEAD 0\nbranch refs/heads/dev",
    "worktree /w/m\nHEAD 1\nbranch refs/heads/main",
    "worktree /w/a\nHEAD 1\nbranch refs/heads/a"].join("\n\n") + "\n";
  const inner = cleanRepo();
  const h = await openClean((command: string, args: string[], options: any = {}) =>
    args.join(" ") === "worktree list --porcelain" ? { code: 0, stdout: porcelain } : inner(command, args, options));
  expect(h.worktree.rows.map((r: any) => [r.branch, r.reason, r.selectable, r.picked])).toEqual([["main", "Base branch", true, false], ["a", "Merged into main", true, true]]);
  findId(h.view(), "wt-clean-0").click({}, h.cx);
  await h.worktree.removeChosen();
  expect(removals(h.executions)).toEqual([["worktree", "remove", "/w/m"], ["worktree", "remove", "/w/a"], ["branch", "-d", "a"]]);
});

test("a base-branch worktree whose folder is gone is pruned, its branch kept", async () => {
  const porcelain = ["worktree /r\nHEAD 0\nbranch refs/heads/dev",
    "worktree /w/m\nHEAD 1\nbranch refs/heads/main\nprunable gitdir file points to non-existent location"].join("\n\n") + "\n";
  const inner = cleanRepo();
  const h = await openClean((command: string, args: string[], options: any = {}) =>
    args.join(" ") === "worktree list --porcelain" ? { code: 0, stdout: porcelain } : inner(command, args, options));
  await h.worktree.removeChosen();
  expect(removals(h.executions)).toEqual([["worktree", "prune"]]);
});

// A repo at /r on main with linked worktrees a (merged), b (gone on origin),
// c (dirty), d (a space is in it), e (not merged), f (folder gone).
const PORCELAIN = ["worktree /r\nHEAD 0\nbranch refs/heads/main",
  ...["a", "b", "c", "d", "e"].map((b) => `worktree /w/${b}\nHEAD 1\nbranch refs/heads/${b}`),
  "worktree /w/f\nHEAD 2\nbranch refs/heads/f\nprunable gitdir file points to non-existent location"].join("\n\n") + "\n";
function cleanRepo(o: { fetch?: number; branchD?: (b: string) => { code: number; stdout?: string; stderr?: string } } = {}) {
  return (command: string, args: string[], options: any = {}) => {
    const a = args.join(" ");
    if (command !== "git") return { code: 1, stdout: "" };
    if (a === "rev-parse --show-toplevel") return { code: 0, stdout: "/r\n" };
    if (a === "rev-parse --path-format=absolute --git-common-dir") return { code: 0, stdout: "/r/.git\n" };
    if (a === "fetch --prune origin") return { code: o.fetch ?? 0, stdout: "", stderr: o.fetch ? "fatal: unable to access" : "" };
    if (a === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n" };
    if (a.startsWith("branch --merged origin/main")) return { code: 0, stdout: "main\na\n" };
    if (a.startsWith("for-each-ref")) return { code: 0, stdout: "main\t\na\t\nb\t[gone]\nc\t\nd\t\ne\t[ahead 1]\nf\t\n" };
    if (a === "worktree list --porcelain") return { code: 0, stdout: PORCELAIN };
    if (a.endsWith("status --porcelain")) return { code: 0, stdout: options.cwd === "/w/c" ? " M x\n" : "" };
    if (args[0] === "branch" && args[1] === "-d") return o.branchD?.(args[2]) ?? { code: 0, stdout: `Deleted branch ${args[2]}` };
    return { code: 0, stdout: "" };
  };
}
async function openClean(replies = cleanRepo()) {
  const h = harness(null, null, {}, replies);
  h.snapshot([{ id: "sd", name: "d-space", folder: "/w/d", machine: null, tabs: [] }], []);
  h.setProps({ folder: "/r", action: "clean" });
  const { cx, settle } = fakeCx();
  h.worktree.init({}, cx);
  await settle();
  const view = () => h.worktree.render(cx).node;
  return { ...h, cx, settle, view };
}
const removals = (executions: any[]) => executions.filter((e) => ["remove", "prune", "-d"].includes(e.args[1])).map((e) => e.args);

test("clean view lists reasons and only removes what's picked, without force", async () => {
  const h = await openClean();
  const text = textOf(h.view());
  for (const r of ["Merged into main", "Branch deleted on origin", "1 uncommitted change", "In use by d-space", "Not merged", "Folder is gone"]) expect(text).toContain(r);
  expect(text).not.toContain("/r ");
  // status is never run in a folder that's gone.
  expect(h.executions.some((e) => e.cwd === "/w/f")).toBe(false);
  // Nothing is removed on load.
  expect(removals(h.executions)).toEqual([]);
  await h.worktree.removeChosen();
  const all = h.executions.map((e) => e.args);
  expect(removals(h.executions)).toEqual([
    ["worktree", "remove", "/w/a"], ["branch", "-d", "a"],
    ["worktree", "remove", "/w/b"], ["branch", "-d", "b"],
    ["worktree", "prune"], ["branch", "-d", "f"],
  ]);
  expect(all.flat().some((x: string) => x === "--force" || x === "-D" || x === "-f")).toBe(false);
  expect(textOf(h.view())).toContain("Removed 3.");
});

test("clicks toggle only selectable rows; the branch toggle keeps branches", async () => {
  const h = await openClean();
  for (const i of [...Array(6).keys()]) findId(h.view(), `wt-clean-${i}`).click({}, h.cx);
  // a, b, f were picked and are now off; e is now on; c and d stay off.
  findId(h.view(), "wt-clean-branches").click({}, h.cx);
  await h.worktree.removeChosen();
  expect(removals(h.executions)).toEqual([["worktree", "remove", "/w/e"]]);
});

test("Enter removes the picked ones, and Enter again closes", async () => {
  const h = await openClean();
  let closed = 0;
  h.worktree.close = () => { closed++; };
  const enter = { key: "enter" };
  h.worktree.key(enter, h.cx);
  await h.settle();
  expect(removals(h.executions).length).toBe(6);
  expect(closed).toBe(0);
  h.worktree.key(enter, h.cx);
  await h.settle();
  expect(closed).toBe(1);
  expect(removals(h.executions).length).toBe(6);
});

test("a space opened since the list was read keeps its worktree", async () => {
  const h = await openClean();
  h.snapshot([{ id: "sd", name: "d-space", folder: "/w/d", machine: null, tabs: [] }, { id: "sa", name: "a-space", folder: "/w/a", machine: null, tabs: [] }], []);
  await h.worktree.removeChosen();
  expect(removals(h.executions).some((a) => a.includes("/w/a") || a.includes("a"))).toBe(false);
  expect(textOf(h.view())).toContain("In use by a-space");
});

test("a pane inside a worktree marks it in use", async () => {
  const h = harness(null, null, {}, cleanRepo());
  h.snapshot([{ id: "s1", name: "other", folder: "/elsewhere", machine: null, tabs: [{ id: "t1" }, { id: "t2" }] }], [
    { tab: "t1", cwd: "/elsewhere" }, { tab: "t2", cwd: "/w/e/src", title: "claude", program: { name: "Claude Code" } },
  ]);
  h.setProps({ folder: "/r", action: "clean" });
  const { cx, settle } = fakeCx();
  h.worktree.init({}, cx);
  await settle();
  expect(textOf(h.worktree.render(cx).node)).toContain("In use by Claude Code");
});

test("a branch git won't delete is reported, not hidden", async () => {
  const h = await openClean(cleanRepo({ branchD: (b) => b === "b" ? { code: 1, stdout: "", stderr: "error: the branch 'b' is not fully merged" } : { code: 0, stdout: "" } }));
  await h.worktree.removeChosen();
  expect(textOf(h.view())).toContain("b: error: the branch 'b' is not fully merged");
});

test("an unreachable origin still lists from local refs", async () => {
  const h = await openClean(cleanRepo({ fetch: 128 }));
  const text = textOf(h.view());
  expect(text).toContain("Couldn't reach origin; using what's known here.");
  expect(text).toContain("Merged into main");
  expect(text).toContain("Not merged");
});

test("the space menu offers Clean up worktrees on git spaces, as a 560x480 dialog", async () => {
  const spaces = () => [{ id: "s1", folder: "/r", machine: null, tabs: [{ id: "t1" }] }];
  const replies = (_c: string, a: string[]): Reply => ({ code: 0, stdout: a.includes("--show-toplevel") ? "/r\n" : "/r/.git\n" });
  const h = modHarness(menu, "Menu", replies, { tab: "space", target: { id: "s1" } }, "/r", { spaces, panes: () => [], svg: () => modElement(), keys: () => [], terminals: () => [] });
  h.view.init({}, h.cx);
  await h.settle();
  const root = h.view.render(h.cx).node;
  const i = [...Array(10).keys()].find((n) => modTextOf(modFindId(root, `mi-${n}`)).includes("Clean up worktrees"));
  expect(i).toBeDefined();
  modFindId(root, `mi-${i}`).click({}, h.cx);
  expect(h.overlays).toEqual([{ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: "s1", action: "clean" } }]);
});

test("a bare repo hidden beside its worktrees is named after its project", async () => {
  const replies: Record<string, string> = {
    "--show-toplevel": "/home/user/project/topic",
    "--git-common-dir": "/home/user/project/.bare",
  };
  const exec = async (_command: string, args: string[]) => ({ code: 0, stdout: replies[args.at(-1)!] + "\n", stderr: "" });
  const globals = { View: class {}, div: element, v_flex: element, h_flex: element, Input: { new: element }, Scrollbar: { vertical: element }, theme: () => ({}), exec };
  const repoOf = new Function(...Object.keys(globals), `${source}; return repoOf;`)(...Object.values(globals));
  expect(await repoOf("/home/user/project/topic", null)).toEqual({
    top: "/home/user/project/topic", main: "/home/user/project/.bare", name: "project", linked: true,
  });
});

test("configured roots drive both the checkout and its space, expanding the target home", async () => {
  for (const [directory, userHome, on, expected] of [
    [undefined, "/home/user", null, "/home/user/.agentdeck/worktrees"],
    ["~/Developer/worktrees", "/home/remote", "server", "/home/remote/Developer/worktrees"],
    ["/srv/worktrees/", "/home/remote", "server", "/srv/worktrees"],
    ["C:\\Developer\\Work Trees\\", "C:\\Users\\user", null, "C:/Developer/Work Trees"],
    ["~\\Developer\\worktrees", "C:\\Users\\user", "server", "C:/Users/user/Developer/worktrees"],
    ["~", "/home/user", null, "/home/user"],
    ["/", "/home/user", null, ""],
  ] as const) {
    const { worktree, root, executions, writes } = harness(null, JSON.stringify({ worktrees: { directory } }));
    Object.assign(worktree, { opening: false, on, userHome, text: "feature/new", repo: { name: "repo", main: "/repo", top: "/repo" }, root: await root(userHome) });
    const folder = `${expected}/repo/feature-new`;
    expect(await worktree.create()).toBe("");
    expect(executions[1].args).toEqual(["worktree", "add", folder, "feature/new"]);
    expect(executions[1].on).toBe(on);
    expect(writes).toEqual([["space.new", { folder, machine: on ?? "", tab: undefined, argv: undefined }]]);
    expect(textOf(worktree.render({}).node)).toContain(`${expected.replace(userHome.replace(/\\/g, "/"), "~")}/repo/`);
  }
});

test("missing settings keep the old location, while invalid directories cannot create elsewhere", async () => {
  expect(await harness().root("/home/user")).toBe("/home/user/.agentdeck/worktrees");
  for (const directory of ["", "   ", 42, {}, "relative/worktrees", "C:relative"]) {
    const { root } = harness(null, JSON.stringify({ worktrees: { directory } }));
    await expect(root("/home/user")).rejects.toThrow("worktrees.directory");
  }
  await expect(harness(null, "{").root("/home/user")).rejects.toThrow();
});

function execute(command: string, args: string[], { cwd }: { cwd: string }) {
  const result = Bun.spawnSync([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function fixtureGit(cwd: string, ...args: string[]) {
  const result = execute("git", args, { cwd });
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function withLinkedCheckout(runTest: (main: string, linked: string) => Promise<void>) {
  const folder = await mkdtemp(join(process.platform === "linux" ? "/var/tmp" : tmpdir(), "herdr-worktree-"));
  try {
    const root = await realpath(folder);
    const main = join(root, "main"), linked = join(root, "linked with spaces");
    fixtureGit(root, "init", "--initial-branch=main", main);
    fixtureGit(main, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "--allow-empty", "-m", "fixture");
    fixtureGit(main, "worktree", "add", "-b", "linked", linked);
    await runTest(main, linked);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function removeDialog(folder: string, { branch, platform = "linux", exec = execute }: {
  branch?: string; platform?: string; exec?: typeof execute;
} = {}) {
  const closedSpaces: { id: string; checkoutPresent: boolean }[] = [];
  const closedOverlays: string[] = [];
  const { worktree, snapshot } = harness(null, null, {
    home: () => folder,
    window: () => ({ platform }),
    props: () => ({ space: "target", action: "remove", overlay: "dialog", branch }),
    InputState: { new: () => ({ on() {}, focus() {} }) },
    run: (command: string, args: { id: string }) => {
      if (command === "space.close") closedSpaces.push({ id: args.id, checkoutPresent: existsSync(folder) });
    },
    closeOverlay: (id: string) => closedOverlays.push(id),
    exec,
  });
  snapshot([{ id: "target", name: "Worktree", folder }], []);
  let pending = Promise.resolve();
  const cx = {
    notify() {},
    focus_handle: () => ({ focus() {} }),
    spawn: (task: (context: { notify(): void }) => Promise<void>) => { pending = task(cx); },
  };
  worktree.init({}, cx);
  return {
    worktree, closedSpaces, closedOverlays, ready: pending,
    enter: async () => { worktree.key({ key: "enter" }, cx); await pending; },
  };
}

test("remove leaves the main checkout and its space alone on Enter and with a branch prop", async () => {
  await withLinkedCheckout(async (main) => {
    for (const branch of [undefined, "main"]) {
      const dialog = removeDialog(main, { branch });
      await dialog.ready;
      if (!branch) await dialog.enter();
      expect(dialog.closedSpaces).toEqual([]);
      expect(dialog.closedOverlays).toEqual([]);
      expect(textOf(dialog.worktree.render({}).node)).toContain("This is the repository's main checkout");
      expect(dialog.worktree.error).toBe("");
      expect(existsSync(main)).toBe(true);
    }
  });
});

test("remove shows a locked checkout's reason and keeps the space open on Windows", async () => {
  await withLinkedCheckout(async (main, linked) => {
    fixtureGit(main, "worktree", "lock", "--reason", "Réservé for another machine\nLeave this checkout in place", linked);
    const dialog = removeDialog(linked, { platform: "windows" });
    await dialog.ready;
    await dialog.enter();
    const message = textOf(dialog.worktree.render({}).node);
    expect(message).toContain("This worktree is locked:");
    expect(message).toContain("Réservé for another machine");
    expect(message).toContain("Leave this checkout in place");
    expect(dialog.closedSpaces).toEqual([]);
    expect(dialog.closedOverlays).toEqual([]);
    expect(existsSync(linked)).toBe(true);
  });
});

test("remove keeps the space open if Git refuses a removal on Unix after preflight", async () => {
  await withLinkedCheckout(async (main, linked) => {
    const dialog = removeDialog(linked, {
      exec: (command, args, options) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          fixtureGit(main, "worktree", "lock", "--reason", "locked just before removal", linked);
        }
        return execute(command, args, options);
      },
    });
    await dialog.ready;
    await dialog.enter();
    expect(dialog.worktree.error).toContain("locked just before removal");
    expect(dialog.closedSpaces).toEqual([]);
    expect(dialog.closedOverlays).toEqual([]);
    expect(existsSync(linked)).toBe(true);
  });
});

for (const platform of ["linux", "windows"]) {
  test(`remove warns about new changes and closes a successfully removed checkout on ${platform}`, async () => {
    await withLinkedCheckout(async (main, linked) => {
      const dialog = removeDialog(linked, { platform });
      await dialog.ready;
      await writeFile(join(linked, "untracked.txt"), "uncommitted");
      await dialog.enter();
      expect(textOf(dialog.worktree.render({}).node)).toContain("It has uncommitted changes");
      expect(dialog.closedSpaces).toEqual([]);
      expect(existsSync(join(linked, "untracked.txt"))).toBe(true);

      await dialog.enter();
      expect(dialog.closedSpaces).toEqual([{ id: "target", checkoutPresent: platform === "windows" }]);
      expect(dialog.closedOverlays).toEqual(["dialog"]);
      expect(existsSync(linked)).toBe(false);
      expect(fixtureGit(main, "branch", "--list", "linked")).toBe("linked");
    });
  });
}
