#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { playOpening } from "./opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "speak.mjs");
const logPath = join(homedir(), ".voice-reply", "hook.log");

// Codex 的音色（来自 config.json，默认女声），用于挑对应的开场缓存。
function codexVoice() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".voice-reply", "config.json"), "utf8"));
    return cfg.voice || "zh-CN-XiaoxiaoNeural";
  } catch {
    return "zh-CN-XiaoxiaoNeural";
  }
}

const defaults = {
  enabled: true,
  start: true,
  stop: true,
  stopMode: "summary",
  nodeEvents: false,
  nodeTools: ["apply_patch"],
  texts: {
    UserPromptSubmit: "好的。",
    Stop: "已完成，请查看结果。",
    StopSummaryPrefix: "已完成。",
    PreToolUse: "开始执行工具。",
    PostToolUse: "工具执行完成。",
  },
  maxResultChars: 60,
  maxSummarySentences: 1,
};

// 显式播报标记 <<voice: ...>>：模型为耳朵写的那句，优先于关键词打分（与 Claude 一致）。
const VOICE_MARKER = /<<\s*voice\s*:\s*([\s\S]*?)>>/gi;

function extractVoiceMarker(text) {
  if (!text) return "";
  const re = new RegExp(VOICE_MARKER);
  let match;
  let last = "";
  while ((match = re.exec(text)) !== null) last = match[1];
  return last.replace(/\s+/g, " ").trim();
}

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

function log(event, data = {}) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    }) + "\n");
  } catch {
    // Logging must never break a hook.
  }
}

function loadConfig() {
  const configPath = join(homedir(), ".voice-reply", "hooks.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function truncateText(text, maxChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return normalized;
  if ([...normalized].length <= maxChars) return normalized;
  return [...normalized].slice(0, maxChars).join("").replace(/[，。,.!?！？、\s]+$/u, "") + "。";
}

function speak(args) {
  log("speak", { args });
  if (process.env.VOICE_REPLY_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({ announceArgs: args }, null, 2) + "\n");
    return;
  }
  spawnSync(process.execPath, [speakScript, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 30000,
  });
}

function shouldSpeakNode(input, config) {
  if (!config.nodeEvents) return false;
  const toolName = input.tool_name || "";
  return config.nodeTools.includes(toolName);
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/(?:sk|pk|rk|ghp|github_pat|xox[baprs])-[-_A-Za-z0-9]{16,}/g, "已隐藏的密钥")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "已隐藏的邮箱")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "已隐藏的数字");
}

function stripMarkdown(text) {
  return redactSensitiveText(text)
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/::[a-zA-Z-]+(?:\{[^}]*\})?/g, " ")
    .replace(/\b[a-z0-9_.-]*(?:codex|voice|announce|hook|hooks|skill|tts|edge|markdown|json|dry-run|payload|stop|userpromptsubmit|lastassistantmessage|last_assistant_message)[a-z0-9_.-]*\b/gi, "语音播报")
    .replace(/\b(?:node|python3?|npm|pip|rg|sed|chmod|find|printf)\b/gi, " ");
}

function shortenPaths(text) {
  return text.replace(/(?:~|\/Users\/[^\s，。；；、)）\]]+|\/[A-Za-z0-9._-][^\s，。；；、)）\]]*)/g, (match) => {
    const parts = match.split("/").filter(Boolean);
    if (parts.length === 0) return match;
    const last = parts[parts.length - 1] || match;
    return last.length > 40 ? "相关文件" : last;
  });
}

function splitSentences(text) {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "。")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const matches = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [normalized];
  return matches
    .map((sentence) => sentence.trim().replace(/[。！？!?；;]+$/g, ""))
    .filter(Boolean);
}

