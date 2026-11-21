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
