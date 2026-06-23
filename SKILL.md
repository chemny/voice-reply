---
name: voice-reply
version: 1.0.0
description: Speak a short, context-aware voice reply for agent work — an instant acknowledgement when the user submits, and a decision-first spoken result when the turn finishes (it leads with the choice the user must make, turning a one-way announcement into a back-and-forth). Chinese + English: you pick a language at setup and it locks (or choose auto, which follows each message). Works for both Claude Code and Codex via their hook systems, with local Edge TTS playback. Use when adding spoken acknowledgements/announcements, reading a result aloud, or wiring voice notifications into an agent workflow.
---

# Voice Reply

## Overview

Voice Reply gives a coding agent a short spoken voice:

- **Opening cue** — the instant the user submits, a hook plays a quick acknowledgement matched to the message's language and type (zh: 我看看 / 好，这就做 / 收到; en: Let me look / On it / Got it). It fires before the model has read the message, so it can only acknowledge, never answer.
- **Result reply** — when the turn finishes, the model's own one-line summary is spoken: a conclusion, or **the decision the user must make (decision-first)** so they can answer and keep the loop going. It can contain the actual answer (对/错, a fact, "改好了，记得重启"), in a voice matched to the reply's language.

Playback is local Edge TTS + `afplay`, fired in the background so hooks return in ~200ms and never block the agent.

## Layout

```
voice-reply/
  SKILL.md
  install.sh           # one-command bootstrap installer
  setup.sh             # one-command install (venv, cache, hooks)
  uninstall.sh         # remove hooks, restore backups
  test.sh              # dry-run regression checks
  scripts/
    speak.mjs          # core: text → Edge TTS mp3 → cross-platform player
    opening.mjs        # shared opening-cue rule (classifier + cached playback)
    claude-hook.mjs    # Claude Code hook entry (opening + result marker only)
    codex-hook.mjs     # Codex hook entry (opening + result marker only)
    codex-notify.mjs   # Codex `notify` fallback for builds without hooks (completion-only)
    manage-hooks.mjs   # register/remove hooks in settings.json / hooks.json
    manage-notify.mjs  # wire/unwire the Codex notify fallback in config.toml
    doctor.mjs         # self-check: node/edge-tts/player/config/cache/hooks
  agents/openai.yaml
  .venv/               # created by setup.sh, gitignored
```

Config + cache live in `~/.voice-reply/`:

```
~/.voice-reply/
  config.json   # voice / rate / volume (read by speak.mjs)
  hooks.json    # toggles + fixed texts (read by codex-hook.mjs)
  cache/        # pre-synthesized opening cue mp3s, named opening-<type>-<voice>.mp3
```

## Manual playback

Run from the skill directory (`$SKILL` = wherever this skill is installed):

```bash
node "$SKILL/scripts/speak.mjs" done
node "$SKILL/scripts/speak.mjs" text --text "改好了，记得重启。" --full
node "$SKILL/scripts/speak.mjs" summary --text "修复了参数解析并通过校验。"
node "$SKILL/scripts/speak.mjs" play --file <file.mp3>   # play an existing clip (cross-platform)
```

`speak.mjs` resolves Edge TTS from the project `.venv` (created by `setup.sh`) if `edge-tts` is not on PATH, and auto-detects a player (`afplay`/`ffplay`/`mpv`/`mpg123`). Use `--dry-run` to preview text and dependency status without audio. Voice/rate/volume can be overridden by `--voice/--rate/--volume`, by env vars `VOICE_REPLY_VOICE/RATE/VOLUME`, or by `~/.voice-reply/config.json`.

## Automatic hooks

**Claude Code** — `~/.claude/settings.json` registers `claude-hook.mjs` on `UserPromptSubmit` (opening cue) and `Stop` (result reply). On Stop it reads the transcript, extracts the last `<<voice: ...>>` marker the model wrote, and speaks it. If absent, it stays silent.

**Codex** — `~/.codex/hooks.json` registers `codex-hook.mjs` on the same events. Codex provides `last_assistant_message` directly, so no transcript parsing is needed.

**Codex without hooks support** (older / some Windows builds) — fall back to Codex's `notify` mechanism: `node scripts/manage-notify.mjs add "$(pwd)"` points `notify` in `~/.codex/config.toml` at `codex-notify.mjs` (preserving and chaining any existing notify program). This speaks the `<<voice:>>` marker on turn completion only — there is no opening cue via notify.

The model is instructed (in the user's global CLAUDE.md / Codex AGENTS.md) to end each turn with one line:

```
<<voice: status + core info + next action>>
```

**Decision-first**: when the result needs the user to decide, choose, confirm, or
answer something, the marker should lead with what the user must do (e.g.
`<<voice: 要你定：现在能不能重启？>>`) so they can reply by voice without reading.

The model **targets ≤60 chars** to keep it ear-friendly; the hooks also **hard-cap spoken text at 60 chars** as a safety net — `maxResultChars` in `codex-hook.mjs` / `~/.voice-reply/hooks.json`, and `MARKER_MAX_CHARS` in `claude-hook.mjs`. Both Claude Code (`claude-hook`) and Codex (`codex-hook`) speak only this marker on turn completion; if it is absent, they stay silent.

## Per-agent voice

Claude Code speaks **male** and Codex speaks **female**, so you can tell them apart by ear. Each has a Chinese and an English voice, picked automatically by the message/reply language: Claude `CLAUDE_VOICE_ZH` / `CLAUDE_VOICE_EN` at the top of `claude-hook.mjs` (default zh-CN-YunxiNeural / en-US-GuyNeural); Codex `voice` / `voiceEn` in `~/.voice-reply/config.json` (default zh-CN-XiaoxiaoNeural / en-US-AriaNeural).

## Opening cue

The opening rule lives in `scripts/opening.mjs` and is **shared by both agents and
both languages**. `setup.sh` asks the user to pick a language on first install and
writes it as `"lang": "zh"|"en"` in `~/.voice-reply/hooks.json` (a lock). When
`lang` is set, that language is always used; remove `lang` to auto-detect each
message (CJK → Chinese, else English). It then classifies the message
(question / instruction / other) and plays the matching phrase in that agent's
voice for that language. Chinese: 我看看 / 好，这就做 / 收到. English: Let me look /
On it / Got it. Edit the language packs once and both Claude and Codex pick it up.

The phrases are pre-synthesized to `~/.voice-reply/cache/opening-<type>-<voice>.mp3`
so the opening plays instantly and offline (live synthesis would add ~5s). The
filename includes the voice, so changing a voice never replays the old one — it
falls back to live synthesis in the new voice until you re-run `setup.sh` to
refresh the cache.

## Dependency

`speak.mjs` needs `edge-tts` (installed into `.venv` by `setup.sh`, or on PATH) and an audio player: `afplay` on macOS, or `ffplay`/`mpv`/`mpg123` on Linux/Windows. Edge TTS requires network access (Microsoft endpoint). Run `setup.sh` to install everything; it asks before changing your hook configs.

## Troubleshooting (no sound)

Run `node scripts/doctor.mjs` — it checks every link (node, edge-tts/venv, audio player, config, cache, hook registration) and prints what to fix. Common causes: the agent wasn't restarted after install (hooks load at session start); no audio player on Linux/Windows (install ffplay/mpv/mpg123); hooks unregistered or the command path got quoted (re-run `setup.sh` to rewrite it unquoted); edge-tts not installed. The hook command must be unquoted (`node /path/...`) — a quoted path is taken literally by some hook runners and fails silently. `setup.sh` ends by running the doctor and playing a test sound.
