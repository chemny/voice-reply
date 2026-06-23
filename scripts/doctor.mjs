#!/usr/bin/env node
// Voice Reply doctor — verify the whole chain so "no sound" is debuggable.
// Run:  node scripts/doctor.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const HOME = homedir();
const VOICE_HOME = join(HOME, ".voice-reply");

let fails = 0;
let warns = 0;
const PASS = (m) => console.log(`  ✓ ${m}`);
const WARN = (m, fix) => { warns++; console.log(`  ⚠ ${m}${fix ? `  → ${fix}` : ""}`); };
const FAIL = (m, fix) => { fails++; console.log(`  ✗ ${m}${fix ? `  → ${fix}` : ""}`); };

function cmdExists(c) {
  if (c.includes("/")) return existsSync(c);
  const r = spawnSync("/bin/sh", ["-lc", `command -v ${c}`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

console.log("Voice Reply doctor\n");

console.log("Runtime");
Number(process.versions.node.split(".")[0]) >= 18
  ? PASS(`node ${process.version}`)
  : FAIL(`node ${process.version} (need 18+)`, "install Node 18+");
cmdExists("python3") ? PASS("python3") : FAIL("python3 not found", "install Python 3, then rerun the installer");

const venvPy = join(ROOT, ".venv", "bin", "python");
if (cmdExists("edge-tts")) {
  PASS("edge-tts on PATH");
} else if (existsSync(venvPy)) {
  const r = spawnSync(venvPy, ["-c", "import edge_tts"], { encoding: "utf8" });
  r.status === 0 ? PASS("edge-tts in .venv") : FAIL("edge_tts not importable in .venv", "rerun the installer");
} else {
  FAIL("no edge-tts and no .venv", "rerun the installer");
}

console.log("\nAudio");
const players = ["afplay", "ffplay", "mpv", "mpg123", "cvlc", "paplay", "aplay"];
const player = players.find(cmdExists);
player ? PASS(`player: ${player}`) : FAIL("no audio player found", "install ffplay (ffmpeg), mpv, or mpg123");

console.log("\nConfig & cache");
existsSync(join(VOICE_HOME, "config.json")) ? PASS("config.json") : WARN("config.json missing", "rerun the installer");
existsSync(join(VOICE_HOME, "hooks.json")) ? PASS("hooks.json") : WARN("hooks.json missing", "rerun the installer");
const cacheDir = join(VOICE_HOME, "cache");
const clips = existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => f.endsWith(".mp3")) : [];
clips.length ? PASS(`${clips.length} opening cache clips`) : WARN("no opening cache", "rerun the installer (else openings live-synth, slower)");

console.log("\nHook registration");
function checkHooks(label, file, scriptName) {
  if (!existsSync(file)) { WARN(`${label}: ${file} not found`, "rerun the installer and choose to register"); return; }
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch { WARN(`${label}: unreadable`); return; }
  // Match by script basename — robust to symlinks / realpath differences (/tmp vs /private/tmp,
  // or a skill dir symlinked to a repo). The path being absolute makes exact compares fragile.
  if (!raw.includes(scriptName)) { WARN(`${label}: voice-reply not registered`, "rerun the installer to register"); return; }
  if (raw.includes(`\\"${scriptName}`) || raw.includes('node \\"')) {
    FAIL(`${label}: hook command path is quoted (some runners take it literally → silent)`, "rerun the installer to rewrite it unquoted");
  } else {
    PASS(`${label}: registered`);
  }
}
checkHooks("Claude Code", join(HOME, ".claude", "settings.json"), "claude-hook.mjs");
checkHooks("Codex", join(HOME, ".codex", "hooks.json"), "codex-hook.mjs");

// Optional Codex notify fallback (for builds without hooks) — only reported if wired.
const codexToml = join(HOME, ".codex", "config.toml");
if (existsSync(codexToml)) {
  try {
    if (/^notify\s*=.*codex-notify\.mjs/m.test(readFileSync(codexToml, "utf8"))) {
      PASS("Codex notify fallback: wired (completion-only)");
    }
  } catch { /* ignore */ }
}

console.log(`\n${fails ? `✗ ${fails} problem(s)` : warns ? `⚠ ${warns} warning(s)` : "✓ all good"} — restart your agent session after any change.`);
process.exit(fails ? 1 : 0);
