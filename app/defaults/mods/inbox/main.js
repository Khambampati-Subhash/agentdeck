// Every agent blocked on you (OSC 7501 "blocked"), longest waiting first: what it
// asks, its screen's last lines, and Enter to go to its pane. It never answers
// for you: no approve or deny, no keys sent. The preview is shown as read.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, run, hc, theme, settings, props, closeOverlay } from "herdr";
import { inboxRows, stamp, trimPreview, keepSelection } from "./rows.js";

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Inbox extends View {
  init(_props, cx) {
    // When each agent started waiting (ms), kept across restarts.
    try { this.since = JSON.parse(localStorage.getItem("since") ?? "{}"); } catch { this.since = {}; }
    if (!this.since || typeof this.since !== "object" || Array.isArray(this.since)) this.since = {};
    this.previews = new Map();
    this.reading = new Set();
    this.at = 0;
    this.address = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => this.handle.focus());
    cx.timer.every(3000, (cx) => { this.refresh(cx); cx.notify(); });
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  // The rows now, with the wait stamps saved when they change.
  rows() {
    const now = Date.now();
    const list = agents();
    const next = stamp(this.since, list, now);
    if (JSON.stringify(next) !== JSON.stringify(this.since)) {
      this.since = next;
      try { localStorage.setItem("since", JSON.stringify(next)); } catch {}
    }
    const rows = inboxRows(list, terminals(), this.since, now);
    // Agents no longer blocked lose their preview; blocked again, they get a fresh one.
    const blocked = new Set(rows.map((r) => r.address));
    for (const a of this.previews.keys()) if (!blocked.has(a)) this.previews.delete(a);
    return rows;
  }

  // The selected row: follows its agent when rows reorder.
  selected(rows) {
    this.at = rows.length ? Math.max(0, keepSelection(rows, this.address, this.at)) : 0;
    this.address = rows[this.at]?.address ?? null;
    return rows[this.at] ?? null;
  }

  move(delta) {
    const rows = this.rows();
    if (!rows.length) return;
    this.selected(rows);
    this.at = (this.at + delta + rows.length) % rows.length;
    this.address = rows[this.at].address;
  }

  go() {
    const r = this.selected(this.rows());
    if (!r) return;
    run("agent.focus", { terminal: r.address });
    this.close();
  }

  peek() {
    const r = this.selected(this.rows());
    if (r) run("terminal.peek", { terminal: r.address });
  }

  // One read in flight per agent; a failed read is an empty preview.
  read(address, cx) {
    if (this.reading.has(address)) return;
    this.reading.add(address);
    cx.spawn(async (cx) => {
      let lines = [];
      try {
        const r = await hc(["read", address, "--json"]);
        if (r.code === 0) lines = trimPreview(JSON.parse(r.stdout).text ?? "");
      } catch {}
      this.reading.delete(address);
      if (this.rows().some((row) => row.address === address)) this.previews.set(address, lines);
      cx.notify();
    });
  }

  // Reads every blocked agent's screen again.
  refresh(cx) {
    for (const r of this.rows()) this.read(r.address, cx);
  }

  row(t, r, i, on) {
    const preview = this.previews.get(r.address) ?? [];
    return v_flex()
      .id(`ib-${r.address}`)
      .mx(4)
      .px(10)
      .py(8)
      .gap(3)
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click(() => { this.at = i; this.address = r.address; this.go(); })
      .child(h_flex().gap(8).items_center()
        .child(icon(r.program, 16, t.foreground))
        .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(r.program?.name ?? r.title ?? r.address))
        .when(Boolean(r.kind), (el) => el.child(div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child(r.kind)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(duration(r.waited))))
      .child(div().truncate().text_size(11).text_color(t.dim).child(`${r.space_name} · ${r.tab_name}`))
      .when(Boolean(r.msg), (el) => el.child(div().text_size(12).text_color(t.foreground).child(r.msg)))
      .when(on && preview.length > 0, (el) => el.child(
        v_flex().mt(4).p(8).rounded(6).bg(t.background).border_1().border_color(t.border)
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted)
          .children(preview.map((line) => div().whitespace_nowrap().overflow_hidden().child(line)))));
  }

  render(cx) {
    const t = theme();
    const rows = this.rows();
    for (const r of rows) if (!this.previews.has(r.address)) this.read(r.address, cx);
    const sel = this.selected(rows);
    const hint = (text) => div().child(text);
    return v_flex()
      .id("inbox")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "down") this.move(1);
        else if (k === "up") this.move(-1);
        else if (k === "enter") this.go();
        else if (k === "space") this.peek();
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Needs you"))
        .when(rows.length > 0, (el) => el.child(div().px(6).rounded(5).bg(t.blocked + "26").text_size(11).font_semibold().text_color(t.blocked).child(String(rows.length))))
        .child(div().flex_1())
        .child(div().id("inbox-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(rows.length
        ? v_flex().id("inbox-list").flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(rows.map((r, i) => this.row(t, r, i, r === sel)))
        : div().flex_1().py(24).text_center().text_color(t.dim).child("No agent needs you"))
      .child(h_flex().gap(14).pt(8).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(hint("↑↓ move")).child(hint("↵ go to pane")).child(hint("space peek")));
  }
}
