// One pull or merge request, from the person's own CLIs: gh for GitHub,
// glab for GitLab. Each takes the window's props ({ pr, forge, repo, pid,
// cwd, on }) and names the repo itself, so it works from any folder.

import { exec } from "herdr";

const name = (u) => String((u && typeof u === "object" ? u.login ?? u.username ?? u.name ?? u.slug ?? "" : u) ?? "");
const hostOf = (url) => /^https?:\/\/([^/]+)\//.exec(url ?? "")?.[1] ?? null;

// The repo flag: gh takes [HOST/]OWNER/REPO, glab the project's URL (any host).
function repoFlag(p) {
  if (p.forge === "glab") return ["-R", (p.pr.url ?? "").replace(/\/-\/merge_requests\/\d+.*$/, "") || p.repo];
  const host = hostOf(p.pr.url);
  return ["--repo", host && host !== "github.com" ? `${host}/${p.repo}` : p.repo];
}

async function cli(p, args) {
  const forge = p.forge === "glab" ? "glab" : "gh";
  const r = await exec(forge, args, { cwd: p.cwd ?? undefined, on: p.on ?? undefined, timeout: 60000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `${forge} failed`).trim());
  return r.stdout;
}
const json = async (p, args) => JSON.parse((await cli(p, args)) || "null");

const num = (p) => String(p.pr.num);

export const diffText = (p) => cli(p, [p.forge === "glab" ? "mr" : "pr", "diff", num(p), ...repoFlag(p), "--color", "never"]);
export const comment = (p, body) => cli(p, p.forge === "glab" ? ["mr", "note", num(p), ...repoFlag(p), "-m", body] : ["pr", "comment", num(p), ...repoFlag(p), "--body", body]);
export const openInBrowser = (p) => cli(p, [p.forge === "glab" ? "mr" : "pr", "view", num(p), ...repoFlag(p), "--web"]);

const byTime = (a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""));

const GH_FIELDS = "title,headRefName,baseRefName,reviewDecision,isDraft,author,assignees,reviewRequests,latestReviews,reviews,comments,commits";

async function github(p) {
  const v = await json(p, ["pr", "view", num(p), ...repoFlag(p), "--json", GH_FIELDS]);
  const reviewers = (v.latestReviews ?? []).map((r) => ({ login: name(r.author), state: r.state }));
  for (const r of v.reviewRequests ?? []) if (!reviewers.some((x) => x.login === name(r))) reviewers.push({ login: name(r), state: "PENDING" });
  const comments = [
    ...(v.comments ?? []).map((c) => ({ author: name(c.author), body: c.body ?? "", at: c.createdAt, state: null })),
    ...(v.reviews ?? []).filter((r) => r.body?.trim()).map((r) => ({ author: name(r.author), body: r.body, at: r.submittedAt, state: r.state === "COMMENTED" ? null : r.state })),
  ].sort(byTime);
  return {
    pr: { title: v.title, branch: v.headRefName, base: v.baseRefName, decision: v.reviewDecision ?? "", draft: Boolean(v.isDraft) },
    people: { author: name(v.author), assignees: (v.assignees ?? []).map(name), reviewers },
    commits: (v.commits ?? []).map((c) => ({ sha: String(c.oid ?? "").slice(0, 7), title: c.messageHeadline ?? "", author: c.authors?.[0]?.login || c.authors?.[0]?.name || "", at: c.committedDate })),
    comments, errors: [],
  };
}

// Four asks of the project's API; a section that fails leaves the rest.
async function gitlab(p) {
  const host = hostOf(p.pr.url), base = `projects/${p.pid ?? encodeURIComponent(p.repo)}/merge_requests/${num(p)}`;
  const api = (path) => json(p, ["api", path, ...(host && host !== "gitlab.com" ? ["--hostname", host] : [])]);
  const [mr, approvals, commits, notes] = await Promise.allSettled([
    api(base), api(`${base}/approvals`), api(`${base}/commits?per_page=100`), api(`${base}/notes?sort=asc&order_by=created_at&per_page=100`),
  ]);
  const ok = (r, fallback) => (r.status === "fulfilled" && r.value ? r.value : fallback);
  const m = ok(mr, {}), approved = (ok(approvals, {}).approved_by ?? []).map((a) => name(a.user));
  const reviewers = (m.reviewers ?? []).map((u) => ({ login: name(u), state: approved.includes(name(u)) ? "APPROVED" : "PENDING" }));
  for (const a of approved) if (!reviewers.some((r) => r.login === a)) reviewers.push({ login: a, state: "APPROVED" });
  return {
    pr: mr.status === "fulfilled" ? { title: m.title, branch: m.source_branch, base: m.target_branch, decision: m.detailed_merge_status ?? "", draft: Boolean(m.draft) } : {},
    people: { author: name(m.author), assignees: (m.assignees ?? []).map(name), reviewers },
    commits: ok(commits, []).map((c) => ({ sha: c.short_id ?? String(c.id ?? "").slice(0, 7), title: c.title ?? "", author: c.author_name ?? "", at: c.created_at })),
    comments: ok(notes, []).filter((n) => !n.system).map((n) => ({ author: name(n.author), body: n.body ?? "", at: n.created_at, state: null })).sort(byTime),
    errors: [mr, approvals, commits, notes].filter((r) => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason)),
  };
}

export const details = (p) => (p.forge === "glab" ? gitlab(p) : github(p));
