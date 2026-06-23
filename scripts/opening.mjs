#!/usr/bin/env node
// 开场提示 + 语种判定——通用规则（Claude / Codex / OpenClaw 共用，单一事实源）。
//
// hook 在模型读懂消息之前触发，只能按关键词粗判输入类型，给一句不机械的即时回应；
// 播不出"对/错"那种答案，真答案留到结果播报。判不准就兜底（收到 / Got it），绝不硬猜。
//
// 语言：按每条消息的文字自动判中/英（有中文字→中文，否则→英文），各用各的固定词、
// 分类关键词和音色。可在 ~/.voice-reply/hooks.json 用 "lang":"zh"|"en" 锁定整段。
//
// 固定词已预合成成 mp3 缓存（按音色命名），开场直接本地播放、后台异步、跨平台。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "speak.mjs");
const CACHE_DIR = join(homedir(), ".voice-reply", "cache");
const CONFIG = join(homedir(), ".voice-reply", "hooks.json");

// 中英两套语言包：开场固定词 + 分类关键词。改词/调规则只改这里，三端同步。
const PACKS = {
  zh: {
    instruction: { text: "好，这就做", key: "instruction" },
    question: { text: "我看看", key: "question" },
    other: { text: "收到", key: "other" },
    instructionRe: /(帮我|帮忙|改一|改成|改个|换成|执行|加上|加个|加一|写个|写一|生成|创建|新建|删除|删掉|去掉|修复|优化|调整|设置|配置|做个|做一|给我|实现|部署|安装|运行|跑一|整理|翻译|画一|画个|开发|搭建)/,
    questionRe: /(？|\?|吗|呢|是不是|能不能|可不可以|可以吗|对吗|对不对|对还是错|怎么|为什么|为啥|如何|多少|哪个|哪些|哪里|什么|是否|有没有)/,
  },
  en: {
    instruction: { text: "On it", key: "instruction" },
    question: { text: "Let me look", key: "question" },
    other: { text: "Got it", key: "other" },
    instructionRe: /\b(please|help me|let'?s|can you|could you|would you|fix|add|change|update|edit|write|create|make|build|run|install|remove|delete|drop|implement|refactor|rename|move|generate|convert|migrate|deploy|set ?up|configure|review|check|test)\b/i,
    questionRe: /(\?|\b(is|are|was|were|do|does|did|can|could|should|would|will|what|why|how|when|where|which|who|whose|whether)\b)/i,
  },
};

// 读 ~/.voice-reply/hooks.json 的某个键（lang 锁定、defaultLang 兜底）。
function configKey(key) {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"))[key];
  } catch {
    return undefined;
  }
}

// 判定一段文字的语种：
//   1) config.lang 锁定（"zh"|"en"）优先；
//   2) 含中日韩汉字 → zh；
//   3) 含拉丁字母 → en；
//   4) 纯路径/代码/符号/数字（无字母）→ config.defaultLang（默认 en），不硬判。
export function detectLang(text) {
  const forced = configKey("lang");
  if (forced === "zh" || forced === "en") return forced;
  const s = String(text || "");
  if (/[一-鿿]/.test(s)) return "zh";
  if (/[A-Za-z]/.test(s)) return "en";
  return configKey("defaultLang") === "zh" ? "zh" : "en";
}

// 通用分类规则（按语言包）：指令 → 提问 → 兜底。
export function openingCue(prompt, lang) {
  const pack = PACKS[lang] || PACKS.zh;
  const text = String(prompt || "");
  if (pack.instructionRe.test(text)) return pack.instruction;
  if (pack.questionRe.test(text)) return pack.question;
  return pack.other;
}

// 取这一端某语言的音色。voices 可为字符串（单音色）或 { zh, en }。
export function resolveVoice(voices, lang) {
  if (typeof voices === "string") return voices;
  if (voices && typeof voices === "object") return voices[lang] || voices.zh || voices.en;
  return undefined;
}

// 从 hook 输入里取用户原文。各 agent 字段名不同，这里宽松匹配；取不到则兜底分类。
export function promptText(input) {
  if (!input || typeof input !== "object") return "";
  return (
    input.prompt ||
    input.user_prompt ||
    input.userPrompt ||
    input.user_message ||
    input.message ||
    input.content || // OpenClaw message:received
    input.text ||
    input.input ||
    ""
  );
}

// 抠出回答里最后一个 <<voice: ...>> 标记的内容（三端共用）。
const VOICE_MARKER = /<<\s*voice\s*:\s*([\s\S]*?)>>/gi;
export function extractVoiceMarker(text) {
  if (!text) return "";
  const re = new RegExp(VOICE_MARKER);
  let match;
  let last = "";
  while ((match = re.exec(text)) !== null) last = match[1];
  return last.replace(/\s+/g, " ").trim();
}

// 后台 fire-and-forget 启动，立刻返回，不阻塞 hook。
export function playDetached(command, args, extraEnv) {
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

// 通用开场播放：判语种 → 该语言包分类 → 该端该语言的音色缓存 → 后台播；缺失则联网合成。
// voices 为该端的 { zh, en }（或单音色字符串）。返回 { key, lang, voice } 便于记日志。
export function playOpening(input, voices) {
  const text = promptText(input);
  const lang = detectLang(text);
  const cue = openingCue(text, lang);
  const voice = resolveVoice(voices, lang);
  const cached = join(CACHE_DIR, `opening-${cue.key}-${voice}.mp3`);
  const hit = existsSync(cached);
  // dry-run：开场走后台播放，平时看不见；这里打印将播什么，便于自测/排查。
  if (process.env.VOICE_REPLY_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({ opening: { key: cue.key, lang, voice, cache: hit ? "hit" : "miss", text: cue.text } }, null, 2) + "\n");
    return { key: cue.key, lang, voice };
  }
  if (hit) {
    playDetached(process.execPath, [speakScript, "play", "--file", cached]);
  } else {
    playDetached(process.execPath, [speakScript, "text", "--text", cue.text, "--full"], {
      VOICE_REPLY_VOICE: voice,
    });
  }
  return { key: cue.key, lang, voice };
}
