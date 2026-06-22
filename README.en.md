# Voice Reply

[中文](./README.md) | English

**Talk with your agent by voice — stop watching the screen.**

Voice Reply makes your coding agent more than a one-way announcer: it answers the
moment you speak, and when it finishes a step it tells you the **decision it needs
from you**. You reply, it continues — a back-and-forth, so your eyes are free but
you stay in control.

Works with **Claude Code** and **Codex**, **Chinese + English (pick one at setup,
locked; or choose auto-per-message)**, with an instant opening cue, a decision-first result reply,
per-agent voices, one-command setup, cross-platform playback (macOS / Linux /
Windows), and offline cues via local [Edge TTS](https://github.com/rany2/edge-tts).

## Who Is This For?

This skill is designed for:

- People who run long tasks in Claude Code / Codex and don't want to babysit the screen
- People running multiple agents who want to tell by ear which one finished
- Anyone who wants a voice-feedback layer in their agent workflow

## What It Does

Two spoken moments per turn:

- **Opening cue** — the instant you submit, a hook plays a quick acknowledgement
  matched to your message's **language and type**: in Chinese *我看看 / 好，这就做 /
  收到*, in English *Let me look / On it / Got it*. It fires *before* the model
  reads your message, so it only acknowledges — never pretends to answer.
  Pre-synthesized and cached, so it plays offline in under a second.
- **Result reply** — when the turn finishes, the model's one-line reply is spoken:
  a conclusion, **or the decision it needs from you (decision-first)**. You answer
  and the loop continues — turning a one-way announcement into a back-and-forth. It
  can carry the real answer (对/错, a number, "restart to apply"), in a voice matched
  to the reply's language.

The intelligence lives in the model, not the script: the model ends each reply
with a `<<voice: ...>>` line, and the hook simply extracts and speaks it. If the
line is missing, a keyword-scoring fallback summarizes the last message.

## Core Capabilities

| Capability | Input | Output |
|---|---|---|
| Instant opening cue | classify by language + type | cached audio, offline, <1s, non-blocking |
| Decision-first result | model's `<<voice:>>` marker, scoring fallback | a conclusion **or the choice you must make**, ready to answer |
| Chinese + English | pick & lock at setup (or choose auto-per-message) | Chinese phrases + voice for Chinese, English for English |
| Per-agent voice | Claude male, Codex female (each zh / en) | tell which agent is speaking by ear |
| Single source of truth | `scripts/opening.mjs` | edit once — both agents, both languages |

## Platform Compatibility

| Platform | Status |
|---|---|
| Claude Code | ✅ Supported (`~/.claude/settings.json` hooks) |
| Codex | ✅ Supported (`~/.codex/hooks.json`) |
| OpenClaw | ⚪ Not tested |

Playback works on macOS (`afplay`) and Linux/Windows (`ffplay` / `mpv` / `mpg123`).

## Install

```bash
git clone https://github.com/chemny/voice-reply ~/.agents/skills/voice-reply
cd ~/.agents/skills/voice-reply
./setup.sh
```

`setup.sh` creates the venv + installs edge-tts, generates the opening cache for
both voices, writes default config into `~/.voice-reply/`, and — **after asking** —
merges hooks into `~/.claude/settings.json` and `~/.codex/hooks.json` (backing
them up first, never clobbering existing hooks). It then prints the marker rule
to add to your agent instructions. Restart your agent session afterwards.

## Quick Start

After install + restart, just send a message:

- Ask a question → hear *"我看看"* immediately, then the conclusion (e.g. *"对"*).
- Give an instruction → hear *"好，这就做"*, then *"改好了，记得重启"* when done.

Manual check (no hooks needed):

```bash
node scripts/speak.mjs done
./test.sh        # dry-run regression checks (no audio, no network)
```

## Usage Examples

```bash
# Speak a line
node scripts/speak.mjs text --text "改好了，记得重启。" --full

# Play an existing audio file (cross-platform player)
node scripts/speak.mjs play --file ~/.voice-reply/cache/opening-question-zh-CN-YunxiNeural.mp3

# Preview the spoken text and dependency status without audio
node scripts/speak.mjs summary --text "修复了参数解析并通过校验。" --dry-run
```

The result marker the model writes each turn looks like:

```text
<<voice: 改好了，记得重启会话生效>>
```

## How It Works

| Moment | Who decides what to say | What you hear |
|---|---|---|
| You submit | hook classifies the prompt (`scripts/opening.mjs`, shared) | 我看看 / 好，这就做 / 收到 |
| Agent finishes | the **model** writes `<<voice: …>>` | the real result; keyword scoring as fallback |

The hook scripts only play audio. Playback is fired in the background so hooks
return in ~200 ms and never block the agent. Spoken text is hard-capped at 60 chars.

## Repository Structure

```text
voice-reply/
├── scripts/
│   ├── speak.mjs        # core: text → Edge TTS mp3 → cross-platform player
│   ├── opening.mjs      # shared opening-cue rule (both agents)
│   ├── claude-hook.mjs  # Claude Code hook entry
│   ├── codex-hook.mjs   # Codex hook entry
│   ├── codex-notify.mjs # Codex notify fallback
│   └── manage-hooks.mjs # idempotent install/remove hooks (with backup)
├── setup.sh / uninstall.sh / test.sh
├── SKILL.md / README.md / README.en.md / LICENSE / .gitignore
└── agents/openai.yaml
```

Runtime data lives in `~/.voice-reply/`: `config.json` (voice/rate/volume),
`hooks.json` (toggles and fixed texts), `cache/` (opening cues).

## Requirements

- Node 18+
- Python 3 (runs edge-tts in a local venv)
- An audio player: `afplay` on macOS, or `ffplay` / `mpv` / `mpg123` on Linux/Windows
- Network access ([edge-tts](https://github.com/rany2/edge-tts) uses Microsoft's endpoint)

Ships with **Chinese + English** opening phrases and classifiers. **Setup asks
you to pick one language and locks it** (stored as `"lang"` in
`~/.voice-reply/hooks.json`). Change it anytime: set `lang` to `"zh"`/`"en"`, or
**remove `lang` to go back to auto (per-message) switching**. Add more languages
by editing the packs in `scripts/opening.mjs`.

## No sound?

Run the doctor first — it pinpoints which link in the chain is broken:

```bash
node scripts/doctor.mjs
```

Common causes:

- **Didn't restart the agent** — hooks load at session start, so restart Claude Code / Codex after install.
- **No audio player** (Linux/Windows) — install `ffplay` (ffmpeg), `mpv`, or `mpg123`; macOS ships `afplay`.
- **Hooks not registered, or the command path got quoted** — re-run `./setup.sh`; it rewrites the hook in the correct (unquoted) form.
- **This Codex build has no hooks support** (older / some Windows CLIs) — use the `notify` fallback: `node scripts/manage-notify.mjs add "$(pwd)"`, then restart Codex. It takes over Codex's `notify` (preserving and chaining your existing one) and speaks on **completion only — no opening cue**.
- **edge-tts not installed** — re-run `./setup.sh` (needs python3 + network).

`setup.sh` ends by running the doctor and playing a test sound — if you hear it, audio works.

## License

[MIT](LICENSE)
