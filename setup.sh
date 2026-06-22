#!/usr/bin/env bash
# Voice Reply — one-command setup. Idempotent: safe to re-run.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICE_HOME="$HOME/.voice-reply"
VENV="$SKILL_DIR/.venv"
PY="$VENV/bin/python"

echo "Voice Reply setup"
echo "  skill dir : $SKILL_DIR"
echo "  data dir  : $VOICE_HOME"
echo

# 1) Prerequisites -----------------------------------------------------------
command -v node    >/dev/null || { echo "ERROR: node is required."; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 is required."; exit 1; }

PLAYER=""
for p in afplay ffplay mpv mpg123 cvlc paplay aplay; do
  if command -v "$p" >/dev/null 2>&1; then PLAYER="$p"; break; fi
done
if [ -z "$PLAYER" ]; then
  echo "WARNING: no audio player found. Install one of: ffplay (ffmpeg), mpv, mpg123."
else
  echo "  player    : $PLAYER"
fi

# 2) Python venv + edge-tts --------------------------------------------------
if [ ! -x "$PY" ]; then
  echo "Creating virtualenv..."
  python3 -m venv "$VENV"
fi
echo "Installing edge-tts..."
"$PY" -m pip install --quiet --upgrade pip >/dev/null
"$PY" -m pip install --quiet edge-tts
echo "  edge-tts ready"

# 3) Default config + data dir ----------------------------------------------
mkdir -p "$VOICE_HOME/cache"
if [ ! -f "$VOICE_HOME/config.json" ]; then
  cat > "$VOICE_HOME/config.json" <<'JSON'
{
  "voice": "zh-CN-XiaoxiaoNeural",
  "rate": "+0%",
  "volume": "+0%"
}
JSON
  echo "  wrote config.json (Codex voice: female XiaoXiao)"
fi
if [ ! -f "$VOICE_HOME/hooks.json" ]; then
  cat > "$VOICE_HOME/hooks.json" <<'JSON'
{
  "enabled": true,
  "start": false,
  "stop": true,
  "stopMode": "summary",
  "maxResultChars": 60,
  "maxSummarySentences": 1,
  "nodeEvents": false,
  "texts": {
    "UserPromptSubmit": "收到",
    "Stop": "已完成，请查看结果。",
    "StopSummaryPrefix": "已完成。"
  }
}
JSON
  echo "  wrote hooks.json"
fi

# 4) Pre-generate opening-cue cache for the configured Claude voice ----------
VOICE="$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const m=s.match(/CLAUDE_VOICE = "([^"]+)"/);process.stdout.write(m?m[1]:"zh-CN-YunxiNeural")' "$SKILL_DIR/scripts/claude-hook.mjs")"
echo "Generating opening cache (voice: $VOICE)..."
gen() {
  local out="$VOICE_HOME/cache/opening-$1-$VOICE.mp3"
  [ -f "$out" ] && return 0
  "$PY" -m edge_tts --voice "$VOICE" --text "$2" --write-media "$out" && echo "  cached opening-$1"
}
gen question    "我看看"
gen instruction "好，这就做"
gen other       "收到"

# 5) Register hooks (asks first) --------------------------------------------
echo
if [ -t 0 ]; then
  read -r -p "Register Claude Code + Codex hooks now? [y/N] " ans
else
  ans="${VOICE_REPLY_AUTO_HOOKS:-n}"
fi
if [[ "$ans" =~ ^[Yy]$ ]]; then
  node "$SKILL_DIR/scripts/manage-hooks.mjs" add "$SKILL_DIR"
  echo "  Restart your agent session for hooks to load."
else
  echo "  Skipped. To register later: node scripts/manage-hooks.mjs add \"$SKILL_DIR\""
fi

# 6) Marker rule reminder ----------------------------------------------------
cat <<EOF

Last step (manual): add the result-marker rule to your agent instructions so
the model writes a spoken summary each turn.

  Claude Code -> ~/.claude/CLAUDE.md
  Codex       -> ~/.codex/AGENTS.md

Rule: end every reply with one line — <<voice: status + core info + next step>>
(target <=40 chars; ear-friendly; no code/paths/secrets).

Done.
EOF
