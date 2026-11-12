// A pull/merge request, opened from the PR board as a floating window: who's
// on it, its files (pick one to read its diff; pick a line to comment on it),
// its commits (open one for its own diff) and its conversation, with a box to
// comment back. Everything goes through the
// repo's own CLI (gh for GitHub, glab for GitLab; forge.js), so no token
// lives in the app.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { props, theme, notify, closeOverlay, settings } from "herdr";
import { splitDiff } from "./diff.js";
import { details, diffText, comment, openInBrowser, commitDiff, lineComment } from "./forge.js";

const TABS = [{ id: "files", label: "Files" }, { id: "commits", label: "Commits" }, { id: "comments", label: "Comments" }];
const REVIEW = { APPROVED: ["✓", "done"], CHANGES_REQUESTED: ["✕", "blocked"], PENDING: ["⟳", "dim"], DISMISSED: ["–", "dim"] };

function chipOf(pr) {
  if (pr.draft) return { text: "Draft", color: "dim" };
  switch (pr.decision) {
    case "APPROVED": return { text: "Approved", color: "done" };
    case "mergeable": return { text: "Ready to merge", color: "done" };
    case "CHANGES_REQUESTED": return { text: "Changes requested", color: "blocked" };
    case "conflict": case "need_rebase": return { text: "Conflicts", color: "blocked" };
    case "REVIEW_REQUIRED": case "not_approved": return { text: "Needs review", color: "working" };
  }
  return { text: "Open", color: "muted" };
}

function since(ts) {
  const s = ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 1000) : NaN;
  if (!(s >= 0)) return "";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const message = (e) => String(e?.message ?? e).trim();

