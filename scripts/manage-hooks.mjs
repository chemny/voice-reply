#!/usr/bin/env node
// Idempotently add or remove Voice Reply hooks in the agent config files.
//   node manage-hooks.mjs add    <skillRoot>
//   node manage-hooks.mjs remove <skillRoot>
// Backs up each file to <file>.bak before writing. Never clobbers other hooks.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const skillRoot = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), "..");

if (mode !== "add" && mode !== "remove") {
  console.error("usage: manage-hooks.mjs add|remove <skillRoot>");
  process.exit(1);
}

const targets = [
  { name: "Claude Code", file: join(homedir(), ".claude", "settings.json"), script: join(skillRoot, "scripts", "claude-hook.mjs") },
  { name: "Codex", file: join(homedir(), ".codex", "hooks.json"), script: join(skillRoot, "scripts", "codex-hook.mjs") },
];
const EVENTS = ["UserPromptSubmit", "Stop"];

function load(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error(`! skip ${file}: not valid JSON, leaving it untouched`);
    return null;
  }
}

for (const t of targets) {
  const data = load(t.file);
  if (data === null) continue;
  data.hooks = data.hooks || {};
  let changed = false;

  for (const ev of EVENTS) {
    const list = Array.isArray(data.hooks[ev]) ? data.hooks[ev] : [];
    const has = JSON.stringify(list).includes(t.script);

    if (mode === "add" && !has) {
      list.push({ hooks: [{ type: "command", command: `node "${t.script}"`, timeout: 60 }] });
      data.hooks[ev] = list;
      changed = true;
    } else if (mode === "remove" && has) {
      const filtered = list.filter((group) => !JSON.stringify(group).includes(t.script));
      if (filtered.length) data.hooks[ev] = filtered;
      else delete data.hooks[ev];
      changed = true;
    }
  }

  if (!changed) {
    console.log(`= ${t.name}: no change (${t.file})`);
    continue;
  }
  if (mode === "add") mkdirSync(dirname(t.file), { recursive: true });
  if (existsSync(t.file)) copyFileSync(t.file, `${t.file}.bak`);
  writeFileSync(t.file, JSON.stringify(data, null, 2) + "\n");
  console.log(`${mode === "add" ? "+" : "-"} ${t.name}: ${mode === "add" ? "registered" : "removed"} hooks in ${t.file}${existsSync(`${t.file}.bak`) ? " (backup .bak)" : ""}`);
}
