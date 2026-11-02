// Markdown files, rendered. `mod.open:md` (a popup) lists the repo's .md files,
// changed ones first; Enter shows the pick in a pane right of the agent: one
// pane per tab, reloaded when the file changes. In the pane: j/k and arrows
// scroll, space/shift-space page, g/G top/bottom, r raw/rendered.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, run, props, closeOverlay, shared, setShared } from "herdr";

// Reads write nothing under .git, as in the changes panel.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const MD = ["*.md", "*.markdown", "*.mdx"];
const LINE = 40;

// Where the focused terminal is, as the changes panel finds it; from a
// markdown pane, the repo of the file it shows.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const shown = pane?.mod === "md" ? (shared("md.open") ?? {})[pane.tab] : null;
  if (shown) return { cwd: shown.root, on: shown.on };
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// Every letter of the filter, in order.
function matches(path, filter) {
  let i = 0;
  for (const c of path.toLowerCase()) if (c === filter[i]) i++;
  return i === filter.length;
}

// Raw view: the text as one code block, fenced longer than any run inside it.
function fenced(text) {
  const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((r) => r.length + 1)));
  return `${fence}markdown\n${text}\n${fence}`;
}

export default class Md extends View {
  init(_props, cx) {
    if (props()?.overlay) this.initPicker(cx);
    else this.initViewer(cx);
  }

  // ---- picker (popup)

