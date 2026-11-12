// Pull requests for the repo you're in, as a side panel beside Files and
// Changes. Lists the open PRs (GitHub) or MRs (GitLab) in columns by how
// they involve you, and opens each one's diff in a window (prdiff).
//
// Data comes from the user's own CLIs (gh for GitHub, glab for GitLab), run
// through exec with their real env and login. No token lives in the app.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, theme, openOverlay, watchFolder } from "herdr";

const COLUMNS = [
  { id: "review", label: "Review", empty: "Nothing needs your review." },
  { id: "assigned", label: "Assigned", empty: "Nothing is assigned to you." },
  { id: "created", label: "Mine", empty: "You haven't opened one here." },
  { id: "all", label: "All", empty: "No open pull requests here." },
];
const EMPTY = () => ({ review: [], assigned: [], created: [], all: [] });

// Where the work lives: the focused pane's folder, else the active space's.
// `on` runs it on another machine when the space is remote.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

// GitLab when origin says so (gitlab.com or a host named gitlab), else GitHub.
const kindOf = (remote) => /gitlab/i.test(remote) ? "glab" : "gh";

const LIST = {
  gh: ["pr", "list", "--state", "open", "--limit", "60", "--json", "number,title,author,headRefName,baseRefName,additions,deletions,changedFiles,isDraft,reviewDecision,reviewRequests,assignees,updatedAt,url"],
  glab: ["mr", "list", "--per-page", "60", "--output", "json"],
};

const login = (u) => String((u && typeof u === "object" ? u.login ?? u.username ?? "" : u) ?? "").toLowerCase();

// Both CLIs' rows as one shape.
function uniform(rows, kind, me) {
  const has = (users) => Boolean(me) && Array.isArray(users) && users.some((u) => login(u) === me);
  if (kind === "glab") return rows.map((m) => ({
    num: m.iid, title: m.title ?? "Untitled", branch: m.source_branch ?? "?", base: m.target_branch ?? "?",
    add: 0, del: 0, files: 0,
    draft: Boolean(m.draft ?? m.work_in_progress) || /^(draft:|\[draft\]|wip:)/i.test(m.title ?? ""),
    decision: m.detailed_merge_status ?? "",
    review: has(m.reviewers), assigned: has(m.assignees), mine: Boolean(me) && login(m.author) === me,
    url: m.web_url, at: m.updated_at,
  }));
  return rows.map((p) => ({
    num: p.number, title: p.title ?? "Untitled", branch: p.headRefName ?? "?", base: p.baseRefName ?? "?",
    add: p.additions ?? 0, del: p.deletions ?? 0, files: p.changedFiles ?? 0,
    draft: Boolean(p.isDraft), decision: p.reviewDecision ?? "",
    review: has(p.reviewRequests), assigned: has(p.assignees), mine: Boolean(me) && login(p.author) === me,
    url: p.url, at: p.updatedAt,
  }));
}

// GitHub's review decision or GitLab's merge status, as a chip.
function statusOf(pr) {
  if (pr.draft) return { text: "Draft", color: "dim" };
  switch (pr.decision) {
    case "APPROVED": return { text: "Approved", color: "done" };
    case "mergeable": return { text: "Ready to merge", color: "done" };
    case "CHANGES_REQUESTED": return { text: "Changes requested", color: "blocked" };
    case "conflict": case "need_rebase": return { text: "Conflicts", color: "blocked" };
    case "REVIEW_REQUIRED": case "not_approved": return { text: "Needs review", color: "working" };
  }
  return pr.review ? { text: "Needs review", color: "working" } : { text: "Open", color: "muted" };
}

