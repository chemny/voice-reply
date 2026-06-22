#!/usr/bin/env bash
# Voice Reply — dry-run regression checks (no audio, no network).
set -uo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$SKILL_DIR/scripts"
fail=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=1; }

echo "1. syntax"
for f in speak claude-hook codex-hook codex-notify manage-hooks; do
  if node --check "$S/$f.mjs" 2>/dev/null; then ok "$f.mjs"; else bad "$f.mjs"; fi
done

echo "2. speak.mjs dry-run"
node "$S/speak.mjs" done --dry-run >/dev/null 2>&1 && ok "speak done" || bad "speak done"
node "$S/speak.mjs" play --file /tmp/none.mp3 --dry-run >/dev/null 2>&1 && ok "speak play" || bad "speak play"

echo "3. codex-hook prefers <<voice:>> marker"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"一堆细节。\n\n<<voice: 对>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '"对"' && ok "marker priority" || bad "marker priority"

echo "4. codex-hook falls back to scoring without marker"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"已完成。修复了参数解析并通过校验。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && ok "scoring fallback" || bad "scoring fallback"

echo "5. opening classifier (Claude)"
cls=$(node -e '
const I=/(帮我|执行|加上|改一|改成|优化|修复|生成|创建|删除|安装|部署|搭建)/;
const Q=/(？|\?|吗|呢|是不是|能不能|可以吗|对吗|对还是错|怎么|为什么|如何|多少|哪个|什么)/;
const t=process.argv[1];
console.log(I.test(t)?"instruction":Q.test(t)?"question":"other");' "帮我改一下")
[ "$cls" = "instruction" ] && ok "classify instruction" || bad "classify instruction"

echo
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
