import { test, expect, setSystemTime } from "bun:test";
import { inboxRows, stamp, trimPreview, keepSelection, message } from "../defaults/mods/inbox/rows.js";

const agent = (address: string, status: string) => ({ address, space: "s1", space_name: "app", tab_name: "main", title: address, program: "claude", status });

test("inboxRows keeps only blocked agents, oldest first", () => {
  const agents = [agent("t1", "blocked"), agent("t2", "working"), agent("t3", "blocked")];
  const rows = inboxRows(agents, [], { t1: 1000, t3: 500 }, 2000);
  expect(rows.map((r: any) => r.address)).toEqual(["t3", "t1"]);
  expect(rows.map((r: any) => r.waited)).toEqual([1500, 1000]);
});

test("inboxRows takes kind and msg from the terminal report", () => {
  const agents = [agent("t1", "blocked"), agent("t2", "blocked")];
  const terminals = [{ address: "t1", report: { kind: "permission", msg: "Apply these changes?" } }, { address: "t2" }];
  const [a, b] = inboxRows(agents, terminals, {}, 10);
  expect(a.kind).toBe("permission");
  expect(a.msg).toBe("Apply these changes?");
  expect(b.kind).toBeNull();
  expect(b.msg).toBe("");
});

test("inboxRows handles remote addresses", () => {
  const rows = inboxRows([agent("vps/t7", "blocked")], [{ address: "vps/t7", report: { kind: "question", msg: "Which?" } }], {}, 1);
  expect(rows[0].kind).toBe("question");
});

test("stamp keeps old stamps, adds new, drops unblocked", () => {
  expect(stamp({ t1: 5, t9: 1 }, ["t1", "t2"], 10)).toEqual({ t1: 5, t2: 10 });
});

test("inboxRows lists blocked or failed sub-agents without a pane, once each", () => {
  const agents = [agent("t1", "working"), agent("t2", "blocked")];
  const live = (address: string, parent: string | null, status: string, more = {}) => ({ address, parent, status, state: "live", program: { name: "Claude" }, ...more });
  const terminals = [
    live("t1", null, "working"),
    live("t2", "t1", "blocked"), // kept: in agents() already
    live("t3", "t1", "blocked", { name: "reviewer", report: { kind: "permission", msg: "Run tests?" } }),
    live("t4", "t3", "error"),
    live("t5", "t1", "working"),
    live("t6", "t1", "blocked", { state: "exited" }),
    live("t7", "t7", "blocked"), // a loop in parents
    live("t8", null, "blocked"), // not a sub-agent: the Agents list doesn't count it either
  ];
  const rows = inboxRows(agents, terminals, {}, 10);
  expect(rows.map((r: any) => r.address)).toEqual(["t2", "t3", "t4", "t7"]);
  const [, kid, grandkid, loop] = rows;
  expect(kid).toMatchObject({ label: "reviewer", kind: "permission", msg: "Run tests?", space_name: "app", tab_name: "main" });
  expect(grandkid).toMatchObject({ label: "Claude", kind: "error", space_name: "app", tab_name: "main" });
  expect(loop).toMatchObject({ space_name: "", tab_name: "" });
  expect(rows[0].label).toBe("t2"); // no program name: its title
});

test("message collapses whitespace and caps long ones", () => {
  expect(message("  Apply\n\tthese   changes?  ")).toBe("Apply these changes?");
  expect(message(undefined)).toBe("");
  const long = message("x ".repeat(400));
  expect(long).toBe("x ".repeat(150).trim() + "…");
  expect(inboxRows([agent("t1", "blocked")], [{ address: "t1", report: { msg: "a\n\nb" } }], {}, 1)[0].msg).toBe("a b");
});

test("trimPreview keeps the last non-blank lines", () => {
  expect(trimPreview("a\n\nb  \nc\n\n\n", 2)).toEqual(["b", "c"]);
  expect(trimPreview("x".repeat(300))[0].length).toBe(200);
  expect(trimPreview("")).toEqual([]);
});

