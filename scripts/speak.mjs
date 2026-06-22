#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaults = {
  voice: "zh-CN-XiaoxiaoNeural",
  rate: "+0%",
  volume: "+0%",
  startText: "我开始处理这个任务。",
  doneText: "任务已完成，请查看结果。",
  summaryPrefix: "任务已完成。主要结果是：",
  maxResultChars: 60,
  playCommand: "auto",
};

// Cross-platform audio players. Each entry builds the argv for a given file.
const PLAYERS = {
  afplay: (f) => [f],
  ffplay: (f) => ["-nodisp", "-autoexit", "-loglevel", "quiet", f],
  mpv: (f) => ["--no-video", "--really-quiet", f],
  mpg123: (f) => ["-q", f],
  cvlc: (f) => ["--play-and-exit", "--intf", "dummy", f],
  paplay: (f) => [f],
  aplay: (f) => [f],
};

function platformPlayerOrder() {
  if (process.platform === "darwin") return ["afplay", "ffplay", "mpv", "mpg123"];
  if (process.platform === "win32") return ["ffplay", "mpv"];
  return ["ffplay", "mpv", "mpg123", "cvlc", "paplay", "aplay"];
}

// Resolve the playback command: honor an explicit playCommand, else auto-detect.
function resolvePlayer(explicit) {
  if (explicit && explicit !== "auto") {
    return { command: explicit, buildArgs: PLAYERS[explicit] || ((f) => [f]), available: commandExists(explicit) };
  }
  for (const candidate of platformPlayerOrder()) {
    if (commandExists(candidate)) return { command: candidate, buildArgs: PLAYERS[candidate], available: true };
  }
  return { command: null, buildArgs: (f) => [f], available: false };
}

function usage(exitCode = 0) {
  const text = `
Usage:
  node speak.mjs start [options]
  node speak.mjs done [options]
  node speak.mjs text --text "..." [options]
  node speak.mjs summary --text "..." [options]
  node speak.mjs play --file <path> [options]

Options:
  --text <text>         Text to speak for text or summary modes.
  --voice <voice>       Edge TTS voice, default zh-CN-XiaoxiaoNeural.
  --rate <rate>         Edge TTS rate, default +0%.
  --volume <volume>     Edge TTS volume, default +0%.
  --max-chars <n>       Maximum spoken result characters, default 60.
  --full                Do not truncate --text content.
  --config <path>       Optional JSON config path.
  --play-command <cmd>  Playback command, default auto (afplay/ffplay/mpv/mpg123).
  --file <path>         Audio file to play (play mode).
  --dry-run             Print resolved text and dependency status only.
  --help                Show this help.
`;
  process.stdout.write(text.trimStart());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = [...argv];
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") usage(0);
  const mode = args.shift();
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--full") {
      options.full = true;
      continue;
    }
    const key = {
      "--text": "text",
      "--voice": "voice",
      "--rate": "rate",
      "--volume": "volume",
      "--max-chars": "maxResultChars",
      "--config": "config",
      "--play-command": "playCommand",
      "--file": "file",
    }[arg];
    if (!key) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const value = args[i + 1];
    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = key === "maxResultChars" ? Number(value) : value;
    i += 1;
  }

  if (!mode || mode === "help") usage(0);
  return { mode, options };
}

function loadConfig(path) {
  const defaultPath = join(homedir(), ".voice-reply", "config.json");
  const configPath = path || defaultPath;
  if (!existsSync(configPath)) return {};

  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read config ${configPath}: ${error.message}`);
  }
}

function commandExists(command) {
  if (command.includes("/") && existsSync(command)) return true;
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// Strip emoji / pictographs / decorative symbols (enclosed numbers, arrows,
// geometric shapes, dingbats, variation selectors). Normal punctuation
// (，。！？、… —, etc.) is kept — TTS uses it for intonation/pauses.
const UNSPEAKABLE_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
function stripUnspeakable(text) {
  return String(text || "").replace(UNSPEAKABLE_RE, "").replace(/\s{2,}/g, " ").trim();
}

function truncateText(text, maxChars) {
  const normalized = normalizeWhitespace(text);
  if (!Number.isFinite(maxChars) || maxChars <= 0) return normalized;
  if ([...normalized].length <= maxChars) return normalized;
  return [...normalized].slice(0, maxChars).join("").replace(/[，。,.!?！？、\s]+$/u, "") + "。";
}

function resolveSpeechText(mode, config, options) {
  const maxChars = options.full ? 0 : config.maxResultChars;
  if (mode === "start") return config.startText;
  if (mode === "done") return config.doneText;
  if (mode === "text") {
    if (!options.text) throw new Error("text mode requires --text");
    return truncateText(options.text, maxChars);
  }
  if (mode === "summary") {
    if (!options.text) throw new Error("summary mode requires --text");
    return config.summaryPrefix + truncateText(options.text, maxChars);
  }
  throw new Error(`Unknown mode: ${mode}`);
}

function runChecked(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = normalizeWhitespace(result.stderr);
    const stdout = normalizeWhitespace(result.stdout);
    throw new Error(`${label} failed with exit code ${result.status}${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
  }
}

