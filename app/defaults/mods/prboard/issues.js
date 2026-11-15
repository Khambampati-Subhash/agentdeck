// The board's open issues, from the same CLIs as its pull requests (forge.js):
// the folder's, or every repo's that are assigned to or opened by the person.
// Every row comes back in one shape, whichever forge and scope it's from.

import { exec } from "herdr";
import { ask, login } from "./forge.js";

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
