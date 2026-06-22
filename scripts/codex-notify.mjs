#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "speak.mjs");

const defaults = {
  enabled: true,
  mode: "done",
  // Optional: chain to another notifier (e.g. the original Codex notify program).
  // Empty by default so the skill is portable. Set originalNotify in
  // ~/.voice-reply/notify.json to [ "<program>", "<arg>", ... ] to enable.
  originalNotify: [],
  originalTimeoutMs: 5000,
};

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function loadConfig() {
  const configPath = join(homedir(), ".voice-reply", "notify.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function runOriginal(payload, config) {
  const original = config.originalNotify;
  if (!Array.isArray(original) || original.length === 0) return;
  if (!existsSync(original[0])) return;
  if (original[0] === process.execPath && original.includes(fileURLToPath(import.meta.url))) return;

  spawnSync(original[0], original.slice(1), {
    input: payload,
    encoding: "utf8",
    timeout: config.originalTimeoutMs,
    stdio: ["pipe", "ignore", "ignore"],
  });
}

function runVoice(config) {
  if (config.enabled === false) return;
  const mode = config.mode === "start" ? "start" : "done";
  spawnSync(process.execPath, [speakScript, mode], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 30000,
  });
}

const payload = readStdin();
const config = { ...defaults, ...loadConfig() };

runOriginal(payload, config);
runVoice(config);
