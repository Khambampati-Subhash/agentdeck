// The Checks tab: a list of CI checks from gh pr checks or GitLab pipeline jobs.

import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme } from "herdr";

export function checksTab(v, t) {
  if (v.checkError) {
    return div().p(12).text_color(t.ansi1).child(v.checkError);
  }
  if (!v.checks.length) {
    return div().p(12).text_color(t.dim).child(v.loading ? "Loading checks…" : "No checks for this pull request.");
  }
  const stop = (_e, cx) => cx.stop_propagation();
  return div().size_full().relative()
    .child(v_flex().id("prdiff-checks").absolute().inset_0().overflow_y_scroll().children(v.checks.map((c, i) =>
      h_flex().id(`prdiff-check-${i}`).w_full().flex_none().px(14).py(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(checkDot(c, t))
        .child(div().flex_1().min_w(0).truncate().child(c.name))
        .child(div().text_size(11).text_color(t.dim).child(c.workflow))
        .child(div().id(`prdiff-check-open-${i}`).flex_none().px(6).py(3).text_size(11).rounded(5).bg(t.raised).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => v.openCheckInBrowser(c, cx)).child("Open ›")))))
    .child(Scrollbar.vertical("prdiff-checks").absolute().inset_0());
}

function checkDot(c, t) {
  const colors = { pass: t.ansi2, fail: t.ansi1, pending: t.accent, skip: t.dim, cancel: t.muted };
  const icons = { pass: "✓", fail: "✕", pending: "●", skip: "−", cancel: "✕" };
  return div().size(16).flex_none().rounded(8).flex().items_center().justify_center().text_size(10).font_semibold().text_color(colors[c.state] ?? t.dim).child(icons[c.state] ?? "?");
}
