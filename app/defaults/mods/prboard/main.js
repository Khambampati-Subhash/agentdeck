// Pull requests as a side panel beside Files and Changes. A GitHub and a
// GitLab tab, each over every repo you're part of or just this folder's,
// split into columns by how a PR involves you. A card opens its diff,
// commits and comments in a window (prdiff). The Issues view lists open
// issues the same way (issues.js); ↗ opens one in the browser.
//
// Data comes from the user's own CLIs (gh, glab; forge.js), run through
// exec with their real env and login. No token lives in the app.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, theme, openOverlay, watchFolder } from "herdr";
import { FORGES, forgeLabel, forgeOf, problem, me, listRepo, listAll } from "./forge.js";
import { listIssuesRepo, listIssuesAll, openIssue } from "./issues.js";

const COLUMNS = [
  { id: "review", label: "Review", empty: "Nothing needs your review." },
  { id: "assigned", label: "Assigned", empty: "Nothing is assigned to you." },
  { id: "created", label: "Mine", empty: "You have no open ones." },
  { id: "all", label: "All", empty: "No open pull requests." },
];
const ISSUE_COLUMNS = [
  { id: "assigned", label: "Assigned", empty: "Nothing is assigned to you." },
  { id: "created", label: "Mine", empty: "You have no open issues." },
  { id: "all", label: "All", empty: "No open issues." },
];
const KINDS = [{ id: "pulls", label: "Pull requests" }, { id: "issues", label: "Issues" }];
const columnsOf = (kind) => (kind === "issues" ? ISSUE_COLUMNS : COLUMNS);
const SCOPES = [{ id: "all", label: "All repos" }, { id: "repo", label: "This repo" }];
const EMPTY = () => ({ review: [], assigned: [], created: [], all: [] });

// Where the work lives: the focused pane's folder, else the active space's.
// `on` runs it on another machine when the space is remote.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
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

