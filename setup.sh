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
"$PY" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true
if "$PY" -m pip install --quiet edge-tts; then
  echo "  edge-tts ready"
else
  echo "  ! edge-tts install failed (network?) — setup will continue; run scripts/doctor.mjs"
fi

# 3) Default config + data dir ----------------------------------------------
mkdir -p "$VOICE_HOME/cache"
if [ ! -f "$VOICE_HOME/config.json" ]; then
  cat > "$VOICE_HOME/config.json" <<'JSON'
{
  "voice": "zh-CN-XiaoxiaoNeural",
  "voiceEn": "en-US-AriaNeural",
  "rate": "+0%",
  "volume": "+0%"
}
JSON
  echo "  wrote config.json (Codex voices: zh XiaoXiao / en Aria)"
fi
if [ ! -f "$VOICE_HOME/hooks.json" ]; then
  cat > "$VOICE_HOME/hooks.json" <<'JSON'
{
  "enabled": true,
  "start": true,
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

# 4) Pre-generate opening-cue cache for each agent's voices (zh + en) --------
# The opening rule is shared (scripts/opening.mjs); only the voice differs.
# Chinese voices get the Chinese phrases, English voices the English phrases.
CLAUDE_VOICE_ZH="$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const m=s.match(/CLAUDE_VOICE_ZH = "([^"]+)"/);process.stdout.write(m?m[1]:"zh-CN-YunxiNeural")' "$SKILL_DIR/scripts/claude-hook.mjs")"
CLAUDE_VOICE_EN="$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const m=s.match(/CLAUDE_VOICE_EN = "([^"]+)"/);process.stdout.write(m?m[1]:"en-US-GuyNeural")' "$SKILL_DIR/scripts/claude-hook.mjs")"
CODEX_VOICE_ZH="$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(c.voice||"zh-CN-XiaoxiaoNeural")}catch{process.stdout.write("zh-CN-XiaoxiaoNeural")}' "$VOICE_HOME/config.json")"
CODEX_VOICE_EN="$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(c.voiceEn||"en-US-AriaNeural")}catch{process.stdout.write("en-US-AriaNeural")}' "$VOICE_HOME/config.json")"
echo "Generating opening cache (zh: $CLAUDE_VOICE_ZH/$CODEX_VOICE_ZH, en: $CLAUDE_VOICE_EN/$CODEX_VOICE_EN)..."
gen() { # voice type text  — never fatal: a failed synth (e.g. no network) just warns.
  local out="$VOICE_HOME/cache/opening-$2-$1.mp3"
  [ -f "$out" ] && return 0
  if "$PY" -m edge_tts --voice "$1" --text "$3" --write-media "$out" 2>/dev/null; then
    echo "  cached opening-$2 ($1)"
  else
    echo "  ! skip opening-$2 ($1): synth failed (network?) — will live-synth at runtime"
  fi
  return 0
}
for V in "$CLAUDE_VOICE_ZH" "$CODEX_VOICE_ZH"; do
  gen "$V" question    "我看看"
  gen "$V" instruction "好，这就做"
  gen "$V" other       "收到"
done
for V in "$CLAUDE_VOICE_EN" "$CODEX_VOICE_EN"; do
  gen "$V" question    "Let me look"
  gen "$V" instruction "On it"
  gen "$V" other       "Got it"
done

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
Decision-first: if the result needs the user to decide/choose/confirm/answer,
lead with what they must do, e.g. <<voice: 要你定：现在能不能重启？>>.
EOF

# 7) Self-check + audible confirmation ----------------------------------------
echo
echo "Verifying install..."
node "$SKILL_DIR/scripts/doctor.mjs" || true
echo
echo "Playing a test sound — you should hear it:"
node "$SKILL_DIR/scripts/speak.mjs" text --text "安装完成，听到这句话说明声音正常。Setup complete." --full \
  || echo "  Test sound FAILED — see the doctor output above for the cause."
echo
echo "Done. Restart your agent session for the hooks to take effect."
