#!/usr/bin/env node
// Claude Code 专用钩子适配器。
// 把 Claude Code 的 hook 输入（stdin JSON）转换成 codex-hook.mjs 认识的字段，
// 再复用 codex-hook.mjs 里全部的摘要清洗 / 脱敏 / 朗读逻辑。
//
// 差异点：
//   - Codex 在 Stop 时直接给 last_assistant_message；
//   - Claude Code 只给 transcript_path（一个 JSONL），需要自己从末尾回溯
//     找到最后一条带 text 的 assistant 消息，拼成正文再交给 codex-hook。
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

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

// Claude Code 专用音色（男声）。Codex 不经过本脚本，仍用它自己的女声。
// 想换 Claude 的声音，只改这一行即可，例如 zh-CN-YunyangNeural / zh-CN-YunjianNeural。
const CLAUDE_VOICE = "zh-CN-YunxiNeural";

// 回答里"为耳朵写的"播报摘要标记：<<voice: 已完成…，记得…>>
// 优先朗读它；抓不到再退回 codex-hook 的关键词打分兜底。
const VOICE_MARKER = /<<\s*voice\s*:\s*([\s\S]*?)>>/gi;
const MARKER_MAX_CHARS = 60;

// 开场提示：脚本在我读懂消息之前触发，只能按关键词粗判输入类型，
// 给一句不机械的即时回应（播不出"对/错"，那要等我想完后由结果播报来说）。
// 判不准（other）就用兜底「收到」，绝不硬猜。
// 这几句是固定词，已预合成成 mp3 缓存，开场直接本地播放，保证 3 秒内出声。
// 缓存文件名带音色：换 CLAUDE_VOICE 后旧缓存自动失效，绝不会放出上一个音色。
const CACHE_DIR = join(homedir(), ".voice-reply", "cache");
const OPENING = {
  instruction: { text: "好，这就做", key: "instruction" },
  question: { text: "我看看", key: "question" },
  other: { text: "收到", key: "other" },
};

// 缓存文件名 = 类型 + 音色，确保改音色后不命中旧文件。
function cacheFile(cue) {
  return join(CACHE_DIR, `opening-${cue.key}-${CLAUDE_VOICE}.mp3`);
}
const INSTRUCTION_RE = /(帮我|帮忙|改一|改成|改个|换成|执行|加上|加个|加一|写个|写一|生成|创建|新建|删除|删掉|去掉|修复|优化|调整|设置|配置|做个|做一|给我|实现|部署|安装|运行|跑一|整理|翻译|画一|画个|开发|搭建)/;
const QUESTION_RE = /(？|\?|吗|呢|是不是|能不能|可不可以|可以吗|对吗|对不对|对还是错|怎么|为什么|为啥|如何|多少|哪个|哪些|哪里|什么|是否|有没有)/;

function openingCue(prompt) {
  const text = String(prompt || "");
  if (INSTRUCTION_RE.test(text)) return OPENING.instruction;
  if (QUESTION_RE.test(text)) return OPENING.question;
  return OPENING.other;
}

// 后台 fire-and-forget 启动，立刻返回，不阻塞 hook（声音在后台放，我同时干活）。
function playDetached(command, args, extraEnv) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    child.unref();
  } catch {
    // 起不来就算了，不影响主流程。
  }
}

// 优先播放预缓存的 mp3（离线、瞬时）；缓存缺失才退回联网合成。两者都后台异步、跨平台。
function playOpening(cue) {
  const cached = cacheFile(cue);
  if (existsSync(cached)) {
    playDetached(process.execPath, [speakScript, "play", "--file", cached]);
    return;
  }
  playDetached(process.execPath, [speakScript, "text", "--text", cue.text, "--full"], {
    VOICE_REPLY_VOICE: CLAUDE_VOICE,
  });
}

// Claude Code 专用音色（男声）。Codex 不经过本脚本，仍用它自己的女声。
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
  if (cleaned.length <= MARKER_MAX_CHARS) return cleaned;
  return [...cleaned].slice(0, MARKER_MAX_CHARS).join("").replace(/[，。,.!?！？、\s]+$/u, "") + "。";
}

// 直接朗读标记内容，绕过打分逻辑，仍注入 Claude 专用音色。后台异步，不阻塞。
function speakDirect(text) {
  playDetached(process.execPath, [speakScript, "text", "--text", text, "--full"], {
    VOICE_REPLY_VOICE: CLAUDE_VOICE,
  });
}

// 把转换后的 Codex 形态 payload 交给 codex-hook.mjs（它负责摘要+朗读）。
function delegate(payload) {
  spawnSync(process.execPath, [codexHook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 30000,
    // 通过环境变量把 Claude 专用音色一路传到 speak.mjs。
    env: { ...process.env, VOICE_REPLY_VOICE: CLAUDE_VOICE },
  });
}

function main() {
  const input = readStdinJson();
  const event = input.hook_event_name || process.argv[2] || "";

  if (event === "UserPromptSubmit") {
    // 按你发的原文粗判类型，播一句即时回应（优先缓存，保证 3 秒内出声）。
    const cue = openingCue(input.prompt);
    log("open", { cue: cue.key });
    playOpening(cue);
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
    delegate({ hook_event_name: "Stop", last_assistant_message: message });
    return;
  }
}

main();
