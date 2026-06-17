#!/usr/bin/env bash
# Cursor IDE installer for transcodes-guard.
#
# Usage:
#   ./install.sh                          # project-scope: writes <repo>/.cursor/hooks.json
#   ./install.sh --user                   # user-scope: writes ~/.cursor/hooks.json
#   ./install.sh --target <dir>           # write to a custom workspace root
#
# What it does:
#  1. Resolves PLUGIN_ROOT to this script's absolute directory.
#  2. Substitutes __TRANSCODES_GUARD_ROOT__ in .cursor/hooks.json and mcp.json
#     with that absolute path.
#  3. Copies the rendered hooks.json to <target>/.cursor/hooks.json.
#  4. Merges mcp.json into <target>/.cursor/mcp.json (or ~/.cursor/mcp.json
#     for --user) — if a file already exists, prints the line the user must
#     add manually instead of clobbering their other servers.
#
# Cursor does not auto-discover plugin directories; placing hooks.json into
# .cursor/ is required for the gate to fire. See README.md for details.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mode="project"
target=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      mode="user"
      target="$HOME"
      shift
      ;;
    --target)
      mode="project"
      target="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$mode" == "project" && -z "$target" ]]; then
  target="$(pwd)"
fi

cursor_dir="$target/.cursor"
mkdir -p "$cursor_dir"

# Render hooks.json with absolute plugin root.
sed "s|__TRANSCODES_GUARD_ROOT__|$PLUGIN_ROOT|g" \
  "$PLUGIN_ROOT/.cursor/hooks.json" > "$cursor_dir/hooks.json"
echo "wrote $cursor_dir/hooks.json"

# mcp.json: merge-aware. Refuse to clobber an existing file.
rendered_mcp="$(sed "s|__TRANSCODES_GUARD_ROOT__|$PLUGIN_ROOT|g" "$PLUGIN_ROOT/mcp.json")"
if [[ -e "$cursor_dir/mcp.json" ]]; then
  echo ""
  echo "$cursor_dir/mcp.json already exists — not overwriting."
  echo "Add this entry under \"mcpServers\" manually:"
  echo ""
  echo "$rendered_mcp"
else
  echo "$rendered_mcp" > "$cursor_dir/mcp.json"
  echo "wrote $cursor_dir/mcp.json"
fi

echo ""
echo "Done. Restart Cursor to pick up the new hooks."
echo "Don't forget: export TRANSCODES_TOKEN=... before launching Cursor."
