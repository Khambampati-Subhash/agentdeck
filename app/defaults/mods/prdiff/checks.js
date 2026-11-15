// The Checks tab: a list of CI checks from gh pr checks or GitLab pipeline jobs.

import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { theme, settings } from "herdr";

export function checksTab(v, t) {
  if (v.log) return logView(v, t);
  if (v.checkError) {
    return div().p(12).text_color(t.ansi1).child(v.checkError);
  }
  if (!v.checks.length) {
    return div().p(12).text_color(t.dim).child(v.loading ? "Loading checks…" : "No checks for this pull request.");
  }
  const stop = (_e, cx) => cx.stop_propagation();
  return div().size_full().relative()
    .child(v_flex().id("prdiff-checks").absolute().inset_0().overflow_y_scroll().children(v.checks.map((c, i) =>
      h_flex().id(`prdiff-check-${i}`).w_full().flex_none().px(14).py(10).gap(10).items_center().border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => v.openLog(i, cx))
        .child(checkDot(c, t))
        .child(div().flex_1().min_w(0).truncate().child(c.name))
        .child(div().text_size(11).text_color(t.dim).child(c.workflow))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("›"))))
      .child(h_flex().h(30).flex_none().px(14).items_center().border_t(1).border_color(t.border).text_size(11)
        .child(div().id("prdiff-checks-browser").text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.working)).on_mouse_down("left", stop).on_click((_e, cx) => v.checksInBrowser(cx)).child("Open checks in browser"))))
    .child(Scrollbar.vertical("prdiff-checks").absolute().inset_0());
}

export function logView(v, t) {
  const stop = (_e, cx) => cx.stop_propagation();
  const log = v.log;
  const lines = log.text ? log.text.split("\n") : [];
  const rerunLabel = v.p.forge === "glab" ? "Retry job" : "Re-run failed jobs";
  return v_flex().size_full()
    .child(h_flex().h(34).flex_none().px(14).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
      .child(div().id("prdiff-log-back").flex_none().text_color(t.accent).cursor_pointer().on_mouse_down("left", stop).on_click((_e, cx) => v.closeLog(cx)).child("‹ Back"))
      .child(div().flex_1().min_w(0).truncate().child(log.check.name))
      .when(log.check.state === "fail" && Boolean(log.text), (e) => e.child(div().id("prdiff-fix").px(8).py(3).rounded(5).bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.9)).on_mouse_down("left", stop).on_click((_e, cx) => v.fixWithAgent(cx)).child("Fix with agent")))
      .child(div().id("prdiff-rerun").px(8).py(3).rounded(5).bg(t.raised).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => v.rerunCheck(cx)).child(rerunLabel)))
    .when(Boolean(log.error), (e) => e.child(div().p(12).text_color(t.ansi1).child(log.error)))
    .when(Boolean(log.text), (e) => e.child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
      .child(v_virtual_list("prdiff-log", lines.length, 20, (i) => String(i), (range) => lines.slice(range.start, range.end).map((line) => div().w_full().h(20).flex_none().px(12).child(line || " "))).size_full())
      .child(Scrollbar.vertical("prdiff-log").viewport_from_layout().absolute().inset_0())))
    .when(!log.text && !log.error, (e) => e.child(div().p(12).text_color(t.dim).child("Loading log…")));
}

function checkDot(c, t) {
  const colors = { pass: t.ansi2, fail: t.ansi1, pending: t.accent, skip: t.dim, cancel: t.muted };
  const icons = { pass: "✓", fail: "✕", pending: "●", skip: "−", cancel: "✕" };
  return div().size(16).flex_none().rounded(8).flex().items_center().justify_center().text_size(10).font_semibold().text_color(colors[c.state] ?? t.dim).child(icons[c.state] ?? "?");
}
