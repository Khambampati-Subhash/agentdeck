import { test, expect } from "bun:test";
import { load, fns } from "./mod-harness";

const source = await load("prdiff", "PrDiff");

test("sameRepo reads ssh, https and nested GitLab paths", () => {
  const { sameRepo } = fns(source, ["sameRepo"]);
  expect(sameRepo("git@github.com:O/R.git\n", "o/r")).toBe(true);
  expect(sameRepo("https://gitlab.example.com/g/sub/r/", "g/sub/r")).toBe(true);
  expect(sameRepo("ssh://git@github.com/o/r2.git", "o/r")).toBe(false);
});

test("agentsOn keeps only agents on the branch in a checkout of the same repo", async () => {
  const agents = [
    { address: "t1", pane: "p1", space: "s1", tab_name: "Tab 1", program: { name: "Claude" } },
    { address: "t2", pane: "p2", space: "s1", tab_name: "Tab 2", program: { name: "Claude" } },
    { address: "vps/t3", pane: "vps/p3", space: "s2", tab_name: "Tab 3", program: { name: "Claude" } },
  ];
  const panes = [
    { pane: "p1", branch: "fix", cwd: "/a" },
    { pane: "p2", branch: "fix", cwd: "/b" },
    { pane: "vps/p3", branch: "fix", cwd: "/srv/r" },
  ];
  const spaces = [
    { id: "s1", machine: null },
    { id: "s2", machine: "vps" },
  ];

  let execCalls: any[] = [];
  const exec = async (cmd: string, args: string[], opts?: any) => {
    execCalls.push({ cmd, args, opts });
    if (cmd === "git" && args[0] === "remote" && opts?.cwd === "/a") {
      return { code: 0, stdout: "git@github.com:o/r.git\n", stderr: "" };
    }
    if (cmd === "git" && args[0] === "remote" && opts?.cwd === "/b") {
      return { code: 0, stdout: "git@github.com:other/r.git\n", stderr: "" };
    }
    if (cmd === "git" && args[0] === "remote" && opts?.cwd === "/srv/r" && opts?.on === "vps") {
      return { code: 0, stdout: "https://github.com/o/r\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unknown" };
  };

  const { agentsOn } = fns(source, ["agentsOn"], { agents: () => agents, panes: () => panes, spaces: () => spaces, exec });
  const result = await agentsOn("fix", "o/r");

  expect(result.length).toBe(2);
  expect(result[0].address).toBe("t1");
  expect(result[0].name).toBe("Tab 1 · Claude");
  expect(result[0].cwd).toBe("/a");
  expect(result[0].on).toBe(null);
  expect(result[1].address).toBe("vps/t3");
  expect(result[1].name).toBe("Tab 3 · Claude");
  expect(result[1].cwd).toBe("/srv/r");
  expect(result[1].on).toBe("vps");

  // Verify that /srv/r exec had on: "vps"
  const vpsExec = execCalls.find(c => c.opts?.cwd === "/srv/r");
  expect(vpsExec?.opts?.on).toBe("vps");
});

test("tell sends flag-looking text after --", async () => {
  const hcCalls: any[] = [];
  const hc = async (args: string[]) => {
    hcCalls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };

  const { tell } = fns(source, ["tell"], { hc });
  await tell("t1", "--force $(rm -rf ~)");

  expect(hcCalls.length).toBe(1);
  expect(hcCalls[0]).toEqual(["send", "t1", "--", "--force $(rm -rf ~)"]);
});

test("tell surfaces hc's error", async () => {
  const hc = async (args: string[]) => {
    return { code: 1, stdout: "", stderr: "no terminal t9" };
  };

  const { tell } = fns(source, ["tell"], { hc });

  await expect(tell("t9", "hello")).rejects.toThrow("no terminal t9");
});

test("task texts name the PR the forge's way", () => {
  const { reviewTask, checkTask } = fns(source, ["reviewTask", "checkTask"]);

  const reviewResult = reviewTask(
    { pr: { num: 7, title: "Fix it", branch: "fix" }, forge: "gh" },
    { author: "jon", body: "Log this?", path: "src/a.rs", line: 2 }
  );
  expect(reviewResult).toBe(
    "Review comment on #7 (Fix it) by @jon on src/a.rs:2:\n\nLog this?\n\nAddress it on branch fix, commit, and push. Reply with what you changed."
  );

  const checkResult = checkTask(
    { pr: { num: 3, title: "Foo", branch: "bar" }, forge: "glab" },
    { name: "test" },
    "error on line 10"
  );
  expect(checkResult.startsWith('CI check "test" failed on !3 ')).toBe(true);
  expect(checkResult).toContain("branch bar");
});

test("tail strips colour and keeps the end", () => {
  const { tail } = fns(source, ["tail"]);

  expect(tail("\x1b[31ma\x1b[0m\r\nb\nc", 2)).toBe("b\nc");
  expect(tail("x".repeat(9000), 120, 8000).length).toBe(8000);
});
