import { test, expect } from "bun:test";
import { inboxRows, stamp, trimPreview, keepSelection } from "../defaults/mods/inbox/rows.js";

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
  const agents = [agent("t1", "blocked"), agent("t2", "blocked"), agent("t9", "idle")];
  expect(stamp({ t1: 5, t9: 1 }, agents, 10)).toEqual({ t1: 5, t2: 10 });
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

function popup({ list = [] as any[], read = async (_args: string[]) => ({ code: 0, stdout: JSON.stringify({ text: "screen", complete: true, how: "grid" }), stderr: "" }), storage = new Map<string, string>() } = {}) {
  const commands: unknown[][] = [];
  const reads: string[][] = [];
  const closed: unknown[] = [];
  const tasks: Promise<unknown>[] = [];
  const localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) };
  const globals: Record<string, unknown> = {
    View: class {}, div: el, svg: el, image: el, v_flex: el, h_flex: el,
    agents: () => list, terminals: () => [], theme: () => ({}), settings: () => ({}),
    props: () => ({ overlay: "ov1" }), closeOverlay: (id: unknown) => closed.push(id),
    run: (...args: unknown[]) => commands.push(args),
    hc: (args: string[]) => { reads.push(args); return read(args); },
    localStorage, ...rowsModule,
  };
  const Inbox = new Function(...Object.keys(globals), mainSource)(...Object.values(globals));
  const cx: any = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), timer: { every() {}, after() {} }, spawn: (f: (cx: any) => Promise<unknown>) => tasks.push(f(cx)) };
  const view = new Inbox();
  view.init({}, cx);
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { view, cx, commands, reads, closed, settle, storage };
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
