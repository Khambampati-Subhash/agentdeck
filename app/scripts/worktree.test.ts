import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../defaults/mods/worktree/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class Worktree", "class Worktree");

// Execute conditional builders and retain text, without native GPUI layout.
function element() {
  const node = { id: "", children: [] as any[] };
  const el: any = new Proxy(node, { get: (_, method) => {
    if (method === "node") return node;
    return (...args: any[]) => {
      if (method === "id") node.id = args[0];
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

function harness(focusedMachine: string | null = null, replies: (command: string, args: string[]) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0, stdout: "" })) {
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
    spaces: () => { reads.spaces++; return structuredClone(spaceList); },
    panes: () => { reads.panes++; return structuredClone(paneList); },
    props: () => currentProps, closeOverlay: () => {},
    run: (command: string, args: any) => {
      writes.push([command, args]);
      if (command === "space.new") destinations.push(args.machine === "" ? null : args.machine ?? focusedMachine);
    },
    exec: async (command: string, args: string[], options: any) => {
      executions.push({ command, args, ...options });
      const reply = replies(command, args);
      return { code: reply.code, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
    },
    knownAgents: async () => structuredClone(agentsList),
    localStorage: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
    },
    home: () => "/home/user",
  };
  const Worktree = new Function(...Object.keys(globals), `${source}; return Worktree;`)(...Object.values(globals));
  const worktree = new Worktree();
  Object.assign(worktree, { opening: true, text: "", at: 0, repo: { name: "repo" }, userHome: "/home/user" });
  return { worktree, reads, writes, destinations, executions, snapshot: (spaces: any[], panes: any[]) => { spaceList = spaces; paneList = panes; }, agents: (list: any[]) => { agentsList = list; }, storage, inputs, setProps: (p: any) => { currentProps = { ...currentProps, ...p }; } };
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
      expect(executions[1].args).toEqual(["worktree", "add", "/home/user/.herdr/worktrees/repo/feature", "feature"]);
      worktree.open({ path: "/repo/existing" });
      expect(destinations).toEqual([on ?? null, on ?? null]);
    });
  }
}

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
    folder: "/home/user/.herdr/worktrees/repo/12-fix",
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
  const { worktree, writes, setProps } = harness(null, (command, args) => {
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
  expect(text).not.toContain("agent");
  expect(worktree.agents).toBeUndefined();
  await worktree.create();
  expect(writes[0]).toEqual(["space.new", {
    folder: "/home/user/.herdr/worktrees/repo/fix",
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
  const { worktree, writes, executions, inputs, agents, setProps } = harness(null, gitRepo);
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
    folder: "/home/user/.herdr/worktrees/repo/12-fix", machine: "", tab: undefined, argv: ["claude"], task: "Work on #12",
  }]]);
});

test("a branch with no task still creates it on load", async () => {
  const { worktree, writes, setProps } = harness(null, gitRepo);
  setProps({ folder: "/repo", action: "new", branch: "fix" });
  const { cx, settle } = fakeCx();
  worktree.init({}, cx);
  await settle();
  expect(writes).toEqual([["space.new", {
    folder: "/home/user/.herdr/worktrees/repo/fix", machine: "", tab: undefined, argv: undefined, task: undefined,
  }]]);
});
