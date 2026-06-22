# Voice Reply

Give your coding agent a short **spoken voice** — an instant acknowledgement the
moment you hit enter, and a concise spoken result when it finishes. Works with
**Claude Code** and **Codex**, on macOS / Linux / Windows, using local
[Edge TTS](https://github.com/rany2/edge-tts) playback.

## What it does

Two spoken moments per turn:

- **Opening cue** — the instant you submit, a hook plays a quick, type-aware
  acknowledgement: a question → *"我看看"*, an instruction → *"好，这就做"*,
  anything unclear → *"收到"*. It fires *before* the model has read your message,
  so it only acknowledges — it never pretends to answer. The cues are
  pre-synthesized and cached, so they play offline in well under a second.
- **Result reply** — when the turn finishes, the model's own one-line summary
  (status + key info + next step) is spoken. This is the *real* reply and can
  carry the actual answer (对/错, a fact, "改好了，记得重启").

The intelligence lives in the model, not the script: the model ends each reply
with a `<<voice: ...>>` line, and the hook simply extracts and speaks it. If the
line is missing, a keyword-scoring fallback summarizes the last message.

## Requirements

- Node 18+
- Python 3 (Edge TTS runs in a local venv)
- An audio player: `afplay` (built into macOS), or `ffplay` / `mpv` / `mpg123` on Linux/Windows
- Network access (Edge TTS uses Microsoft's endpoint)

## Install

```bash
git clone https://github.com/<you>/voice-reply ~/.agents/skills/voice-reply
cd ~/.agents/skills/voice-reply
./setup.sh
```

`setup.sh` creates the venv + installs edge-tts, generates the opening cache,
writes default config into `~/.voice-reply/`, and — **after asking** — registers
hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` (backing them up
first, never clobbering existing hooks). It then prints the one-line **marker
rule** to add to your agent instructions:

- Claude Code → `~/.claude/CLAUDE.md`
- Codex → `~/.codex/AGENTS.md`

> End every reply with one line: `<<voice: status + core info + next step>>`
> (target ≤40 chars, ear-friendly, no code/paths/secrets).

Restart your agent session for the hooks to load.

## How it works

| Moment | Who decides what to say | What you hear |
| --- | --- | --- |
| You submit | hook classifies your text by keywords | 我看看 / 好，这就做 / 收到 |
| Agent finishes | the **model** writes `<<voice: …>>` | the real result; falls back to keyword scoring if absent |

The hook scripts (`claude-hook.mjs`, `codex-hook.mjs`) are "dumb" — they only
play audio. Playback is fired in the background so hooks return in ~200 ms and
never block the agent. Spoken text is hard-capped at 60 chars.

## Configuration

- `~/.voice-reply/config.json` — voice / rate / volume (Codex + manual playback).
- `~/.voice-reply/hooks.json` — toggles and fixed texts (e.g. the opening
  fallback word).
- Claude's voice, the opening phrases, and the classifier keywords live at the
  top of `scripts/claude-hook.mjs`.

### Per-agent voice

Claude Code speaks **male** (`zh-CN-YunxiNeural`) and Codex speaks **female**
(`zh-CN-XiaoxiaoNeural`) so you can tell which agent is talking by ear.

## Notes & limitations

- The opening classifier and default phrases are **Chinese**. For other
  languages, edit the regexes and phrases in `scripts/claude-hook.mjs`.
- The `<<voice: ...>>` marker is **visible in your transcript** — that's how the
  hook reads it.
- Edge TTS needs **network**; only the cached opening cues work offline.
- Codex's opening cue plays a **fixed word** (`收到`), not Claude's type-aware
  cue — Codex's hook has no classifier. Toggle it with `start` in
  `~/.voice-reply/hooks.json`. Give Codex the marker rule in `AGENTS.md` to get
  the same accurate result reply as Claude.

## Test / Uninstall

```bash
./test.sh        # dry-run regression checks (no audio, no network)
./uninstall.sh   # remove hooks (keeps ~/.voice-reply); restart your session
```

## License

[MIT](LICENSE)
