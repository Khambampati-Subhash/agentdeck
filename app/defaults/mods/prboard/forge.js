// The board's lists, from the person's own CLIs: gh for GitHub, glab for
// GitLab. "repo" is the folder's repo; "all" is every repo they're part of.
// Every row comes back in one shape, whichever forge and scope it's from.

import { exec } from "herdr";

export const FORGES = [{ id: "gh", label: "GitHub" }, { id: "glab", label: "GitLab" }];
export const forgeLabel = (id) => FORGES.find((f) => f.id === id)?.label ?? id;

// GitLab when origin says so (gitlab.com or a host named gitlab), else GitHub.
export const forgeOf = (remote) => /gitlab/i.test(remote) ? "glab" : "gh";

export const login = (u) => String((u && typeof u === "object" ? u.login ?? u.username ?? u.name ?? "" : u) ?? "").toLowerCase();

// The CLI's own words, or how to fix the usual ones.
export function problem(forge, e) {
  const text = String(e?.message ?? e).trim();
  if (/cannot start|not found|no such file|ENOENT/i.test(text)) return `${forge} isn't installed or isn't on your PATH.`;
  if (/401|unauthori[sz]ed|auth login|not logged|authenticat/i.test(text)) return `Not signed in to ${forgeLabel(forge)}: run \`${forge} auth login\` in a terminal, then refresh.`;
  return text || `${forge} failed`;
}

async function run(forge, args, opts) {
  const r = await exec(forge, args, { timeout: 60000, ...opts });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `${forge} failed`);
  return JSON.parse(r.stdout || "null");
}

// The signed-in login, remembered per forge and machine.
export async function me(forge, opts) {
  const store = `prboard.me.${forge}${opts.on ? "@" + opts.on : ""}`;
  const known = localStorage.getItem(store);
  if (known) return known;
  const who = login(await run(forge, ["api", "user"], { ...opts, timeout: 15000 }));
  if (who) localStorage.setItem(store, who);
  return who || null;
}

const repoOfUrl = (url) => /^https?:\/\/[^/]+\/(.+?)\/(?:-\/merge_requests|pull)\/\d+/.exec(url ?? "")?.[1] ?? "";

function fromGitHub(p, me) {
  const has = (users) => Boolean(me) && Array.isArray(users) && users.some((u) => login(u) === me);
  return {
    forge: "gh", num: p.number, title: p.title ?? "Untitled", repo: p.repository?.nameWithOwner ?? repoOfUrl(p.url), pid: null,
    branch: p.headRefName ?? null, base: p.baseRefName ?? null, add: p.additions ?? 0, del: p.deletions ?? 0, files: p.changedFiles ?? 0,
    draft: Boolean(p.isDraft), decision: p.reviewDecision ?? "",
    review: has(p.reviewRequests), assigned: has(p.assignees), mine: Boolean(me) && login(p.author) === me,
    url: p.url, at: p.updatedAt,
  };
}

function fromGitLab(m, me) {
  const has = (users) => Boolean(me) && Array.isArray(users) && users.some((u) => login(u) === me);
  return {
    forge: "glab", num: m.iid, title: m.title ?? "Untitled", repo: m.references?.full?.replace(/!\d+$/, "") ?? repoOfUrl(m.web_url), pid: m.project_id ?? null,
    branch: m.source_branch ?? null, base: m.target_branch ?? null, add: 0, del: 0, files: 0,
    draft: Boolean(m.draft ?? m.work_in_progress) || /^(draft:|\[draft\]|wip:)/i.test(m.title ?? ""),
    decision: m.detailed_merge_status ?? "",
    review: has(m.reviewers), assigned: has(m.assignees), mine: Boolean(me) && login(m.author) === me,
    url: m.web_url, at: m.updated_at,
  };
}

const GH_REPO = ["pr", "list", "--state", "open", "--limit", "60", "--json", "number,title,author,headRefName,baseRefName,additions,deletions,changedFiles,isDraft,reviewDecision,reviewRequests,assignees,updatedAt,url"];
const GH_SEARCH = ["search", "prs", "--state", "open", "--limit", "50", "--json", "number,title,repository,url,updatedAt,isDraft,author,assignees"];
const GL_REPO = ["mr", "list", "--per-page", "60", "--output", "json"];
const GL_ALL = "merge_requests?state=opened&per_page=50&scope=";

// The folder's open PRs or MRs.
export async function listRepo(forge, me, opts) {
  if (forge === "gh") return (await run("gh", GH_REPO, opts) ?? []).map((p) => fromGitHub(p, me));
  return (await run("glab", GL_REPO, opts) ?? []).map((m) => fromGitLab(m, me));
}

// Every repo's: one ask per column, merged, each row marked by the asks that found it.
export async function listAll(forge, me, opts) {
  const asks = forge === "gh"
    ? [["review", [...GH_SEARCH, "--review-requested", "@me"]], ["assigned", [...GH_SEARCH, "--assignee", "@me"]], ["mine", [...GH_SEARCH, "--author", "@me"]]]
    : [["review", ["api", `${GL_ALL}all&reviewer_username=${encodeURIComponent(me ?? "")}`]], ["assigned", ["api", `${GL_ALL}assigned_to_me`]], ["mine", ["api", `${GL_ALL}created_by_me`]]];
  const found = await Promise.all(asks.filter(([why]) => why !== "review" || forge === "gh" || me).map(async ([why, args]) => [why, await run(forge, args, opts) ?? []]));
  const rows = new Map();
  for (const [why, list] of found) {
    for (const raw of list) {
      const row = forge === "gh" ? fromGitHub(raw, me) : fromGitLab(raw, me);
      const known = rows.get(row.url) ?? row;
      known[why] = true;
      rows.set(row.url, known);
    }
  }
  return [...rows.values()];
}