export default class PrDiff extends View {
  init(_props, cx) {
    const p = props() || {};
    this.p = { pr: { ...(p.pr || {}) }, forge: p.forge === "glab" ? "glab" : "gh", repo: p.repo ?? "", pid: p.pid ?? null, cwd: p.cwd ?? null, on: p.on ?? null };
    this.pr = this.p.pr;
    this.overlay = p.overlay;
    this.tab = "files"; this.files = []; this.file = 0; this.line = null; this.commit = null; this.refs = {};
    this.people = { author: "", assignees: [], reviewers: [] }; this.commits = []; this.comments = [];
    this.error = null; this.loading = false; this.note = null; this.errorNote = null;
    this.handle = cx.focus_handle();
    this.typing = false; this.message = ""; this.busy = false;
    this.input = InputState.new({ placeholder: "Comment on #" + (this.pr.num ?? "") + " · Enter to post" });
    this.input.on("change", (_e, cx) => { this.message = this.input.value(); if (this.typing) cx.notify(); });
    this.input.on("submit", (_e, cx) => this.postComment(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    if (!this.pr.num || !this.p.repo) { this.error = "Open a pull request from the Pull requests panel."; return; }
    this.loading = true; this.error = null;
    cx.spawn(async (cx) => {
      const problems = [];
      await Promise.all([
        diffText(this.p).then((text) => this.setFiles(splitDiff(text)), (e) => problems.push(message(e))),
        this.loadDetails().then((errors) => problems.push(...errors)),
      ]);
      this.error = problems.length ? problems.join("\n") : null;
      this.loading = false;
      cx.notify();
    });
  }

  // People, commits and comments; says what failed.
  async loadDetails() {
    try {
      const d = await details(this.p);
      Object.assign(this.pr, Object.fromEntries(Object.entries(d.pr).filter(([, v]) => v !== undefined && v !== null)));
      this.people = d.people; this.commits = d.commits; this.comments = d.comments; this.refs = d.refs ?? {};
      return d.errors;
    } catch (e) {
      return [message(e)];
    }
  }

  setFiles(files) {
    this.files = files;
    this.file = Math.min(this.file, Math.max(0, files.length - 1));
    this.line = null;
  }

  pick(i, cx) {
    this.file = i; this.line = null;
    cx?.notify();
  }

  // The row (of the shown file's rows) the next comment goes on; null for the
  // whole PR. Hunk headers and notes have no line to comment on.
  pickLine(i, cx) {
    const row = i == null ? null : this.files[this.file]?.rows[i];
    this.line = row && (row.old != null || row.new != null) ? { file: this.file, row: i } : null;
    cx?.notify();
  }

  // Where a row is, as people read it: path:line.
  lineLabel() {
    const file = this.files[this.line?.file], row = file?.rows[this.line?.row];
    return row ? `${row.kind === "-" ? file.old : file.path}:${row.new ?? row.old}` : "";
  }

  // A file's rows with its line comments as one-line rows under their line.
  shownRows(file) {
    if (this.memo?.file === file && this.memo.comments === this.comments) return this.memo.rows;
    const on = this.comments.filter((c) => c.path && c.line != null);
    const rows = [];
    file.rows.forEach((row, at) => {
      rows.push({ ...row, at });
      const here = on.filter((c) => (c.side === "LEFT" ? row.old != null && row.kind !== "+" && c.path === file.old && c.line === row.old : row.new != null && c.path === file.path && c.line === row.new));
      if (here.length) rows.push({ kind: "c", at: null, under: at, text: `▸ ${here[0].author}: ${here[0].body.split("\n")[0]}${here.length > 1 ? ` · ${here.length - 1} more` : ""}` });
    });
    this.memo = { file, comments: this.comments, rows };
    return rows;
  }

  openCommit(c, cx) {
    const open = { c, files: [], file: 0, loading: true, error: null };
    this.commit = open; this.line = null; this.tab = "commits";
    cx.spawn(async (cx) => {
      try { open.files = splitDiff(await commitDiff(this.p, c.sha)); } catch (e) { open.error = message(e); }
      open.loading = false;
      cx.notify();
    });
    cx.notify();
  }

  closeCommit(cx) {
    this.commit = null;
    cx?.notify();
  }

  postComment(cx) {
    const msg = (this.input.value() || "").trim();
    if (!msg || this.busy || !this.pr.num || !this.p.repo) return;
    const file = this.files[this.line?.file], row = file?.rows[this.line?.row], where = this.lineLabel();
    this.busy = true; this.errorNote = null; this.note = null;
    cx.spawn(async (cx) => {
      try {
        if (row) await lineComment(this.p, this.refs, file, row, msg);
        else await comment(this.p, msg);
        this.input.set_value(""); this.message = ""; this.line = null;
        this.note = row ? `Comment posted on ${where}.` : "Comment posted.";
        notify({ title: "Comment posted", body: "#" + this.pr.num + " · " + (this.pr.title || ""), level: "success" });
        const errors = await this.loadDetails();
        if (errors.length) this.errorNote = errors.join("\n");
      } catch (e) {
        this.errorNote = message(e);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  web(cx) {
    cx.spawn(async (cx) => {
      try { await openInBrowser(this.p); } catch (e) { this.errorNote = message(e); cx.notify(); }
    });
  }

  // Pieces -------------------------------------------------------------

  avatar(t, who) {
    const colors = [t.accent, t.working, t.done, t.blocked, t.ansi5, t.ansi6];
    const hue = colors[[...who].reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length];
    return div().size(16).flex_none().rounded(8).bg(hue).flex().items_center().justify_center().text_size(9).font_semibold().text_color(t.background).child((who[0] ?? "?").toUpperCase());
  }

  person(t, who, mark) {
    return h_flex().gap(4).items_center().child(this.avatar(t, who)).child(div().text_color(t.foreground).child(who))
      .when(Boolean(mark), (e) => e.child(div().text_color(t[mark?.[1]] ?? t.dim).child(mark?.[0] ?? "")));
  }

  peopleLine(t) {
    const { author, assignees, reviewers } = this.people;
    const group = (label, items) => h_flex().gap(6).items_center().child(div().text_color(t.dim).child(label))
      .when(!items.length, (e) => e.child(div().text_color(t.dim).child("—"))).children(items);
    return h_flex().h(30).flex_none().px(14).gap(16).items_center().border_b(1).border_color(t.border).text_size(11).overflow_hidden()
      .child(group("Author", author ? [this.person(t, author)] : []))
      .child(group("Assignees", assignees.map((a) => this.person(t, a))))
      .child(group("Reviewers", reviewers.map((r) => this.person(t, r.login, REVIEW[r.state] ?? REVIEW.PENDING))));
  }

  // One diff row. Rows are drawn by a virtual list, which can't take their
  // handlers: the list's on_item_click (diffView) acts for them.
  diffRow(r, t, pickable) {
    if (r.kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(r.text);
    if (r.kind === "c") return div().w_full().h(20).flex_none().pl(52).flex().items_center().truncate().bg(t.accent + "10").text_color(t.accent).when(pickable, (e) => e.cursor_pointer()).child(r.text);
    const picked = pickable && this.line?.file === this.file && this.line?.row === r.at;
    return h_flex()
      .w_full().h(20).flex_none().gap(10)
      .when(r.kind === "+", (e) => e.bg(t.ansi2 + "18"))
      .when(r.kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .when(picked, (e) => e.bg(t.accent + "33"))
      .when(pickable && (r.old != null || r.new != null), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .child(div().w(30).flex_none().text_right().text_color(picked ? t.accent : t.dim).child(r.number === null ? "" : String(r.number)))
      .child(div().flex_1().min_w(0).truncate().child(r.text || " "));
  }

  // A click on a shown row: a line picks it (again: unpicks), a line
  // comment's row opens the conversation.
  rowClick(rows, key, cx) {
    const r = rows[Number(String(key).split(":")[1])];
    if (!r) return;
    if (r.kind === "c") { this.tab = "comments"; cx.notify(); return; }
    this.pickLine(this.line?.file === this.file && this.line?.row === r.at ? null : r.at, cx);
  }

  // A file list and the picked file's diff: the PR's, or one commit's.
  diffView(t, id, files, index, pick, pickable) {
    const file = files[index], rows = file ? (pickable ? this.shownRows(file) : file.rows.map((r, at) => ({ ...r, at }))) : [];
    const list = v_flex().id(`${id}-files`).absolute().inset_0().overflow_y_scroll().p(6).gap(1).children(files.map((f, i) => {
      const parts = f.path.split("/"), base = parts.pop();
      return h_flex().id(`${id}-file-${i}`).h(26).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer().text_size(12)
        .when(i === index, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => pick(i, cx))
        .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().flex_none().max_w(180).truncate().child(base)))
        .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
        .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
    }));
    return h_flex().size_full().min_h(0)
      .child(div().w(250).flex_none().h_full().relative().border_r(1).border_color(t.border).child(list).child(Scrollbar.vertical(`${id}-files`).absolute().inset_0()))
      .child(div().flex_1().min_w(0).h_full().relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id(`${id}-x`).size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(file?.width ?? 300).h_full()
            .child(v_virtual_list(id, rows.length, 20, (i) => `${index}:${i}`, (range) => rows.slice(range.start, range.end).map((r) => this.diffRow(r, t, pickable)))
              .when(pickable, (e) => e.on_item_click((key, cx) => this.rowClick(rows, key, cx))).size_full())))
        .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()));
  }

  filesTab(t) {
    if (!this.files.length) return div().p(12).text_color(t.dim).child(this.loading ? "Loading diff…" : "No changes in this pull request.");
    return this.diffView(t, "prdiff", this.files, this.file, (i, cx) => this.pick(i, cx), true);
  }

  // An opened commit: back to the list, then its own files and diff.
  commitView(t) {
    const open = this.commit, mono = settings().font_family ?? "JetBrains Mono";
    const body = open.files.length
      ? this.diffView(t, "prdiff-commit", open.files, open.file, (i, cx) => { open.file = i; cx.notify(); }, false)
      : div().p(12).text_color(open.error ? t.ansi1 : t.dim).child(open.error || (open.loading ? "Loading the commit…" : "No changes in this commit."));
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(34).flex_none().px(14).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
        .child(div().id("prdiff-commits-back").flex_none().text_color(t.accent).cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.closeCommit(cx)).child("‹ All commits"))
        .child(div().flex_none().font_family(mono).text_size(11).text_color(t.dim).child(open.c.sha.slice(0, 7)))
        .child(div().flex_1().min_w(0).truncate().child(open.c.title)))
      .child(div().flex_1().min_h(0).child(body));
  }

  listTab(t, id, items, empty, row) {
    return div().size_full().relative()
      .child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().children(items.map(row))
        .when(!items.length, (e) => e.child(div().p(12).text_color(t.dim).child(this.loading ? "Loading…" : empty))))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  commitsTab(t) {
    if (this.commit) return this.commitView(t);
    return this.listTab(t, "prdiff-commits", this.commits, "No commits.", (c, i) => h_flex().id(`prdiff-commit-${i}`).w_full().flex_none().px(14).py(9).gap(10).items_center().border_b(1).border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.openCommit(c, cx))
      .child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.dim).child(c.sha.slice(0, 7)))
      .child(div().flex_1().min_w(0).truncate().child(c.title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child([c.author, since(c.at)].filter(Boolean).join(" · ") + "  ›")));
  }

