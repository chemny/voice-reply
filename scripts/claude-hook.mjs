#!/usr/bin/env node
// Claude Code 专用钩子适配器。
// 把 Claude Code 的 hook 输入（stdin JSON）转换成 codex-hook.mjs 认识的字段，
// 再复用 codex-hook.mjs 里全部的摘要清洗 / 脱敏 / 朗读逻辑。
//
// 差异点：
//   - Codex 在 Stop 时直接给 last_assistant_message；
//   - Claude Code 只给 transcript_path（一个 JSONL），需要自己从末尾回溯
//     找到最后一条带 text 的 assistant 消息，拼成正文再交给 codex-hook。
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { playOpening, playDetached, detectLang, resolveVoice } from "./opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const codexHook = join(__dirname, "codex-hook.mjs");
const speakScript = join(__dirname, "speak.mjs");
const LOG_PATH = join(homedir(), ".voice-reply", "hook.log");

// 轻量日志，便于排查（与 codex-hook 对称）。失败静默，绝不影响主流程。
function log(event, extra) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), agent: "claude", event, ...extra }) + "\n");
  } catch {
    // ignore
  }
}

// Claude Code 专用音色：中文男声 + 英文男声（保持同一"性别人设"，听感一致）。
// 按消息/回答的语种自动选用。想换声音改这两行即可。
const CLAUDE_VOICE_ZH = "zh-CN-YunxiNeural";
const CLAUDE_VOICE_EN = "en-US-GuyNeural";
const CLAUDE_VOICES = { zh: CLAUDE_VOICE_ZH, en: CLAUDE_VOICE_EN };

// 回答里"为耳朵写的"播报摘要标记：<<voice: 已完成…，记得…>>
// 优先朗读它；抓不到再退回 codex-hook 的关键词打分兜底。
const VOICE_MARKER = /<<\s*voice\s*:\s*([\s\S]*?)>>/gi;
const MARKER_MAX_CHARS = 60;

// 开场提示规则现在在共享模块 opening.mjs，Claude 和 Codex 共用。

function readStdinJson() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// 从 Claude Code transcript JSONL 末尾回溯，取最后一条有文本的 assistant 消息。
function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return "";
  let content = "";
  try {
    content = readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }
  const lines = content.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

// 从回答正文里取出最后一个 <<voice: ...>> 标记的内容（为耳朵写的那句）。
function extractVoiceMarker(text) {
  if (!text) return "";
  const re = new RegExp(VOICE_MARKER);
  let match;
  let last = "";
  while ((match = re.exec(text)) !== null) last = match[1];
  const cleaned = last.replace(/\s+/g, " ").trim();
  if (!isUsefulVoiceText(cleaned)) return "";
  if (cleaned.length <= MARKER_MAX_CHARS) return cleaned;
  return [...cleaned].slice(0, MARKER_MAX_CHARS).join("").replace(/[，。,.!?！？、\s]+$/u, "") + "。";
}

function isUsefulVoiceText(text) {
  const compact = String(text || "").replace(/[，。,.!?！？、；;:：'"“”‘’()\[\]{}<>《》…\-\s]/g, "");
  if (!compact) return false;
  if (/^[.。…]+$/.test(text.trim())) return false;
  return compact.length > 0; // \u975e\u7a7a\u5373\u6709\u6548\uff1a\u4fdd\u7559\u5355\u5b57\u7b54\u6848\uff08\u5bf9/\u9519/\u80fd\u3001\u9009 B\uff09
}

// 直接朗读标记内容，绕过打分逻辑。音色按标记文字的语种选（中文男声 / 英文男声）。
function speakDirect(text) {
  const voice = resolveVoice(CLAUDE_VOICES, detectLang(text));
  playDetached(process.execPath, [speakScript, "text", "--text", text, "--full"], {
    VOICE_REPLY_VOICE: voice,
  });
}

// 把转换后的 Codex 形态 payload 交给 codex-hook.mjs（它负责摘要+朗读）。
// 音色按回答文字的语种选，一路通过环境变量传到 speak.mjs。
function delegate(payload, text) {
  const voice = resolveVoice(CLAUDE_VOICES, detectLang(text));
  spawnSync(process.execPath, [codexHook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 30000,
    env: { ...process.env, VOICE_REPLY_VOICE: voice },
  });
}

function main() {
  const input = readStdinJson();
  const event = input.hook_event_name || process.argv[2] || "";

  if (event === "UserPromptSubmit") {
    // 按你发的原文粗判语种 + 类型，播一句即时回应（共用 opening.mjs 规则，后台、缓存）。
    const cue = playOpening(input, CLAUDE_VOICES);
    log("open", { cue: cue.key, lang: cue.lang });
    return;
  }

  if (event === "Stop" || event === "SubagentStop") {
    const message = lastAssistantText(input.transcript_path);
    const marker = extractVoiceMarker(message);
    if (marker) {
      // 我主动写的播报摘要：直接念，最准。
      log("stop", { source: "marker" });
      speakDirect(marker);
      return;
    }
    // 没写标记时退回关键词打分兜底。
    log("stop", { source: "fallback" });
    delegate({ hook_event_name: "Stop", last_assistant_message: message }, message);
    return;
  }
}

main();