function envOverrides() {
  // 允许调用方通过环境变量覆盖音色/语速/音量。
  // 用途：让不同工具（Claude Code / Codex）走同一套脚本却用不同声音。
  // 优先级：默认 < 配置文件 < 环境变量 < 命令行 --flag。
  const overrides = {};
  if (process.env.VOICE_REPLY_VOICE) overrides.voice = process.env.VOICE_REPLY_VOICE;
  if (process.env.VOICE_REPLY_RATE) overrides.rate = process.env.VOICE_REPLY_RATE;
  if (process.env.VOICE_REPLY_VOLUME) overrides.volume = process.env.VOICE_REPLY_VOLUME;
  return overrides;
}

function main() {
  const { mode, options } = parseArgs(process.argv.slice(2));
  const config = { ...defaults, ...loadConfig(options.config), ...envOverrides(), ...options };
  const bundledEdgeTts = join(__dirname, "..", ".venv", "bin", "edge-tts");
  const bundledPython = join(__dirname, "..", ".venv", "bin", "python");
  const edgeTtsCommand = commandExists("edge-tts") ? "edge-tts" : bundledPython;
  const edgeTtsBaseArgs = edgeTtsCommand === bundledPython ? ["-m", "edge_tts"] : [];
  // play mode: just play an existing audio file with the resolved cross-platform player.
  if (mode === "play") {
    const player = resolvePlayer(config.playCommand);
    if (options.dryRun) {
      process.stdout.write(JSON.stringify({ mode, file: options.file || null, platform: process.platform, playerAvailable: player.available, playCommand: player.command }, null, 2) + "\n");
      return;
    }
    if (!options.file) throw new Error("play mode requires --file");
    if (!existsSync(options.file)) throw new Error(`file not found: ${options.file}`);
    if (!player.available) throw new Error("No audio player found. Install ffplay/mpv/mpg123, or set playCommand.");
    runChecked(player.command, player.buildArgs(options.file), player.command);
    return;
  }

  const text = stripUnspeakable(resolveSpeechText(mode, config, options));
  const edgeAvailable = commandExists(edgeTtsCommand);
  const player = resolvePlayer(config.playCommand);

  // Nothing speakable left after stripping (e.g. emoji-only) — skip silently.
  if (!text) {
    if (options.dryRun) process.stdout.write(JSON.stringify({ mode, text: "", skipped: "empty after sanitize" }, null, 2) + "\n");
    return;
  }

  if (options.dryRun) {
    process.stdout.write(JSON.stringify({
      mode,
      text,
      voice: config.voice,
      rate: config.rate,
      volume: config.volume,
      platform: process.platform,
      edgeTtsAvailable: edgeAvailable,
      edgeTtsCommand,
      edgeTtsBaseArgs,
      playerAvailable: player.available,
      playCommand: player.command,
    }, null, 2) + "\n");
    return;
  }

  if (!edgeAvailable) {
    throw new Error("edge-tts is not installed or not on PATH. Run setup.sh, or install it: python3 -m pip install edge-tts");
  }
  if (!player.available) {
    throw new Error("No audio player found. On Linux/Windows install ffplay (ffmpeg), mpv, or mpg123; or set playCommand in ~/.voice-reply/config.json.");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "voice-reply-"));
  const audioPath = join(tempDir, "speak.mp3");
  try {
    runChecked(edgeTtsCommand, [
      ...edgeTtsBaseArgs,
      "--voice", config.voice,
      "--rate", config.rate,
      "--volume", config.volume,
      "--text", text,
      "--write-media", audioPath,
    ], "edge-tts");
    runChecked(player.command, player.buildArgs(audioPath), player.command);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