function since(ts) {
  const s = ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 1000) : NaN;
  if (!(s >= 0)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const message = (e) => String(e?.message ?? e).trim();

export default class PrBoard extends View {
  init(_props, cx) {
    this.column = COLUMNS.some((c) => c.id === localStorage.getItem("prboard.column")) ? localStorage.getItem("prboard.column") : "review";
    this.cols = EMPTY(); this.sel = 0; this.loading = false; this.error = null; this.repo = null;
    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx));
  }

  // The signed-in login, remembered per forge and machine.
  async me(kind, root, on) {
    const store = `prboard.me.${kind}${on ? "@" + on : ""}`;
    const known = localStorage.getItem(store);
    if (known) return known;
    const r = await exec(kind, ["api", "user"], { cwd: root, on, timeout: 15000 });
    if (r.code !== 0) return null;
    let me = null;
    try { me = login(JSON.parse(r.stdout)); } catch {}
    if (me) localStorage.setItem(store, me);
    return me;
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) { this.context = context; this.cols = EMPTY(); this.repo = null; this.error = null; this.sel = 0; this.watched = null; }
    if (!cwd) { this.error = "Open a space in a git repo to see its pull requests."; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      let kind = "gh";
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on, timeout: 15000 });
        if (key() !== context) return;
        if (top.code !== 0) { this.cols = EMPTY(); this.repo = null; this.error = "Not a git repository."; return; }
        const root = top.stdout.trim();
        const remote = await exec("git", ["remote", "get-url", "origin"], { cwd: root, on, timeout: 15000 });
        kind = kindOf(remote.code === 0 ? remote.stdout : "");
        const me = await this.me(kind, root, on);
        const r = await exec(kind, LIST[kind], { cwd: root, on, timeout: 60000 });
        if (key() !== context) return;
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `${kind} failed`);
        const all = uniform(JSON.parse(r.stdout || "[]"), kind, me);
        this.repo = { root, on, kind };
        this.cols = { review: all.filter((p) => p.review), assigned: all.filter((p) => p.assigned), created: all.filter((p) => p.mine), all };
        this.sel = Math.min(this.sel, Math.max(0, this.cols[this.column].length - 1));
        this.error = null;
        this.watch(root, on, cx);
      } catch (e) {
        if (key() === context) this.error = /cannot start|not found|no such file/i.test(message(e)) ? `${kind} isn't installed or isn't on your PATH: ${message(e)}` : message(e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // A fetch, push or checkout moves refs: look again. Here only (watchFolder).
  watch(root, on, cx) {
    if (on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(`${root}/.git/refs`);
          if (this.watched === root) this.refresh(cx);
        }
      } catch {}
    });
  }

  setColumn(id) {
    this.column = id; this.sel = 0;
    localStorage.setItem("prboard.column", id);
  }

  open(pr) {
    if (!this.repo) return;
    openOverlay({
      mod: "prdiff", kind: "window", key: `prdiff-${pr.num}`, width: 880, height: 560,
      props: { pr: { num: pr.num, title: pr.title, branch: pr.branch, base: pr.base, decision: pr.decision, draft: pr.draft, url: pr.url }, cwd: this.repo.root, on: this.repo.on, kind: this.repo.kind },
    });
  }

  card(t, pr, i) {
    const st = statusOf(pr), on = i === this.sel;
    const lines = pr.add || pr.del ? `+${pr.add} −${pr.del}` : "";
    return v_flex().id(`pr-${pr.num}`).w_full().flex_none().px(10).py(8).gap(4).rounded(8).cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.sel = i; this.open(pr); cx.notify(); })
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().text_size(11).text_color(t.dim).child(`#${pr.num}`))
        .child(div().px(4).py(1).rounded(4).bg((t[st.color] ?? t.muted) + "22").text_size(10.5).font_semibold().text_color(t[st.color] ?? t.muted).child(st.text))
        .child(div().flex_1())
        .when(pr.files > 0, (e) => e.child(div().text_size(10.5).text_color(t.dim).child(`${pr.files} files`))))
      .child(div().w_full().text_size(13).text_color(t.foreground).truncate().child(pr.title))
      .child(h_flex().w_full().gap(8).items_center().text_size(10.5).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(pr.base !== "?" ? `${pr.branch} → ${pr.base}` : pr.branch))
        .when(Boolean(lines), (e) => e.child(div().child(lines)))
        .child(div().flex_none().child(since(pr.at))));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), list = this.cols[this.column];
    const tabs = COLUMNS.map((c) => h_flex().id(`prboard-${c.id}`).h(22).px(7).gap(4).items_center().rounded(6).cursor_pointer()
      .bg(this.column === c.id ? t.raised : t.background).text_color(this.column === c.id ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.setColumn(c.id); cx.notify(); })
      .child(c.label).when(this.cols[c.id].length > 0, (e) => e.child(div().text_color(t.dim).child(String(this.cols[c.id].length)))));
    const empty = this.error || (this.loading ? "Loading pull requests…" : COLUMNS.find((c) => c.id === this.column).empty);
    return v_flex().id("prboard").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down" && list.length) this.sel = (this.sel + 1) % list.length;
        else if (e.key === "up" && list.length) this.sel = (this.sel + list.length - 1) % list.length;
        else if (e.key === "enter" && list[this.sel]) this.open(list[this.sel]);
        else if (e.key === "r") this.refresh(cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(this.repo?.kind === "glab" ? "Merge requests" : "Pull requests"))
        .child(div().flex_1())
        .child(div().id("prboard-refresh").px(6).rounded(6).cursor_pointer().text_color(this.loading ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Refresh (R)").on_click((_e, cx) => { this.refresh(cx); cx.notify(); }).child("↻")))
      .child(h_flex().h(32).flex_none().px(8).gap(2).items_center().border_b(1).border_color(t.border).text_size(11.5).children(tabs))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("prboard-list").absolute().inset_0().overflow_y_scroll().p(6).gap(2)
          .children(list.map((pr, i) => this.card(t, pr, i)))
          .when(!list.length, (e) => e.child(div().p(8).text_color(t.dim).child(empty))))
        .child(Scrollbar.vertical("prboard-list").absolute().inset_0()))
      .when(Boolean(this.error) && list.length > 0, (e) => e.child(div().px(12).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.ansi1).child(this.error)));
  }
}