function scoreSentence(sentence) {
  let score = 0;
  if (/(已完成|完成了|已经|可以|能够|跑通|生效|可用|通过|解决|修复|配置好|安装好|改好了|升级|结果是|现在可以)/.test(sentence)) score += 4;
  if (/(结果|效果|现在|目前|已经可以|后续|下一步|能区分|不再|更简洁)/.test(sentence)) score += 2;
  if (/(失败|不能|没有|需要|注意|还差|限制|未能)/.test(sentence)) score += 1;
  if (sentence.length >= 8 && sentence.length <= 90) score += 1;
  if (/(修改了|新增了|测试通过|语法检查|校验|dry run|dry-run|文件|脚本|路径|配置文件|函数|实现细节|命令|参考|来源|代码|参数|输出)/i.test(sentence)) score -= 3;
  if (/^(参考|来源|路径|示例|命令|当前验证结果|测试结果|完成内容|注意一点)$/.test(sentence)) score -= 3;
  if (/^[-*#>`]/.test(sentence)) score -= 2;
  return score;
}

function polishForSpeech(text) {
  return text
    .replace(/^(已完成|完成了|已经完成)[，。；:\s]*/g, "")
    .replace(/^(主要完成了|主要是|本次|这次)[，。；:\s]*/g, "")
    .replace(/\b[a-z0-9_.-]*(?:codex|voice|announce|hook|hooks|skill|tts|edge|markdown|json|dry-run|payload|stop|userpromptsubmit|lastassistantmessage|last_assistant_message)[a-z0-9_.-]*\b/gi, "语音播报")
    .replace(/(?:语音播报[的\s]*){2,}/g, "语音播报的")
    .replace(/语音播报的摘要播报/g, "语音摘要播报")
    .replace(/语音播报摘要播报/g, "语音摘要播报")
    .replace(/\s+/g, "")
    .replace(/；+/g, "，")
    .replace(/[，。；、\s]+$/g, "");
}

function buildSummary(message, config) {
  const cleaned = shortenPaths(stripMarkdown(message))
    .replace(/\s+/g, " ")
    .replace(/\s*([，。！？；：、,.!?;:])\s*/g, "$1")
    .trim();
  const sentences = splitSentences(cleaned);
  if (sentences.length === 0) return "";

  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence) }))
    .filter(({ sentence }) => sentence.length >= 4)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  for (const item of ranked) {
    if (selected.length >= config.maxSummarySentences) break;
    if (!selected.some((existing) => existing.sentence === item.sentence)) selected.push(item);
  }

  const ordered = selected.sort((a, b) => a.index - b.index).map(({ sentence }) => sentence);
  const summary = ordered.length ? ordered.join("；") : sentences.slice(0, config.maxSummarySentences).join("；");
  return polishForSpeech(truncateText(summary, config.maxResultChars));
}

function main() {
  const input = readStdinJson();
  const config = { ...defaults, ...loadConfig() };
  config.texts = { ...defaults.texts, ...(config.texts || {}) };

  if (config.enabled === false) {
    log("disabled");
    return;
  }

  const event = input.hook_event_name || process.argv[2] || "";
  log("hook", { hook_event_name: event, input_keys: Object.keys(input), has_last_assistant_message: Boolean(input.last_assistant_message) });
  if (event === "UserPromptSubmit" && config.start) {
    // 走和 Claude 一样的通用开场规则（opening.mjs）：按输入类型分类，女声、后台、缓存。
    const cue = playOpening(input, codexVoice());
    log("open", { cue: cue.key });
    return;
  }

  if (event === "Stop" && config.stop) {
    const marker = config.stopMode === "summary" ? extractVoiceMarker(input.last_assistant_message) : "";
    if (marker) {
      // 模型主动写的播报标记：直接念，最准（与 Claude 的 <<voice:>> 机制一致）。
      log("stop", { source: "marker" });
      speak(["text", "--text", truncateText(marker, config.maxResultChars), "--full"]);
    } else if (config.stopMode === "summary" && input.last_assistant_message) {
      const prefix = config.texts.StopSummaryPrefix;
      const maxSummaryChars = Math.max(20, config.maxResultChars - [...prefix].length);
      const summary = buildSummary(input.last_assistant_message, { ...config, maxResultChars: maxSummaryChars });
      if (summary) {
        speak(["text", "--text", truncateText(`${prefix}${summary}`, config.maxResultChars), "--full"]);
      } else {
        speak(["text", "--text", config.texts.Stop, "--full"]);
      }
    } else {
      speak(["text", "--text", config.texts.Stop, "--full"]);
    }
    return;
  }

  if ((event === "PreToolUse" || event === "PostToolUse") && shouldSpeakNode(input, config)) {
    speak(["text", "--text", config.texts[event], "--full"]);
  }
}

main();