  commentsTab(t) {
    return this.listTab(t, "prdiff-comments", this.comments, "No comments yet.", (c, i) => {
      const mark = c.state ? chipOf({ decision: c.state }) : null;
      return h_flex().id(`prdiff-comment-${i}`).w_full().flex_none().px(14).py(10).gap(10).items_start().border_b(1).border_color(t.border)
        .child(this.avatar(t, c.author || "?"))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(6).items_center().text_size(11)
            .child(div().font_semibold().child(c.author || "Someone"))
            .when(Boolean(c.path), (e) => e.child(div().text_color(t.accent).child(`${c.path}:${c.line}`)))
            .when(Boolean(mark), (e) => e.child(div().px(4).rounded(4).bg((t[mark?.color] ?? t.muted) + "22").font_semibold().text_color(t[mark?.color] ?? t.muted).child(mark?.text ?? "")))
            .child(div().text_color(t.dim).child(since(c.at))))
          .child(div().w_full().text_size(12.5).text_color(t.muted).child(c.body.length > 4000 ? c.body.slice(0, 4000) + "…" : c.body)));
    });
  }

  render() {
    const t = theme(), pr = this.pr, chip = chipOf(pr);
    const where = [pr.branch ? (pr.base && pr.base !== pr.branch ? `${pr.branch} → ${pr.base}` : pr.branch) : null, `${this.p.repo}#${pr.num ?? ""}`].filter(Boolean).join(" · ");
    const enabled = Boolean(this.message?.trim() && !this.busy && pr.num);
    const target = this.line ? this.lineLabel() : null;
    const stop = (_e, cx) => cx.stop_propagation();
    const icon = (id, label, tip, click) => div().id(id).text_size(14).px(4).rounded(6).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip(tip).on_mouse_down("left", stop).on_click(click).child(label);
    const counts = { files: this.files.length, commits: this.commits.length, comments: this.comments.length };
    const body = this.tab === "commits" ? this.commitsTab(t) : this.tab === "comments" ? this.commentsTab(t) : this.filesTab(t);
    return v_flex()
      .id("prdiff")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      // Header: title · status · branch → base · repo#num · open · refresh · close
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().min_w(0).truncate().font_semibold().child(pr.title || ("#" + (pr.num ?? ""))))
        .child(div().flex_none().px(4).py(1).rounded(5).bg((t[chip.color] ?? t.muted) + "22").text_size(11).font_semibold().text_color(t[chip.color] ?? t.muted).child(chip.text))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(where))
        .child(div().flex_1())
        .child(icon("prdiff-web", "↗", "Open in the browser", (_e, cx) => this.web(cx)))
        .child(icon("prdiff-refresh", "↻", "Refresh", (_e, cx) => { this.refresh(cx); cx.notify(); }))
        .child(icon("prdiff-close", "✕", "Close", () => closeOverlay(this.overlay))))
      .child(this.peopleLine(t))
      // Tabs: Files · Commits · Comments, each with its count
      .child(h_flex().h(34).flex_none().px(10).gap(2).items_center().border_b(1).border_color(t.border).text_size(12)
        .children(TABS.map((tab) => h_flex().id(`prdiff-tab-${tab.id}`).h(24).px(8).gap(5).items_center().rounded(6).cursor_pointer()
          .bg(this.tab === tab.id ? t.raised : t.background).text_color(this.tab === tab.id ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop).on_click((_e, cx) => { this.tab = tab.id; cx.notify(); })
          .child(tab.label).when(counts[tab.id] > 0, (e) => e.child(div().text_color(t.dim).child(String(counts[tab.id])))))))
      .child(div().flex_1().min_h(0).relative().child(body))
      .when(Boolean(this.error), (e) => e.child(div().px(12).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.ansi1).child(this.error)))
      .when(Boolean(this.note) || Boolean(this.errorNote), (e) => e.child(div().px(12).pt(4).text_size(11).text_color(this.errorNote ? t.ansi1 : t.done).child(this.errorNote || this.note)))
      // Footer: comment
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("prdiff-comment").flex_1().min_w(0).h(32).px(10).gap(8).flex().items_center().rounded(8).border_1().border_color(this.typing || target ? t.accent : t.border).cursor_text().on_mouse_down("left", stop)
          .when(Boolean(target), (e) => e.child(h_flex().id("prdiff-target").flex_none().px(6).py(1).gap(5).items_center().rounded(5).bg(t.accent + "1f").text_size(11).text_color(t.accent).cursor_pointer()
            .tooltip("Comment on the whole pull request instead").on_click((_e, cx) => this.pickLine(null, cx)).child(target ?? "").child("✕")))
          .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("prdiff-post").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_mouse_down("left", stop).on_click((_e, cx) => this.postComment(cx)).child(this.busy ? "Posting…" : target ? "Comment on line" : "Comment")));
  }
}
