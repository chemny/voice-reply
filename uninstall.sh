#!/usr/bin/env bash
# Voice Reply — remove hooks from agent configs. Leaves ~/.voice-reply intact.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SKILL_DIR/scripts/manage-hooks.mjs" remove "$SKILL_DIR"

echo
echo "Hooks removed (backups saved as <file>.bak)."
echo "Config, cache, and logs in ~/.voice-reply were kept."
echo "To remove them too:  rm -rf ~/.voice-reply"
echo "Restart your agent session to stop the voice."
