// A pull/merge request, opened from the PR board as a floating window.
// Shows the unified diff and lets you comment back, all through the repo's own
// CLI (gh for GitHub, glab for GitLab) so no token lives in the app.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { props, theme, exec, notify, closeOverlay, settings } from "herdr";

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
// Mirrors the changes mod's renderer.
function diffRows(lines) {
    let old = 0, next = 0;
    return lines.map((line) => {
        const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
        if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: line, number: null }; }
        const kind = line[0];
        if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
        if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
        if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
        return { kind: "", number: null, text: line };
     });
}

function chipOf(pr) {
    if (pr.draft) return { text: "Draft", color: "dim" };
    const d = String(pr.decision ?? "");
    if (d === "APPROVED") return { text: "Approved", color: "done" };
    if (d === "mergeable") return { text: "Ready to merge", color: "done" };
    if (d === "CHANGES_REQUESTED") return { text: "Changes requested", color: "blocked" };
    if (d === "conflict" || d === "need_rebase") return { text: "Conflicts", color: "blocked" };
    if (d === "REVIEW_REQUIRED" || d === "not_approved") return { text: "Needs review", color: "working" };
    return { text: "Open", color: "muted" };
}

export default class PrDiff extends View {
    init(_props, cx) {
        const p = props() || {};
        this.pr = p.pr || { num: "" };
        this.root = p.cwd; this.on = p.on; this.kind = p.kind || "gh";
        this.overlay = p.overlay;
        this.rows = []; this.diffWidth = 300; this.error = null; this.loading = false;
        this.note = null; this.errorNote = null;
        this.handle = cx.focus_handle();
        this.typing = false; this.message = ""; this.busy = false;
        this.input = InputState.new({ placeholder: "Comment on #" + this.pr.num + " \u00b7 Enter to post" });
        this.input.on("change", (_e, cx) => { this.message = this.input.value(); if (this.typing) cx.notify(); });
        this.input.on("submit", (_e, cx) => this.postComment(cx));
        this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
        this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
        this.refresh(cx);
     }

    async diffText() {
        const args = [this.kind === "glab" ? "mr" : "pr", "diff", String(this.pr.num), "--color", "never"];
        const cmd = this.kind === "glab" ? "glab" : "gh";
        const r = await exec(cmd, args, { cwd: this.root, on: this.on, timeout: 60000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || cmd + " diff failed").trim());
        return r.stdout;
     }

    refresh(cx) {
        if (this.loading) return;
        if (!this.pr.num || !this.root) { this.error = "Open a pull request from the Pull requests panel."; return; }
        this.loading = true; this.error = null;
        cx.spawn(async (cx) => {
            try {
                const text = (await this.diffText()).replace(/\n$/, "");
                let rows = text ? diffRows(text.split("\n")).slice(0, 4000) : [];
                rows = rows.map((r) => (r.text.length > 4000 ? { ...r, text: r.text.slice(0, 4000) + "\u2026" } : r));
                this.rows = rows;
                this.diffWidth = Math.max(300, ...rows.map((r) => (r.text.length + 1) * 7 + 50));
             } catch (e) {
                this.error = String(e && e.message ? e.message : e);
             } finally {
                this.loading = false;
                cx.notify();
             }
         });
     }

    postComment(cx) {
        const msg = (this.input.value() || "").trim();
        if (!msg || this.busy || this.loading) return;
        this.busy = true; this.errorNote = null;
        cx.spawn(async (cx) => {
            try {
                const args = this.kind === "glab"
                     ? ["mr", "note", String(this.pr.num), "-m", msg]
                     : ["pr", "comment", String(this.pr.num), "--body", msg];
                const cmd = this.kind === "glab" ? "glab" : "gh";
                const r = await exec(cmd, args, { cwd: this.root, on: this.on, timeout: 60000 });
                if (r.code !== 0) throw new Error((r.stderr || r.stdout || cmd + " failed").trim());
                this.input.set_value(""); this.message = "";
                this.note = "Comment posted.";
                notify({ title: "Comment posted", body: "#" + this.pr.num + " \u00b7 " + (this.pr.title || ""), level: "success" });
             } catch (e) {
                this.errorNote = String(e && e.message ? e.message : e);
             } finally {
                this.busy = false;
                cx.notify();
             }
         });
     }

    diffRow(r, t) {
        if (r.kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(r.text);
        return h_flex()
             .w_full().h(20).flex_none().gap(10)
             .when(r.kind === "+", (e) => e.bg(t.ansi2 + "18"))
             .when(r.kind === "-", (e) => e.bg(t.ansi1 + "18"))
             .child(div().w(30).flex_none().text_right().text_color(t.dim).child(r.number === null ? "" : String(r.number)))
             .child(div().flex_1().min_w(0).truncate().child(r.text || " "));
     }

    render() {
        const t = theme();
        const pr = this.pr;
        const chip = chipOf(pr);
        const branchLine = `${pr.branch}` + (pr.base && pr.base !== pr.branch ? ` \u2192 ${pr.base}` : "");
        const enabled = Boolean(this.message?.trim() && !this.busy && !this.loading);
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
             // Header: title · #num · branch → base · decision · refresh · close
             .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
                 .child(div().min_w(0).flex_1().truncate().font_semibold().child(pr.title || ("PR #" + pr.num)))
                 .child(div().px(4).py(1).rounded(5).bg((t[chip.color] ?? t.muted) + "22").text_size(11).font_semibold().text_color(t[chip.color] ?? t.muted).child(chip.text))
                 .child(div().text_size(11).text_color(t.dim).child(branchLine))
                 .child(div().flex_1())
                 .child(div().id("prdiff-refresh").text_size(14).px(4).rounded(6).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip("Refresh diff").on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { this.refresh(cx); cx.notify(); }).child("\u21bb"))
                 .child(div().id("prdiff-close").text_size(14).px(4).rounded(6).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip("Close").on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e) => closeOverlay(this.overlay)).child("\u2715")))
             // Body: the diff
             .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
                 .child(div().id("prdiff-x").size_full().overflow_x_scrollbar()
                     .child(div().w_full().min_w(this.diffWidth).h_full()
                         .child(v_virtual_list("prdiff", this.rows.length, 20, (i) => String(i), (range) => this.rows.slice(range.start, range.end).map((r) => this.diffRow(r, t))).size_full())))
                 .child(Scrollbar.vertical("prdiff").viewport_from_layout().absolute().inset_0())
                 .when(Boolean(this.error), (e) => e.child(div().absolute().top(8).left(12).text_size(12).text_color(t.ansi1).child(this.error)))
                 .when(!this.rows.length && !this.error, (e) => e.child(div().absolute().top(8).left(12).text_size(12).text_color(t.dim).child(this.loading ? "Loading diff\u2026" : "No diff available"))))
             // Footer notes
             .when(Boolean(this.note) || Boolean(this.errorNote), (e) => e.child(div().px(12).pt(4).text_size(11).text_color(this.errorNote ? t.ansi1 : t.done).child(this.errorNote || this.note)))
             // Footer: comment
             .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
                 .child(div().id("prdiff-comment").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
                 .child(div().id("prdiff-post").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.postComment(cx)).child(this.busy ? "Posting\u2026" : "Comment")));
     }
}