  initPicker(cx) {
    this.files = null; this.filter = ""; this.at = 0; this.error = null;
    this.scroller = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Open a markdown file…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().toLowerCase(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.open(this.shown()[this.at]?.path));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    const { cwd, on } = location();
    this.on = on;
    cx.spawn(async (cx) => {
      try {
        const top = cwd ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }) : null;
        if (top?.code !== 0) { this.error = "Not in a git repository"; return; }
        const root = this.root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...MD]);
        const all = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...MD]);
        if (status.code !== 0 || all.code !== 0) throw new Error(status.stderr || all.stderr);
        const changed = new Map(), gone = new Set();
        for (const entry of status.stdout.split("\0").filter(Boolean)) {
          const xy = entry.slice(0, 2), path = entry.slice(3);
          if (xy.includes("D")) gone.add(path);
          else changed.set(path, xy === "??" ? "new" : "changed");
        }
        this.files = [
          ...[...changed].sort(([a], [b]) => a.localeCompare(b)).map(([path, mark]) => ({ path, mark })),
          ...all.stdout.split("\0").filter((p) => p && !changed.has(p) && !gone.has(p)).map((path) => ({ path, mark: null })),
        ];
      } catch (e) { this.error = `Cannot list files: ${e}`; }
      finally { cx.notify(); }
    });
  }

  shown() {
    return (this.files ?? []).filter((f) => matches(f.path, this.filter));
  }

  open(path) {
    const tab = focused()?.tab;
    if (!path || !tab) return;
    // Keep only tabs that still exist, so the shared map doesn't grow forever.
    const tabs = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
    const open = Object.fromEntries(Object.entries(shared("md.open") ?? {}).filter(([id]) => tabs.has(id)));
    setShared("md.open", { ...open, [tab]: { root: this.root, file: `${this.root}/${path}`, on: this.on } });
    closeOverlay(props()?.overlay);
    const pane = panes().find((p) => p.tab === tab && p.mod === "md");
    if (pane) run("pane.focus", { pane: pane.pane });
    else run("pane.split", { direction: "right", mod: "md", props: { tab } });
  }

  renderPicker() {
    const t = theme(), rows = this.shown();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    const row = (f, on) => {
      const parts = f.path.split("/"), name = parts.pop();
      return h_flex().mx(4).px(10).h(30).rounded(7).gap(8).items_center().cursor_pointer().when(on, (el) => el.bg(t.hover))
        .child(div().w(10).flex_none().text_size(10).text_color(f.mark === "new" ? t.done : t.blocked).child(f.mark ? "●" : ""))
        .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().flex_none().text_color(t.foreground).child(name)))
        .when(Boolean(f.mark), (el) => el.child(div().text_size(11).text_color(t.dim).child(f.mark)));
    };
    const note = this.error ?? (this.files === null ? "Loading…" : rows.length ? null : this.filter ? "No match" : "No markdown files here");
    return v_flex().id("md-picker").w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const c = e.modifiers.control;
        const step = e.key === "down" || (c && e.key === "n") ? 1 : e.key === "up" || (c && e.key === "p") ? -1 : 0;
        if (!step || !rows.length) return;
        this.at = (this.at + step + rows.length) % rows.length;
        this.scroller.scroll_to_item(this.at);
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Markdown")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(Boolean(note), (el) => el.child(div().px(10).py(6).text_color(t.dim).child(note ?? "")))
      .when(!note, (el) => el.child(
        v_virtual_list("md-files", rows.length, 30, (i) => rows[i].path, (range) => rows.slice(range.start, range.end).map((f, i) => row(f, range.start + i === this.at)))
          .track_scroll(this.scroller).on_item_click((path) => this.open(path)).w_full().h(Math.min(420, rows.length * 30))));
  }

  // ---- viewer (pane)

  initViewer(cx) {
    this.handle = cx.focus_handle();
    this.y = 0; this.viewH = 0; this.bodyH = 0; this.raw = false; this.text = undefined; this.showing = null;
    cx.timer.after(50, () => this.handle.focus());
    // ponytail: remote files are re-read every 2 s; watchFolder only works here.
    cx.timer.every(2000, (cx) => { const o = this.target(); if (o?.on) this.load(o, cx); });
  }

  // What this tab's pane shows: { root, file, on }.
  target() {
    return (shared("md.open") ?? {})[props()?.tab] ?? null;
  }

  load(o, cx) {
    const id = this.showing;
    cx.spawn(async (cx) => {
      let text = null;
      try { text = await readTextFile(o.file, { on: o.on }); } catch {}
      if (this.showing !== id || text === this.text) return;
      this.text = text;
      cx.notify();
    });
  }

  watch(o, cx) {
    if (o.on) return;
    const id = this.showing, dir = o.file.slice(0, o.file.lastIndexOf("/"));
    cx.spawn(async (cx) => {
      try {
        while (this.showing === id) {
          const changed = await watchFolder(dir);
          if (this.showing === id && changed.includes(o.file)) this.load(o, cx);
        }
      } catch {}
    });
  }

  scroll(dy, cx) {
    const y = Math.min(Math.max(0, this.y + dy), Math.max(0, this.bodyH - this.viewH));
    if (y === this.y) return;
    this.y = y;
    cx.notify();
  }

  key(e, cx) {
    const m = e.modifiers;
    if (m.platform || m.control || m.alt) return;
    const page = Math.max(LINE, this.viewH - LINE), k = e.key_char === "G" ? "G" : e.key;
    if (k === "r") { this.raw = !this.raw; this.y = 0; cx.notify(); }
    else {
      const dy = { j: LINE, down: LINE, k: -LINE, up: -LINE, space: m.shift ? -page : page, pagedown: page, pageup: -page, g: -Infinity, home: -Infinity, G: Infinity, end: Infinity }[k];
      if (dy === undefined) return;
      this.scroll(dy, cx);
    }
    cx.stop_propagation();
  }

  renderViewer(cx) {
    const t = theme(), o = this.target(), id = o ? `${o.on ?? ""}:${o.file}` : null;
    if (id !== this.showing) {
      this.showing = id; this.y = 0; this.text = undefined;
      if (o) { this.load(o, cx); this.watch(o, cx); }
    }
    const parts = o ? o.file.slice(o.root.length + 1).split("/") : [], name = parts.pop() ?? "";
    const note = !o ? "Open a file with ⌘⇧M" : this.text === undefined ? "Loading…" : this.text === null ? "Can't read this file (gone, or over 1 MiB)" : null;
    const thumb = this.bodyH > this.viewH && this.viewH > 0;
    return v_flex().id("md-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(14).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(32).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().flex_none().child(name)))
        .when(this.raw, (el) => el.child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child("raw")))
        .child(div().text_size(11).text_color(t.dim).child("j/k · space · g/G · r")))
      .child(div().id("md-port").flex_1().min_h(0).relative().overflow_hidden()
        .on_size_change((s, cx) => { this.viewH = s.height; this.scroll(0, cx); })
        .on_scroll_wheel((e, cx) => this.scroll(-e.delta.y, cx))
        .child(div().id("md-body").absolute().left(0).right(0).top(-this.y).px(22).py(16)
          .on_size_change((s, cx) => { this.bodyH = s.height; this.scroll(0, cx); })
          .child(note ? div().text_color(t.dim).child(note) : TextView.markdown("md-text", this.raw ? fenced(this.text) : this.text).selectable(true)))
        .when(thumb, (el) => el.child(div().absolute().right(2).w(4).rounded(2).bg(t.border)
          .top(this.y / this.bodyH * this.viewH).h(Math.max(24, this.viewH * this.viewH / this.bodyH)))));
  }

  render(cx) {
    return props()?.overlay ? this.renderPicker() : this.renderViewer(cx);
  }
}
