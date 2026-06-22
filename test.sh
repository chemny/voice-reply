#!/usr/bin/env bash
# Voice Reply — dry-run regression checks (no audio, no network).
set -uo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$SKILL_DIR/scripts"
fail=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=1; }

echo "1. syntax"
for f in speak opening claude-hook codex-hook codex-notify manage-hooks doctor; do
  if node --check "$S/$f.mjs" 2>/dev/null; then ok "$f.mjs"; else bad "$f.mjs"; fi
done

echo "2. speak.mjs dry-run"
node "$S/speak.mjs" done --dry-run >/dev/null 2>&1 && ok "speak done" || bad "speak done"
node "$S/speak.mjs" play --file /tmp/none.mp3 --dry-run >/dev/null 2>&1 && ok "speak play" || bad "speak play"

echo "3. codex-hook prefers <<voice:>> marker (incl. single-char answer)"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"一堆细节。\n\n<<voice: 对>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '"对"' && ok "single-char marker kept" || bad "single-char marker kept"

echo "3b. codex-hook rejects punctuation-only marker (falls back, not spoken literally)"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"改好了，记得重启。\n\n<<voice: ...>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '\.\.\.' && bad "reject punct-only marker" || ok "reject punct-only marker"

echo "4. codex-hook falls back to scoring without marker"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"已完成。修复了参数解析并通过校验。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && ok "scoring fallback" || bad "scoring fallback"

echo "5. shared opening rule + language detection (opening.mjs)"
# prints "<lang> <key>" for a prompt
oc() { node --input-type=module -e "import {detectLang,openingCue} from '$S/opening.mjs'; const l=detectLang(process.argv[1]); console.log(l, openingCue(process.argv[1], l).key)" "$1"; }
[ "$(oc '帮我改一下')"        = "zh instruction" ] && ok "zh instruction" || bad "zh instruction"
[ "$(oc '这样对吗')"          = "zh question" ]    && ok "zh question"    || bad "zh question"
[ "$(oc '我跟你说个事')"      = "zh other" ]       && ok "zh other"       || bad "zh other"
[ "$(oc 'fix this bug')"      = "en instruction" ] && ok "en instruction" || bad "en instruction"
[ "$(oc 'is this right?')"    = "en question" ]    && ok "en question"    || bad "en question"
[ "$(oc 'just an FYI')"       = "en other" ]       && ok "en other"       || bad "en other"

echo
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
