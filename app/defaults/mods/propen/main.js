// Open a pull request (GitHub) or merge request (GitLab) from a checkout's
// branch: props { folder, machine }. It drafts a title and body from the
// commits ahead of the base, and offers the branch's open one instead when
// there is one. Create pushes the branch, runs gh or glab, and opens the new
// one's window (prdiff). Nothing goes out until Create or Enter.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, notify } from "herdr";
import { readBranch, draft, existing, createPr } from "./git.js";

export default class ProOpen extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.on = p.machine ?? null;
    this.info = undefined; // undefined: reading; null: can't (this.error says why)
    this.open = null; // the branch's open PR or MR
    this.isDraft = true;
    this.busy = false;
    this.error = "";
    this.focusedField = "title";
    this.title = InputState.new({ value: "", placeholder: "Title" });
    this.body = TextareaState.new({ value: "", placeholder: "Description", rows: 8 });
    this.base = InputState.new({ value: "", placeholder: "Base branch" });
    for (const [name, state] of [["title", this.title], ["body", this.body], ["base", this.base]]) {
      state.on("focus", (_e, cx) => { this.focusedField = name; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focusedField === name) this.focusedField = ""; cx.notify(); });
    }
    // Enter in a one-line field; in the body it's a new line.
    this.title.on("submit", (_e, cx) => this.go(cx));
    this.base.on("submit", (_e, cx) => this.go(cx));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        const info = await readBranch(p.folder, this.on);
        const open = await existing(info, this.on);
        const d = draft(info.branch, info.commits);
        this.title.set_value(d.title);
        this.body.set_value(d.body);
        this.base.set_value(info.base);
        this.open = open;
        this.info = info; // set together: Enter acts on both
        this.title.focus();
      } catch (e) { this.info = null; this.error = e?.message ?? String(e); }
      cx.notify();
    });
  }

  kind() { return this.info?.forge === "glab" ? "merge request" : "pull request"; }

  // Enter: open the existing one, else create (which refuses when it can't).
  go(cx) {
    if (this.open) return this.show(this.open);
    this.create(cx);
  }

  create(cx) {
    const info = this.info;
    if (this.busy || !info || this.open || info.commits.length === 0) return;
    const title = this.title.value().trim();
    if (!title) { this.error = "Type a title."; return cx.notify(); }
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const url = await createPr(info, this.on, { title, body: this.body.value(), base: this.base.value().trim() || info.base, draft: this.isDraft });
        this.show({ num: Number(url.replace(/\/+$/, "").split("/").pop()), url, title });
      } catch (e) { this.error = e?.message ?? String(e); }
      this.busy = false;
      cx.notify();
    });
  }

  // Its window, as the board opens one.
  show(pr) {
    const info = this.info;
    notify({ title: "Opened " + pr.url, level: "success" });
    openOverlay({
      mod: "prdiff", kind: "window", key: `prdiff-${info.repo}-${pr.num}`, width: 880, height: 560,
      props: { pr: { num: pr.num, url: pr.url, title: pr.title, branch: info.branch }, forge: info.forge, repo: info.repo, cwd: info.root, on: this.on },
    });
    closeOverlay(props()?.overlay);
  }

  render(cx) {
    const t = theme(), info = this.info, n = info?.dirty ?? 0;
    const ready = Boolean(info) && !this.open;
    const form = ready && info.commits.length > 0, can = form && !this.busy;
    const field = (el, name) => el.px(10).rounded(6).border(1).border_color(this.focusedField === name ? t.accent : t.input).bg(t.background).text_color(t.foreground);
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);
    const button = (id, text, on, click) => div().id(id).h(28).px(12).flex_none().items_center().justify_center().rounded(5).text_size(12)
      .when(on, (el) => el.cursor_pointer().bg(t.accent).text_color(t.background).on_click((_e, cx) => click(cx)))
      .when(!on, (el) => el.bg(t.input).text_color(t.dim))
      .child(text);
    const sign = info?.forge === "glab" ? "!" : "#";
    return v_flex()
      .id("propen")
      .track_focus(this.handle)
      // With the form shown its fields own Enter (in the body it's a new line).
      .on_key_down((e, cx) => { if (e.key === "escape") closeOverlay(props()?.overlay); else if (e.key === "enter" && !form) this.go(cx); })
      .size_full()
      .p(16)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(`Open ${this.kind()}`))
      .child(div().text_color(t.muted).child(info === undefined ? "…" : info ? `${info.branch} → ${info.base} · ${info.commits.length} commit${info.commits.length === 1 ? "" : "s"}` : ""))
      .when(Boolean(this.open), (el) => el.child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`Already open: ${sign}${this.open.num} ${this.open.title}`))
        .child(button("propen-open", "Open", true, () => this.show(this.open)))))
      .when(ready && n > 0, (el) => el.child(div().text_color(t.working).child(`${n} uncommitted change${n === 1 ? "" : "s"} won't be in it.`)))
      .when(ready && info.commits.length === 0, (el) => el.child(div().text_color(t.blocked).child(`Nothing to open: no commits ahead of origin/${info.base}.`)))
      .when(form, (el) => el
        .child(label("Title"))
        .child(field(Input.new(this.title).h(32).items_center(), "title"))
        .child(label("Description"))
        .child(field(Textarea.new(this.body).h(150).py(6), "body"))
        .child(h_flex().gap(8).items_center()
          .child(label("Into"))
          .child(field(Input.new(this.base).h(28).w(160).items_center(), "base"))
          .child(div().flex_1())
          .child(div().id("propen-draft").h(28).px(10).flex_none().items_center().justify_center().rounded(5).cursor_pointer().text_size(12)
            .when(this.isDraft, (el) => el.bg(t.selected).text_color(t.foreground))
            .when(!this.isDraft, (el) => el.bg(t.input).text_color(t.muted).hover((s) => s.bg(t.hover)))
            .on_click((_e, cx) => { this.isDraft = !this.isDraft; cx.notify(); })
            .child(this.isDraft ? "☑ Draft" : "☐ Draft"))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
        .child(div().flex_1().child(this.busy ? "pushing and creating…" : form ? "↵ create · esc cancel" : this.open ? "↵ open · esc close" : "esc close"))
        .when(ready, (el) => el.child(button("propen-create", `Create ${this.isDraft ? "draft " : ""}${this.kind()}`, can, (cx) => this.create(cx)))));
  }
}
