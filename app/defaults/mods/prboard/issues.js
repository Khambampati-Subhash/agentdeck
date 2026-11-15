// The board's open issues, from the same CLIs as its pull requests (forge.js):
// the folder's, or every repo's that are assigned to or opened by the person.
// Every row comes back in one shape, whichever forge and scope it's from.

import { exec, spaces } from "herdr";
import { ask, login, forgeLabel } from "./forge.js";

const issueRepo = (url) => /^https?:\/\/[^/]+\/(.+?)\/(?:-\/)?issues\/\d+/.exec(url ?? "")?.[1] ?? "";
const ofUser = (users, me) => Boolean(me) && Array.isArray(users) && users.some((u) => login(u) === me);
const labelOf = (l) => String((l && typeof l === "object" ? l.name ?? "" : l) ?? "");

function ghIssue(i, me) {
  return {
    forge: "gh", num: i.number, title: i.title ?? "Untitled", repo: i.repository?.nameWithOwner ?? issueRepo(i.url), pid: null,
    labels: (i.labels ?? []).map(labelOf).filter(Boolean), assigned: ofUser(i.assignees, me), mine: Boolean(me) && login(i.author) === me,
    url: i.url, at: i.updatedAt,
  };
}

function glIssue(i, me) {
  return {
    forge: "glab", num: i.iid, title: i.title ?? "Untitled", repo: i.references?.full?.replace(/#\d+$/, "") ?? issueRepo(i.web_url), pid: i.project_id ?? null,
    labels: (i.labels ?? []).map(labelOf).filter(Boolean), assigned: ofUser(i.assignees, me), mine: Boolean(me) && login(i.author) === me,
    url: i.web_url, at: i.updated_at,
  };
}

const GH_ISSUES = ["issue", "list", "--state", "open", "--limit", "60", "--json", "number,title,author,assignees,labels,updatedAt,url"];
const GH_ISSUE_SEARCH = ["search", "issues", "--state", "open", "--limit", "50", "--json", "number,title,repository,url,updatedAt,author,assignees,labels"];
const GL_ISSUES = ["issue", "list", "--per-page", "60", "--output", "json"];
const GL_ISSUES_ALL = "issues?state=opened&per_page=50&scope=";

// The folder's open issues.
export async function listIssuesRepo(forge, me, opts) {
  if (forge === "gh") return (await ask("gh", GH_ISSUES, opts) ?? []).map((i) => ghIssue(i, me));
  return (await ask("glab", GL_ISSUES, opts) ?? []).map((i) => glIssue(i, me));
}

// Every repo's: assigned and opened, merged by URL like listAll.
export async function listIssuesAll(forge, me, opts) {
  const asks = forge === "gh"
    ? [["assigned", [...GH_ISSUE_SEARCH, "--assignee", "@me"]], ["mine", [...GH_ISSUE_SEARCH, "--author", "@me"]]]
    : [["assigned", ["api", `${GL_ISSUES_ALL}assigned_to_me`]], ["mine", ["api", `${GL_ISSUES_ALL}created_by_me`]]];
  const found = await Promise.all(asks.map(async ([why, args]) => [why, await ask(forge, args, opts) ?? []]));
  const rows = new Map();
  for (const [why, list] of found) {
    for (const raw of list) {
      const row = forge === "gh" ? ghIssue(raw, me) : glIssue(raw, me);
      const known = rows.get(row.url) ?? row;
      known[why] = true;
      rows.set(row.url, known);
    }
  }
  return [...rows.values()];
}

// Opens the issue in the browser, on this machine: gh takes [HOST/]OWNER/REPO,
// glab the project's URL.
export async function openIssue(issue) {
  const host = /^https?:\/\/([^/]+)\//.exec(issue.url ?? "")?.[1];
  const args = issue.forge === "glab"
    ? ["issue", "view", String(issue.num), "-R", (issue.url ?? "").replace(/\/-\/issues\/\d+.*$/, "") || issue.repo, "--web"]
    : ["issue", "view", String(issue.num), "--repo", host && host !== "github.com" ? `${host}/${issue.repo}` : issue.repo, "--web"];
  const r = await exec(issue.forge, args, { timeout: 15000 });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `${issue.forge} failed`);
}

// The issue's description, named by its repo so any folder will do.
export async function issueBody(forge, row, opts) {
  const host = /^https?:\/\/([^/]+)\//.exec(row.url ?? "")?.[1];
  if (forge === "glab") {
    const off = host && host !== "gitlab.com" ? ["--hostname", host] : [];
    return (await ask("glab", ["api", `projects/${row.pid ?? encodeURIComponent(row.repo)}/issues/${row.num}`, ...off], opts))?.description ?? "";
  }
  const repo = host && host !== "github.com" ? `${host}/${row.repo}` : row.repo;
  return (await ask("gh", ["issue", "view", String(row.num), "--repo", repo, "--json", "body"], opts))?.body ?? "";
}

// `<num>-<slug>`: the title in lowercase a-z0-9 words, at most 40 characters,
// cut between words.
export function branchFor(row) {
  let slug = String(row.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > 40) {
    const cut = slug.slice(0, 41).lastIndexOf("-");
    slug = cut > 0 ? slug.slice(0, cut) : slug.slice(0, 40);
  }
  return slug ? `${row.num}-${slug}` : String(row.num);
}

// The agent's first message. Issues are #N on both forges.
export function issueTask(row, body) {
  const ref = `#${row.num}`;
  return `Work on ${forgeLabel(row.forge)} issue ${ref} in ${row.repo}: ${row.title}\n${row.url}\n\n${body.trim().slice(0, 6000) || "(no description)"}\n\nWork on this branch and commit as you go. Don't push or open a pull request unless asked.`;
}

// Whether an origin URL is the repo's. A copy of prdiff/agent.js's sameRepo,
// because mods can't share files: keep the two the same.
export function sameRepo(remote, repo) {
  remote = remote.trim();
  let path = "";
  if (remote.startsWith("git@")) path = remote.split(":")[1] || "";
  else if (remote.startsWith("ssh://") || remote.startsWith("https://")) path = remote.split("/").slice(3).join("/");
  path = path.replace(/\.git$/, "").replace(/\/$/, "");
  return path.toLowerCase() === repo.toLowerCase();
}

// A local space's folder cloned from the repo: the first whose origin is it.
export async function findCheckout(repo) {
  const seen = new Set();
  for (const s of spaces()) {
    if (s.machine !== null || !s.folder || seen.has(s.folder)) continue;
    seen.add(s.folder);
    const r = await exec("git", ["remote", "get-url", "origin"], { cwd: s.folder, timeout: 15000 });
    if (r.code === 0 && sameRepo(r.stdout, repo)) return { folder: s.folder, on: null };
  }
  return null;
}
