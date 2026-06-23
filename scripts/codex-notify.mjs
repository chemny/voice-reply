#!/usr/bin/env node
// Codex `notify` fallback — for Codex builds WITHOUT hooks.json support
// (e.g. some Windows / older CLI builds). Codex invokes the notify program as:
//
//     <program> [fixed args...] <notification-json>
//
// so the notification JSON is the LAST argv. This script:
//   1) chains the user's ORIGINAL notify program (preserved at setup time), and
//   2) on turn completion, speaks only the model's <<voice:>> marker, in the
//      language-matched Codex voice. Missing marker stays silent.
//
// Limitation vs hooks: notify only fires on completion — there is no opening cue.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { extractVoiceMarker, detectLang, resolveVoice } from "./opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "speak.mjs");
const VOICE_HOME = join(homedir(), ".voice-reply");

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function codexVoices() {
  const c = readJson(join(VOICE_HOME, "config.json"));
  return { zh: c.voice || "zh-CN-XiaoxiaoNeural", en: c.voiceEn || "en-US-AriaNeural" };
}

function playDetached(command, args, extraEnv) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    child.unref();
  } catch {
    // never break Codex's turn
  }
}

function main() {
  const dry = process.env.VOICE_REPLY_DRY_RUN === "1";
  const cfg = readJson(join(VOICE_HOME, "notify.json"));

  // Codex appends the notification JSON as the final argument.
  const rawArg = process.argv[process.argv.length - 1] || "";
  let note = {};
  try { note = JSON.parse(rawArg); } catch { note = {}; }

  // 1) Chain the user's original notify program (preserved), passing the same JSON.
  const original = Array.isArray(cfg.originalNotify) ? cfg.originalNotify : [];
  if (!dry && original.length && original[0] && original[0] !== process.execPath) {
    playDetached(original[0], [...original.slice(1), rawArg]);
  }

  if (cfg.enabled === false) return;

  // 2) Speak on turn completion.
  const type = String(note.type || "");
  const msg = note["last-assistant-message"] || note.last_assistant_message || note.lastAssistantMessage || "";
  const isComplete = /turn[-_ ]?complete|complete|finished|done/i.test(type) || Boolean(msg);
  if (!isComplete) return;

  const marker = extractVoiceMarker(msg);
  if (!marker) {
    if (dry) {
      process.stdout.write(JSON.stringify({ notify: { chained: original.length ? original[0] : null, source: "no-marker-silent" } }, null, 2) + "\n");
    }
    return;
  }

  const lang = detectLang(marker);
  const voice = resolveVoice(codexVoices(), lang);

  if (dry) {
    process.stdout.write(JSON.stringify({ notify: { chained: original.length ? original[0] : null, text: marker, voice, source: "marker" } }, null, 2) + "\n");
    return;
  }
  playDetached(process.execPath, [speakScript, "text", "--text", marker, "--full"], { VOICE_REPLY_VOICE: voice });
}

main();
