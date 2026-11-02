import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, home, readTextFile, watchFolder } from "herdr";

// Claude plan limits, written by statusline.sh (Claude Code's statusLine).
const LIMITS = { five_hour: "5h", seven_day: "wk", spend_limit: "spend" };
const CLAUDE = "#D97757";

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.limits = {};
    const dir = `${home()}/.cache/claude-usage`;
    cx.spawn(async (cx) => {
      for (;;) {
        try { this.limits = JSON.parse(await readTextFile(`${dir}/limits.json`)) ?? {}; } catch {}
        cx.notify();
        await watchFolder(dir);
      }
    });
  }

  // How much of each limit is left; a window past its reset is full again.
  usage() {
    const rows = Object.entries(this.limits).filter(([, l]) => typeof l?.used_percentage === "number");
    if (!rows.length) return [];
    return [h_flex().gap(6).items_center().child(image("icons/claude.svg").size(13)).children(rows.map(([k, l]) => {
      const left = l.resets_at * 1000 < Date.now() ? 100 : Math.max(0, 100 - Math.round(l.used_percentage));
      return h_flex().id(`claude-${k}`).gap(6).items_center()
        .tooltip(`Resets ${new Date(l.resets_at * 1000).toLocaleString()}`)
        .child(div().w(90).h(4).rounded(2).bg(`${CLAUDE}33`).child(div().h_full().w(0.9 * left).rounded(2).bg(CLAUDE)))
        .child(rows.length > 1 ? `${LIMITS[k] ?? k} ${left}%` : `${left}%`);
    }))];
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .children(this.usage())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