test("keepSelection follows the agent, then clamps", () => {
  const rows = inboxRows([agent("t1", "blocked"), agent("t3", "blocked")], [], { t1: 1000, t3: 500 }, 2000);
  expect(keepSelection(rows, "t1", 0)).toBe(1);
  expect(keepSelection(rows, "t5", 4)).toBe(1);
  expect(keepSelection([], "t1", 0)).toBe(-1);
});

// The popup itself: main.js loaded without a window or a core, its imports passed in.
import { readFile } from "node:fs/promises";
import * as rowsModule from "../defaults/mods/inbox/rows.js";

const mainSource = (await readFile(new URL("../defaults/mods/inbox/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class Inbox", "return class Inbox");

function el() {
  const node: any = { id: "", children: [] as any[] };
  const proxy: any = new Proxy(node, { get: (_, method) => {
    if (method === "node") return node;
    return (...args: any[]) => {
      if (method === "id") node.id = args[0];
      if (method === "bg") node.bg = args[0];
      node.calls = [...(node.calls ?? []), method];
      if (method === "on_click") node.click = args[0];
      if (method === "child") node.children.push(args[0]?.node ?? args[0]);
      if (method === "children") node.children.push(...args[0].map((c: any) => c?.node ?? c));
      if (method === "when" && args[0]) args[1](proxy);
      return proxy;
    };
  } });
  return proxy;
}
const textOf = (node: any): string => typeof node === "string" ? node : (node?.children ?? []).map(textOf).join(" ");

// The shipped layout's shape, with the Agents list shown.
const withAgents = { id: "root", type: "row", children: [{ id: "sidebar", type: "column", children: [{ id: "agents", type: "block", content: { mod: "agents" } }] }] };

function popup({ list = [] as any[], stamps = undefined as unknown, t = {} as Record<string, string>, read = async (_args: string[]) => ({ code: 0, stdout: JSON.stringify({ text: "screen", complete: true, how: "grid" }), stderr: "" }), storage = new Map<string, string>(), shown = withAgents as unknown } = {}) {
  const commands: unknown[][] = [];
  const revealed: number[] = [];
  const ScrollHandle = { new: () => ({ scroll_to_item: (i: number) => revealed.push(i), release: () => true }) };
  const reads: string[][] = [];
  const closed: unknown[] = [];
  const tasks: Promise<unknown>[] = [];
  const localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) };
  const globals: Record<string, unknown> = {
    View: class {}, div: el, svg: el, image: el, v_flex: el, h_flex: el,
    agents: () => list, terminals: () => [], shared: (k: string) => (k === "agents.blocked" ? stamps : undefined), theme: () => t, settings: () => ({}),
    props: () => ({ overlay: "ov1" }), closeOverlay: (id: unknown) => closed.push(id),
    run: (...args: unknown[]) => commands.push(args),
    hc: (args: string[]) => { reads.push(args); return read(args); },
    localStorage, ScrollHandle, layout: () => shown, ...rowsModule,
  };
  const Inbox = new Function(...Object.keys(globals), mainSource)(...Object.values(globals));
  const cx: any = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), timer: { every() {}, after() {} }, spawn: (f: (cx: any) => Promise<unknown>) => tasks.push(f(cx)) };
  const view = new Inbox();
  view.init({}, cx);
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { view, cx, commands, reads, closed, settle, storage, tasks, revealed };
}

test("go focuses the selected agent and closes", () => {
  const { view, commands, closed } = popup({ list: [agent("t1", "blocked"), agent("t2", "blocked")] });
  view.move(1);
  view.go();
  expect(commands).toEqual([["agent.focus", { terminal: "t2" }]]);
  expect(closed).toEqual(["ov1"]);
});

