// One pull or merge request, from the person's own CLIs: gh for GitHub,
// glab for GitLab. Each takes the window's props ({ pr, forge, repo, pid,
// cwd, on }) and names the repo itself, so it works from any folder.

import { exec } from "herdr";
import { gitlabDiff } from "./diff.js";

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

// `gh api` / `glab api` on the PR's own host (GitHub Enterprise, self-hosted GitLab).
function hostFlag(p) {
  const host = hostOf(p.pr.url);
  return host && host !== (p.forge === "glab" ? "gitlab.com" : "github.com") ? ["--hostname", host] : [];
}
const api = (p, path, extra = []) => json(p, ["api", path, ...extra, ...hostFlag(p)]);
const ghRepo = (p) => `repos/${p.repo}`;
const glProject = (p) => `projects/${p.pid ?? encodeURIComponent(p.repo)}`;

// A commit's own diff, as text splitDiff reads.
export async function commitDiff(p, sha) {
  if (p.forge === "glab") return gitlabDiff(await api(p, `${glProject(p)}/repository/commits/${sha}/diff?per_page=100`));
  return cli(p, ["api", "-H", "Accept: application/vnd.github.diff", `${ghRepo(p)}/commits/${sha}`, ...hostFlag(p)]);
}

// A comment on one diff row of `file` (from splitDiff): a deleted line is on
// the old side, anything else on the new. `refs` is what details() returned.
export function lineComment(p, refs, file, row, body) {
  if (p.forge === "glab") {
    const at = [];
    if (row.old != null) at.push("-F", `position[old_line]=${row.old}`);
    if (row.new != null) at.push("-F", `position[new_line]=${row.new}`);
    return cli(p, ["api", "-X", "POST", `${glProject(p)}/merge_requests/${num(p)}/discussions`, "-f", `body=${body}`, "-f", "position[position_type]=text",
      "-f", `position[base_sha]=${refs.base ?? ""}`, "-f", `position[start_sha]=${refs.start ?? ""}`, "-f", `position[head_sha]=${refs.head ?? ""}`,
      "-f", `position[old_path]=${file.old}`, "-f", `position[new_path]=${file.path}`, ...at, ...hostFlag(p)]);
  }
  const left = row.kind === "-";
  return cli(p, ["api", "-X", "POST", `${ghRepo(p)}/pulls/${num(p)}/comments`, "-f", `body=${body}`, "-f", `commit_id=${refs.head ?? ""}`,
    "-f", `path=${left ? file.old : file.path}`, "-F", `line=${left ? row.old : row.new}`, "-f", `side=${left ? "LEFT" : "RIGHT"}`, ...hostFlag(p)]);
}

export const diffText = (p) => cli(p, [p.forge === "glab" ? "mr" : "pr", "diff", num(p), ...repoFlag(p), "--color", "never"]);
export const comment = (p, body) => cli(p, p.forge === "glab" ? ["mr", "note", num(p), ...repoFlag(p), "-m", body] : ["pr", "comment", num(p), ...repoFlag(p), "--body", body]);
export const openInBrowser = (p) => cli(p, [p.forge === "glab" ? "mr" : "pr", "view", num(p), ...repoFlag(p), "--web"]);

const byTime = (a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""));

const GH_FIELDS = "title,headRefName,headRefOid,baseRefName,reviewDecision,isDraft,author,assignees,reviewRequests,latestReviews,reviews,comments,commits";

async function github(p) {
  const [view, inline] = await Promise.allSettled([json(p, ["pr", "view", num(p), ...repoFlag(p), "--json", GH_FIELDS]), api(p, `${ghRepo(p)}/pulls/${num(p)}/comments?per_page=100`)]);
  if (view.status === "rejected") throw view.reason;
  const v = view.value;
  const reviewers = (v.latestReviews ?? []).map((r) => ({ login: name(r.author), state: r.state }));
  for (const r of v.reviewRequests ?? []) if (!reviewers.some((x) => x.login === name(r))) reviewers.push({ login: name(r), state: "PENDING" });
  const comments = [
    ...(v.comments ?? []).map((c) => ({ author: name(c.author), body: c.body ?? "", at: c.createdAt, state: null })),
    ...(v.reviews ?? []).filter((r) => r.body?.trim()).map((r) => ({ author: name(r.author), body: r.body, at: r.submittedAt, state: r.state === "COMMENTED" ? null : r.state })),
    ...(inline.status === "fulfilled" ? inline.value ?? [] : []).map((c) => ({ author: name(c.user), body: c.body ?? "", at: c.created_at, state: null, path: c.path, line: c.line ?? c.original_line, side: c.side ?? "RIGHT" })),
  ].sort(byTime);
  return {
    pr: { title: v.title, branch: v.headRefName, base: v.baseRefName, decision: v.reviewDecision ?? "", draft: Boolean(v.isDraft) },
    people: { author: name(v.author), assignees: (v.assignees ?? []).map(name), reviewers },
    refs: { head: v.headRefOid },
    commits: (v.commits ?? []).map((c) => ({ sha: String(c.oid ?? ""), title: c.messageHeadline ?? "", author: c.authors?.[0]?.login || c.authors?.[0]?.name || "", at: c.committedDate })),
    comments, errors: inline.status === "rejected" ? [String(inline.reason?.message ?? inline.reason)] : [],
  };
}

// Four asks of the project's API; a section that fails leaves the rest.
async function gitlab(p) {
  const base = `${glProject(p)}/merge_requests/${num(p)}`;
  const [mr, approvals, commits, notes] = await Promise.allSettled([
    api(p, base), api(p, `${base}/approvals`), api(p, `${base}/commits?per_page=100`), api(p, `${base}/notes?sort=asc&order_by=created_at&per_page=100`),
  ]);
  const ok = (r, fallback) => (r.status === "fulfilled" && r.value ? r.value : fallback);
  const m = ok(mr, {}), approved = (ok(approvals, {}).approved_by ?? []).map((a) => name(a.user));
  const reviewers = (m.reviewers ?? []).map((u) => ({ login: name(u), state: approved.includes(name(u)) ? "APPROVED" : "PENDING" }));
  for (const a of approved) if (!reviewers.some((r) => r.login === a)) reviewers.push({ login: a, state: "APPROVED" });
  return {
    pr: mr.status === "fulfilled" ? { title: m.title, branch: m.source_branch, base: m.target_branch, decision: m.detailed_merge_status ?? "", draft: Boolean(m.draft) } : {},
    people: { author: name(m.author), assignees: (m.assignees ?? []).map(name), reviewers },
    refs: { base: m.diff_refs?.base_sha, start: m.diff_refs?.start_sha, head: m.diff_refs?.head_sha },
    commits: ok(commits, []).map((c) => ({ sha: c.id ?? c.short_id ?? "", title: c.title ?? "", author: c.author_name ?? "", at: c.created_at })),
    comments: ok(notes, []).filter((n) => !n.system).map((n) => {
      const at = n.position, line = at?.new_line ?? at?.old_line;
      return { author: name(n.author), body: n.body ?? "", at: n.created_at, state: null, ...(line != null ? { path: at.new_path ?? at.old_path, line, side: at.new_line != null ? "RIGHT" : "LEFT" } : {}) };
    }).sort(byTime),
    errors: [mr, approvals, commits, notes].filter((r) => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason)),
  };
}

export const details = (p) => (p.forge === "glab" ? gitlab(p) : github(p));
