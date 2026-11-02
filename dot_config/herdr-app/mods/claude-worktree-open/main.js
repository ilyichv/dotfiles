// Open worktree from a key: mod.open can't pass claude-worktree its action, so this
// opens it with one and closes.

import { View, div } from "gpui-kit";
import { openOverlay, closeOverlay, props } from "herdr";

export default class ClaudeWorktreeOpen extends View {
  init() {
    openOverlay({ mod: "claude-worktree", kind: "dialog", width: 560, height: 480, props: { action: "open" } });
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  render() {
    return div();
  }
}