test("go on an empty list does nothing", () => {
  const { view, commands, closed } = popup({ list: [agent("t1", "working")] });
  view.move(1);
  view.go();
  view.peek();
  expect(commands).toEqual([]);
  expect(closed).toEqual([]);
});

test("peek peeks the selected agent", () => {
  const { view, commands } = popup({ list: [agent("t1", "blocked"), agent("t2", "blocked")] });
  view.move(-1);
  view.peek();
  expect(commands).toEqual([["terminal.peek", { terminal: "t2" }]]);
});

test("previews read only blocked agents, once each", async () => {
  const { view, cx, reads, settle } = popup({ list: [agent("t1", "blocked"), agent("t2", "working"), agent("t3", "blocked")] });
  view.refresh(cx);
  view.render(cx);
  await settle();
  view.render(cx);
  expect(reads).toEqual([["read", "t1", "--json"], ["read", "t3", "--json"]]);
  expect(view.previews.get("t1")).toEqual(trimPreview("screen"));
});

test("a failed read leaves an empty preview", async () => {
  for (const read of [async () => { throw Error("gone"); }, async () => ({ code: 1, stdout: "", stderr: "no" })]) {
    const { view, cx, settle } = popup({ list: [agent("t1", "blocked")], read });
    view.refresh(cx);
    await settle();
    expect(view.previews.get("t1")).toEqual([]);
  }
});

test("stamps persist", () => {
  const storage = new Map<string, string>();
  const list = [agent("t1", "blocked")];
  const first = popup({ list, storage });
  first.view.refresh(first.cx);
  const saved = JSON.parse(storage.get("since")!);
  expect(Object.keys(saved)).toEqual(["t1"]);
  const second = popup({ list, storage });
  expect(second.view.since).toEqual(saved);
});

test("the popup lists what each agent asks, and says when none need you", async () => {
  const { view, cx, settle } = popup({ list: [agent("t1", "blocked")] });
  view.render(cx);
  await settle();
  const text = textOf(view.render(cx).node);
  expect(text).toContain("Needs you");
  expect(text).toContain("app · main");
  expect(text).toContain("screen");
  expect(textOf(popup().view.render(cx).node)).toContain("No agent needs you");
});

test("rows sit in a list that takes their height, not the popup's leftover space", () => {
  const { view, cx } = popup({ list: [agent("t1", "blocked"), agent("t2", "blocked")] });
  const find = (node: any, id: string): any => node?.id === id ? node : (node?.children ?? []).map((c: any) => find(c, id)).find(Boolean);
  const root = view.render(cx).node;
  const list = find(root, "inbox-list");
  expect(list).toBeDefined();
  expect(find(list, "ib-t1")).toBeDefined();
  expect(find(list, "ib-t2")).toBeDefined();
  // The popup is as tall as its content: a flex_1 scroll list there gets no height at all.
  expect(list.calls).not.toContain("flex_1");
  expect(root.calls).not.toContain("size_full");
});

test("the agents list's stamps set the waits and order, over the popup's own", () => {
  const now = Date.now();
  const storage = new Map([["since", JSON.stringify({ t1: now - 99 * 3600000 })]]);
  const { view } = popup({ list: [agent("t1", "blocked"), agent("t2", "blocked"), agent("t3", "blocked")], storage, stamps: { t1: now - 120000, t2: now - 600000 } });
  const rows = view.rows();
  expect(rows.map((r: any) => r.address)).toEqual(["t2", "t1", "t3"]);
  expect(Math.round(rows[0].waited / 60000)).toBe(10);
  expect(Math.round(rows[1].waited / 60000)).toBe(2);
  // Without the agents list, its own stamps are the fallback.
  expect(popup({ list: [agent("t1", "blocked")], storage, stamps: "priority" }).view.rows()[0].waited).toBeGreaterThan(98 * 3600000);
});

