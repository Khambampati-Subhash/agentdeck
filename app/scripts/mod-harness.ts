import { readFile } from "node:fs/promises";

// A mod's main.js with its own ./modules inlined, imports and exports dropped.
export async function load(name: string, cls: string) {
  const read = (file: string) => readFile(new URL(`../defaults/mods/${name}/${file}`, import.meta.url), "utf8");
  let source = await read("main.js");
  for (const [line, file] of [...source.matchAll(/^import .* from "\.\/(.+)";\n/gm)]) {
    source = source.replace(line, (await read(file)).replace(/^import .*;\n/gm, "").replace(/^export /gm, ""));
  }
  return source.replace(/^import .*;\n/gm, "").replace(`export default class ${cls}`, `class ${cls}`);
}

// Execute conditional builders and retain text, without native GPUI layout.
// Like the runtime, a virtual list's rows can't register handlers: the list's
// on_item_click covers them.
let inRows = false;
const HANDLERS = ["on_click", "on_mouse_down", "on_mouse_up", "on_hover", "on_mouse_move", "on_key_down", "on_scroll_wheel", "on_size_change"];
export function element(kind = "div") {
  const node = { kind, id: "", children: [] as any[], click: null as any, key: null as any, item: null as any, tooltip: null as any };
  const el: any = new Proxy(node, { get: (_, method) => {
    if (method === "node") return node;
    return (...args: any[]) => {
      if (inRows && HANDLERS.includes(String(method))) throw new TypeError(`\`${String(method)}\` cannot be registered from a virtual list's item renderer`);
      if (method === "id") node.id = args[0];
      if (method === "tooltip") node.tooltip = args[0];
      if (method === "on_click") node.click = args[0];
      if (method === "on_key_down") node.key = args[0];
      if (method === "on_item_click") node.item = args[0];
      if (method === "child") node.children.push(args[0]?.node ?? args[0]);
      if (method === "children") node.children.push(...args[0].map((child: any) => child?.node ?? child));
      if (method === "when" && args[0]) args[1](el);
      return el;
    };
  } });
  return el;
}
export const textOf = (node: any): string => typeof node === "string" ? node : (node?.children ?? []).map(textOf).join(" ");
export const findId = (node: any, id: string): any => node?.id === id ? node : (node?.children ?? []).map((c: any) => findId(c, id)).find(Boolean);
export const findList = (node: any, id: string): any => node?.kind === "list" && node.id === id ? node : (node?.children ?? []).map((c: any) => findList(c, id)).find(Boolean);

export type Reply = { code: number; stdout: string; stderr?: string };

function buildGlobals(replies: (command: string, args: string[]) => Reply, props: any, folder: string, extra: Record<string, any>, runs: any[], hcCalls: any[], notes: any[], timers: any[]) {
  const base: any = {
    View: class {}, div: () => element(), v_flex: () => element("v"), h_flex: () => element("h"),
    Input: { new: () => element() }, InputState: { new: () => ({ on() {}, value: () => "LGTM", set_value() {}, set_rows() {}, focus() {} }) },
    Scrollbar: { vertical: () => element() },
    v_virtual_list: (id: string, count: number, _h: number, key: (i: number) => string, rows: (r: any) => any[]) => {
      const list = element("list");
      list.id(id);
      inRows = true;
      try { list.children(rows({ start: 0, end: count })); } finally { inRows = false; }
      list.node.keys = Array.from({ length: count }, (_, i) => key(i));
      return list;
    },
    theme: () => ({}), settings: () => ({}), props: () => props, notify: (n: any) => notes.push(n), closeOverlay() {},
    spaces: () => [{ id: "s1", active: true, folder, machine: null }], panes: () => [], focused: () => ({ pane: null, cwd: null }),
    openOverlay: (o: any) => { throw new Error("openOverlay not mocked"); }, watchFolder: async () => { throw new Error("not watched in tests"); },
    localStorage: { getItem: () => null, setItem: () => {} },
    exec: async (command: string, args: string[], options: any) => { throw new Error("exec not mocked"); },
    run: (name: string, args: string[]) => runs.push([name, args]),
    hc: (args: string[]) => { hcCalls.push(args); return { stderr: "", ...replies("hc", args) }; },
    agents: () => [],
    knownAgents: async () => [],
    TextareaState: { new: (o?: any) => ({ on() {}, value: () => o?.value ?? "", set_value() {}, set_rows() {}, focus() {} }) },
    Textarea: { new: () => element() },
    home: () => "/home/user",
  };
  return { ...base, ...extra };
}

export function harness(source: string, cls: string, replies: (command: string, args: string[]) => Reply, props: any = {}, folder = "/repo", extra: Record<string, any> = {}) {
  const calls: any[] = [], overlays: any[] = [], store = new Map<string, string>(), runs: any[] = [], hcCalls: any[] = [], notes: any[] = [], timers: any[] = [];
  const tasks: Promise<unknown>[] = [];
  const cx: any = {
    focus_handle: () => ({ focus() {} }),
    timer: {
      every(ms: number, f: () => void) { timers.push({ ms, f }); },
      after() {},
    },
    notify() {},
    stop_propagation() {},
    spawn: (f: (cx: any) => Promise<unknown>) => { tasks.push(f(cx)); },
  };
  const globals: any = {
    ...buildGlobals(replies, props, folder, extra, runs, hcCalls, notes, timers),
    openOverlay: (o: any) => overlays.push(o),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    exec: async (command: string, args: string[], options: any) => { calls.push({ command, args, ...options }); return { stderr: "", ...replies(command, args) }; },
  };
  if (extra.spaces) globals.spaces = extra.spaces;
  if (extra.panes) globals.panes = extra.panes;
  const View = new Function(...Object.keys(globals), `${source}; return ${cls};`)(...Object.values(globals));
  const view = new View();
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { view, cx, calls, overlays, store, settle, runs, hcCalls, notes, timers };
}

export function fns(source: string, names: string[], extra: Record<string, any> = {}) {
  const runs: any[] = [], hcCalls: any[] = [], notes: any[] = [], timers: any[] = [];
  const replies = () => ({ code: 0, stdout: "" });
  const globals = buildGlobals(replies, {}, "/repo", extra, runs, hcCalls, notes, timers);
  const result = new Function(...Object.keys(globals), `${source}; return { ${names.join(", ")} };`)(...Object.values(globals));
  return result;
}
