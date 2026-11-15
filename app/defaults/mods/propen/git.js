// A branch's state and the calls that open a PR (gh) or MR (glab) from it.
// Free text goes as --flag=value, one arg each, never as a bare positional.

import { exec } from "herdr";

async function sh(command, cwd, args, on, timeout) {
  const r = await exec(command, args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// The owner/name (or GitLab group/sub/name) path of a remote URL. Copied from
// prdiff/agent.js's sameRepo (mods can't share files), keeping the case.
function pathOf(remote) {
  remote = remote.trim();
  let path = "";
  if (remote.startsWith("git@")) path = remote.split(":")[1] || "";
  else if (remote.startsWith("ssh://") || remote.startsWith("https://")) path = remote.split("/").slice(3).join("/");
  return path.replace(/\/$/, "").replace(/\.git$/, "");
}

// { root, branch, base, forge, repo, commits (oldest first), dirty }.
export async function readBranch(folder, on) {
  const top = await sh("git", folder, ["rev-parse", "--show-toplevel"], on);
  if (!top.ok) throw new Error(top.err || "This folder isn't a git repository.");
  const root = top.out;
  const head = await sh("git", root, ["rev-parse", "--abbrev-ref", "HEAD"], on);
  if (!head.ok) throw new Error(head.err || "git rev-parse failed.");
  if (head.out === "HEAD") throw new Error("Detached HEAD: check out a branch first.");
  const origin = await sh("git", root, ["remote", "get-url", "origin"], on);
  if (!origin.ok) throw new Error("This repo has no origin remote to open it on.");
  const sym = await sh("git", root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], on);
  const base = sym.ok && sym.out.startsWith("origin/")
    ? sym.out.slice("origin/".length)
    : (await sh("git", root, ["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"], on)).ok ? "main" : "master";
  const log = await sh("git", root, ["log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", `origin/${base}..HEAD`], on);
  if (!log.ok) throw new Error(log.err || `git log origin/${base}..HEAD failed.`);
  const commits = log.out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter((r) => r.trim()).map((r) => {
    const [sha, subject, body = ""] = r.split("\x1f");
    return { sha, subject, body };
  });
  const status = await sh("git", root, ["status", "--porcelain"], on);
  return {
    root, branch: head.out, base, commits,
    forge: /gitlab/i.test(origin.out) ? "glab" : "gh",
    repo: pathOf(origin.out),
    dirty: status.out ? status.out.split("\n").length : 0,
  };
}

// A title and body from the commits: one commit is its own; several list
// their subjects under the branch's name.
export function draft(branch, commits) {
  if (commits.length === 1) return { title: commits[0].subject, body: (commits[0].body ?? "").trim() };
  const words = branch.replace(/^\d+-/, "").replace(/[-_/]/g, " ");
  return { title: words.charAt(0).toUpperCase() + words.slice(1), body: commits.map((c) => "- " + c.subject).join("\n") };
}

// The branch's open PR or MR, { num, url, title }, else null (a CLI that
// fails here fails again, with its message, on create).
export async function existing(info, on) {
  const gl = info.forge === "glab";
  const args = gl
    ? ["mr", "list", `--source-branch=${info.branch}`, "--output", "json"]
    : ["pr", "list", "--head", info.branch, "--state", "open", "--json", "number,url,title"];
  const r = await sh(info.forge, info.root, args, on, 30000);
  if (!r.ok) return null;
  let first;
  try { first = JSON.parse(r.out || "[]")[0]; } catch { return null; }
  if (!first) return null;
  return gl ? { num: first.iid, url: first.web_url, title: first.title } : { num: first.number, url: first.url, title: first.title };
}

// Pushes the branch, then opens the PR or MR; returns its URL.
export async function createPr(info, on, { title, body, base, draft }) {
  const push = await sh("git", info.root, ["push", "-u", "origin", info.branch], on, 120000);
  if (!push.ok) throw new Error(push.err || "git push failed.");
  const args = info.forge === "glab"
    ? ["mr", "create", `--title=${title}`, `--description=${body}`, `--target-branch=${base}`, `--source-branch=${info.branch}`, "--yes"]
    : ["pr", "create", `--title=${title}`, `--body=${body}`, `--base=${base}`, `--head=${info.branch}`];
  if (draft) args.push("--draft");
  const r = await sh(info.forge, info.root, args, on, 120000);
  if (!r.ok) throw new Error(r.err || `${info.forge} create failed.`);
  const url = r.out.split("\n").map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop();
  if (!url) throw new Error(`${info.forge} didn't print the new ${info.forge === "glab" ? "merge" : "pull"} request's URL.`);
  return url;
}