test("the selected row is filled as selected, not as hovered", () => {
  const { view, cx } = popup({ list: [agent("t1", "blocked"), agent("t2", "blocked")], t: { selected: "sel", hover: "hov" } });
  const find = (node: any, id: string): any => node?.id === id ? node : (node?.children ?? []).map((c: any) => find(c, id)).find(Boolean);
  const root = view.render(cx).node;
  expect(find(root, "ib-t1").bg).toBe("sel");
  expect(find(root, "ib-t2").bg).toBeUndefined();
});

test("a read that hangs is tried again after 10 s, and only the newer one lands", async () => {
  const start = Date.now();
  setSystemTime(start);
  try {
    const answers: ((text: string) => void)[] = [];
    const read = () => new Promise<any>((resolve) => answers.push((text) => resolve({ code: 0, stdout: JSON.stringify({ text }), stderr: "" })));
    const { view, cx, reads, tasks } = popup({ list: [agent("t1", "blocked")], read });
    view.refresh(cx);
    setSystemTime(start + 9000);
    view.refresh(cx);
    expect(reads).toHaveLength(1);
    setSystemTime(start + 11000);
    view.refresh(cx);
    expect(reads).toHaveLength(2);
    // The old read lands late, while the new one is in flight: it changes nothing.
    answers[0]("old");
    await tasks[0];
    expect(view.previews.has("t1")).toBe(false);
    view.refresh(cx);
    expect(reads).toHaveLength(2);
    answers[1]("fresh");
    await tasks[1];
    expect(view.previews.get("t1")).toEqual(["fresh"]);
    view.refresh(cx);
    expect(reads).toHaveLength(3);
  } finally {
    setSystemTime();
  }
});

test("the selected row is scrolled into view when the selection moves, not on every render", () => {
  const { view, cx, revealed } = popup({ list: [agent("t1", "blocked"), agent("t2", "blocked"), agent("t3", "blocked")] });
  const find = (node: any, id: string): any => node?.id === id ? node : (node?.children ?? []).map((c: any) => find(c, id)).find(Boolean);
  expect(find(view.render(cx).node, "inbox-list").calls).toContain("track_scroll");
  view.render(cx);
  expect(revealed).toEqual([0]);
  view.move(-1);
  view.render(cx);
  view.render(cx);
  expect(revealed).toEqual([0, 2]);
});

test("the agents list's stamps count only while the shown layout draws it", () => {
  const now = Date.now();
  const storage = new Map([["since", JSON.stringify({ t1: now - 60000 })]]);
  const stale = { t1: now - 5 * 3600000 };
  const waited = (shown: unknown) => Math.round(popup({ list: [agent("t1", "blocked")], storage, stamps: stale, shown }).view.rows()[0].waited / 60000);
  const agentsBlock = { id: "agents", type: "block", content: { mod: "agents" } };
  expect(waited(withAgents)).toBe(300);
  expect(waited({ id: "root", type: "row", children: [{ id: "bar", type: "block", content: { mod: "terminals-bar" } }] })).toBe(1);
  expect(waited({ id: "root", type: "row", children: [{ ...agentsBlock, hidden: true }] })).toBe(1);
  expect(waited({ id: "root", type: "row", children: [{ id: "side", type: "column", hidden: true, children: [agentsBlock] }] })).toBe(1);
  expect(waited({ id: "root", type: "stack", active: "files", children: [{ id: "files", type: "block", content: { mod: "files" } }, agentsBlock] })).toBe(1);
  expect(waited({ id: "root", type: "stack", active: "agents", children: [{ id: "files", type: "block", content: { mod: "files" } }, agentsBlock] })).toBe(300);
  // As the app does: no active child, or a hidden one, shows the first visible child.
  expect(waited({ id: "root", type: "stack", children: [agentsBlock, { id: "files", type: "block", content: { mod: "files" } }] })).toBe(300);
  expect(waited({ id: "root", type: "stack", active: "files", children: [{ id: "files", type: "block", hidden: true, content: { mod: "files" } }, agentsBlock] })).toBe(300);
  expect(waited(null)).toBe(1);
});