export default class PrBoard extends View {
  init(_props, cx) {
    const stored = (key, ids, fallback) => (ids.includes(localStorage.getItem(key)) ? localStorage.getItem(key) : fallback);
    this.forge = stored("prboard.forge", FORGES.map((f) => f.id), "gh");
    this.scope = Object.fromEntries(FORGES.map((f) => [f.id, stored(`prboard.scope.${f.id}`, SCOPES.map((s) => s.id), "all")]));
    this.kind = stored("prboard.kind", KINDS.map((k) => k.id), "pulls");
    this.column = stored("prboard.column", columnsOf(this.kind).map((c) => c.id), this.kind === "issues" ? "assigned" : "review");
    this.cache = new Map(); this.cols = EMPTY(); this.sel = 0; this.loading = false; this.error = null; this.root = null;
    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx));
  }

  // What's shown: pull requests or issues, the forge, its scope, and the
  // folder when that's the scope.
  view(forge = this.forge) {
    const scope = this.scope[forge];
    return JSON.stringify([this.kind, forge, scope, scope === "repo" ? location() : null]);
  }

  // Shows what's known for this view at once; a load fills in the rest.
  show(view, again = false) {
    if (view === this.shown && !again) return;
    if (view !== this.shown) this.sel = 0;
    this.shown = view;
    const known = this.cache.get(view);
    this.cols = known?.cols ?? EMPTY(); this.error = known?.error ?? null; this.root = known?.root ?? null;
  }

  refresh(cx) {
    const view = this.view();
    this.show(view);
    if (this.loading) return;
    const forge = this.forge, scope = this.scope[forge], issues = this.kind === "issues", { cwd, on } = location();
    this.loading = true;
    cx.spawn(async (cx) => {
      const keep = (state) => {
        this.cache.set(view, state);
        if (this.view() === view) this.show(view, true);
      };
      try {
        if (scope === "all") {
          const opts = on ? {} : { cwd };
          const who = await me(forge, opts);
          keep({ cols: this.columns(await (issues ? listIssuesAll : listAll)(forge, who, opts), issues), error: null, root: null });
          return;
        }
        if (!cwd) return keep({ cols: EMPTY(), error: `Open a space in a git repo to see its ${issues ? "issues" : "pull requests"}.`, root: null });
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on, timeout: 15000 });
        if (top.code !== 0) return keep({ cols: EMPTY(), error: "This folder isn't a git repository.", root: null });
        const root = top.stdout.trim();
        const remote = await exec("git", ["remote", "get-url", "origin"], { cwd: root, on, timeout: 15000 });
        const here = forgeOf(remote.code === 0 ? remote.stdout : "");
        if (here !== forge) return keep({ cols: EMPTY(), error: `This repo is on ${forgeLabel(here)}: open the ${forgeLabel(here)} tab, or pick All repos.`, root });
        const who = await me(forge, { cwd: root, on });
        keep({ cols: this.columns(await (issues ? listIssuesRepo : listRepo)(forge, who, { cwd: root, on }), issues), error: null, root });
        this.watch(root, on, cx);
      } catch (e) {
        const known = this.cache.get(view);
        keep({ cols: known?.cols ?? EMPTY(), error: problem(forge, e), root: known?.root ?? null });
      } finally {
        this.loading = false;
        this.sel = Math.min(this.sel, Math.max(0, (this.cols[this.column] ?? []).length - 1));
        cx.notify();
        // The view changed while this one loaded: load that one too.
        if (this.view() !== view && !this.cache.has(this.view())) this.refresh(cx);
      }
    });
  }

  columns(all, issues = false) {
    if (issues) return { assigned: all.filter((p) => p.assigned), created: all.filter((p) => p.mine), all };
    return { review: all.filter((p) => p.review), assigned: all.filter((p) => p.assigned), created: all.filter((p) => p.mine), all };
  }

  // A fetch, push or checkout moves refs: look again. Here only (watchFolder).
  watch(root, on, cx) {
    if (on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(`${root}/.git/refs`);
          if (this.watched === root && this.scope[this.forge] === "repo") this.refresh(cx);
        }
      } catch {}
    });
  }

  // Pull requests or issues. A column the kind doesn't have becomes Assigned.
  setKind(id, cx) {
    this.kind = id;
    localStorage.setItem("prboard.kind", id);
    if (!columnsOf(id).some((c) => c.id === this.column)) { this.column = "assigned"; this.sel = 0; }
    this.refresh(cx);
  }

  setForge(id, cx) {
    this.forge = id;
    localStorage.setItem("prboard.forge", id);
    this.refresh(cx);
  }

  setScope(id, cx) {
    this.scope[this.forge] = id;
    localStorage.setItem(`prboard.scope.${this.forge}`, id);
    this.refresh(cx);
  }

  setColumn(id) {
    this.column = id; this.sel = 0;
    localStorage.setItem("prboard.column", id);
  }

  open(pr) {
    const { on } = location(), here = this.scope[pr.forge] === "repo";
    openOverlay({
      mod: "prdiff", kind: "window", key: `prdiff-${pr.repo}-${pr.num}`, width: 880, height: 560,
      props: {
        pr: { num: pr.num, title: pr.title, branch: pr.branch, base: pr.base, decision: pr.decision, draft: pr.draft, url: pr.url },
        forge: pr.forge, repo: pr.repo, pid: pr.pid, cwd: here ? this.root : null, on: here ? on : null,
      },
    });
  }

  card(t, pr, i) {
    const st = statusOf(pr), on = i === this.sel, every = this.scope[this.forge] === "all";
    const lines = pr.add || pr.del ? `+${pr.add} −${pr.del}` : "";
    const where = pr.branch ? (pr.base ? `${pr.branch} → ${pr.base}` : pr.branch) : "";
    const ciIcon = pr.ci === "pass" ? "✓" : pr.ci === "fail" ? "✕" : pr.ci === "pending" ? "●" : null;
    const ciColor = pr.ci === "pass" ? t.done : pr.ci === "fail" ? t.blocked : pr.ci === "pending" ? t.working : null;
    const ciTip = pr.ci === "pass" ? "Checks passed" : pr.ci === "fail" ? "Checks failing" : pr.ci === "pending" ? "Checks running" : null;
    return v_flex().id(`pr-${pr.repo}-${pr.num}`).w_full().flex_none().px(10).py(8).gap(4).rounded(8).cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.sel = i; this.open(pr); cx.notify(); })
      .child(h_flex().w_full().gap(8).items_center().text_size(10.5)
        .when(every, (e) => e.child(div().min_w(0).truncate().text_color(t.accent).child(pr.repo)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${pr.num}`))
        .child(div().flex_none().px(4).py(1).rounded(4).bg((t[st.color] ?? t.muted) + "22").font_semibold().text_color(t[st.color] ?? t.muted).child(st.text))
        .child(div().flex_1())
        .when(pr.ci, (e) => e.child(div().id(`pr-ci-${pr.repo}-${pr.num}`).flex_none().text_color(ciColor).tooltip(ciTip).child(ciIcon)))
        .when(pr.files > 0, (e) => e.child(div().flex_none().text_color(t.dim).child(`${pr.files} files`))))
      .child(div().w_full().text_size(13).text_color(t.foreground).truncate().child(pr.title))
      .child(h_flex().w_full().gap(8).items_center().text_size(10.5).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(where))
        .when(Boolean(lines), (e) => e.child(div().child(lines)))
        .child(div().flex_none().child(since(pr.at))));
  }

  // On this machine, whatever the space: the browser is here.
  web(issue, cx) {
    cx.spawn(async (cx) => {
      try { await openIssue(issue); } catch (e) { this.error = problem(issue.forge, e); cx.notify(); }
    });
  }

  issueCard(t, row, i) {
    const on = i === this.sel, every = this.scope[this.forge] === "all";
    return v_flex().id(`issue-${row.repo}-${row.num}`).w_full().flex_none().px(10).py(8).gap(4).rounded(8).cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.sel = i; cx.notify(); })
      .child(h_flex().w_full().gap(6).items_center().text_size(10.5)
        .when(every, (e) => e.child(div().min_w(0).truncate().text_color(t.accent).child(row.repo)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${row.num}`))
        .children(row.labels.slice(0, 3).map((l) => div().flex_none().px(4).py(1).rounded(4).bg(t.muted + "22").text_color(t.muted).child(l)))
        .child(div().flex_1())
        .child(div().id(`issue-web-${row.repo}-${row.num}`).flex_none().px(4).rounded(4).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Open in the browser").on_click((_e, cx) => { cx.stop_propagation(); this.web(row, cx); }).child("↗")))
      .child(div().w_full().text_size(13).text_color(t.foreground).truncate().child(row.title))
      .child(h_flex().w_full().text_size(10.5).text_color(t.dim).child(div().flex_1()).child(div().flex_none().child(since(row.at))));
  }

  render(cx) {
    if (this.view() !== this.shown) this.refresh(cx);
    const t = theme(), issues = this.kind === "issues", cols = columnsOf(this.kind), list = this.cols[this.column] ?? [];
    const pill = (id, label, on, click, count) => h_flex().id(id).h(22).px(8).gap(5).items_center().rounded(5).cursor_pointer()
      .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { click(cx); cx.notify(); })
      .child(label).when(Boolean(count), (e) => e.child(div().text_color(t.dim).child(String(count))));
    const group = (children) => h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.chrome).border_1().border_color(t.border).children(children);
    const counts = (forge) => this.cache.get(this.view(forge))?.cols.all.length;
    const empty = this.error || (this.loading ? `Loading ${issues ? "issues" : "pull requests"}…` : cols.find((c) => c.id === this.column)?.empty);
    return v_flex().id("prboard").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down" && list.length) this.sel = (this.sel + 1) % list.length;
        else if (e.key === "up" && list.length) this.sel = (this.sel + list.length - 1) % list.length;
        else if (e.key === "enter" && list[this.sel] && !issues) this.open(list[this.sel]);
        else if (e.key === "r") this.refresh(cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(group(KINDS.map((k) => pill(`prboard-kind-${k.id}`, k.label, this.kind === k.id, (cx) => this.setKind(k.id, cx)))))
        .child(div().flex_1())
        .child(div().id("prboard-refresh").px(6).rounded(6).cursor_pointer().text_color(this.loading ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Refresh (R)").on_click((_e, cx) => { this.refresh(cx); cx.notify(); }).child("↻")))
      .child(h_flex().h(40).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(group(FORGES.map((f) => pill(`prboard-forge-${f.id}`, f.label, this.forge === f.id, (cx) => this.setForge(f.id, cx), counts(f.id)))))
        .child(div().flex_1())
        .child(group(SCOPES.map((s) => pill(`prboard-scope-${s.id}`, s.label, this.scope[this.forge] === s.id, (cx) => this.setScope(s.id, cx))))))
      .child(h_flex().h(32).flex_none().px(8).gap(2).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .children(cols.map((c) => h_flex().id(`prboard-${c.id}`).h(22).px(7).gap(4).items_center().rounded(6).cursor_pointer()
          .bg(this.column === c.id ? t.raised : t.background).text_color(this.column === c.id ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.setColumn(c.id); cx.notify(); })
          .child(c.label).when(this.cols[c.id].length > 0, (e) => e.child(div().text_color(t.dim).child(String(this.cols[c.id].length)))))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("prboard-list").absolute().inset_0().overflow_y_scroll().p(6).gap(2)
          .children(list.map((row, i) => (issues ? this.issueCard(t, row, i) : this.card(t, row, i))))
          .when(!list.length, (e) => e.child(div().p(8).text_color(t.dim).child(empty))))
        .child(Scrollbar.vertical("prboard-list").absolute().inset_0()))
      .when(Boolean(this.error) && list.length > 0, (e) => e.child(div().px(12).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.ansi1).child(this.error)))
      .child(h_flex().h(26).flex_none().px(12).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim).child(issues ? "↑↓ select · ↗ open in the browser · R refresh" : "↑↓ select · Enter open · R refresh"));
  }
}
