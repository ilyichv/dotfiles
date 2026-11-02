#!/bin/sh
# Claude Code statusLine: saves plan limits for Herdr's my-status bar, prints nothing.
d="$HOME/.cache/claude-usage"; t="$d/.tmp$$"
mkdir -p "$d"
jq -ce '.rate_limits // empty' > "$t" && mv "$t" "$d/limits.json" || rm -f "$t"
