// 开场提示——通用规则（Claude 和 Codex 共用，单一事实源）。
//
// hook 在模型读懂消息之前触发，只能按关键词粗判输入类型，给一句不机械的即时回应；
// 播不出"对/错"那种答案，真答案留到结果播报。判不准就兜底「收到」，绝不硬猜。
//
// 固定词已预合成成 mp3 缓存（按音色命名），开场直接本地播放、后台异步、跨平台，
// 保证 3 秒内出声。改词或调判定关键词，改这里即可——两个 agent 一起生效。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "speak.mjs");
const CACHE_DIR = join(homedir(), ".voice-reply", "cache");

export const OPENING = {
  instruction: { text: "好，这就做", key: "instruction" },
  question: { text: "我看看", key: "question" },
  other: { text: "收到", key: "other" },
};

const INSTRUCTION_RE = /(帮我|帮忙|改一|改成|改个|换成|执行|加上|加个|加一|写个|写一|生成|创建|新建|删除|删掉|去掉|修复|优化|调整|设置|配置|做个|做一|给我|实现|部署|安装|运行|跑一|整理|翻译|画一|画个|开发|搭建)/;
const QUESTION_RE = /(？|\?|吗|呢|是不是|能不能|可不可以|可以吗|对吗|对不对|对还是错|怎么|为什么|为啥|如何|多少|哪个|哪些|哪里|什么|是否|有没有)/;

// 通用分类规则：指令 → 提问 → 兜底。
export function openingCue(prompt) {
  const text = String(prompt || "");
  if (INSTRUCTION_RE.test(text)) return OPENING.instruction;
  if (QUESTION_RE.test(text)) return OPENING.question;
  return OPENING.other;
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
    input.text ||
    input.input ||
    ""
  );
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

// 通用开场播放：分类 → 该音色的缓存 mp3（离线、瞬时）→ 后台；缓存缺失退回联网合成。
// 缓存文件名带音色，所以 Claude(男)和 Codex(女)各用各的、互不串。返回选中的 cue。
export function playOpening(input, voice) {
  const cue = openingCue(promptText(input));
  const cached = join(CACHE_DIR, `opening-${cue.key}-${voice}.mp3`);
  if (existsSync(cached)) {
    playDetached(process.execPath, [speakScript, "play", "--file", cached]);
  } else {
    playDetached(process.execPath, [speakScript, "text", "--text", cue.text, "--full"], {
      VOICE_REPLY_VOICE: voice,
    });
  }
  return cue;
}
