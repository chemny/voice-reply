# Voice Reply

中文 | [English](./README.en.md)

**和你的 AI 用语音双向沟通——不用再盯着屏幕等。**

Voice Reply 让编码 Agent 不只是"干完报一句结论"：你一发话它立刻应声；它干完一件事，会把**这一步需要你拍板的选择**说给你听；你回一句，它接着往下做。一来一回，像在对话——眼睛解放了，方向盘还在你手里。

支持 **Claude Code 和 Codex**、**中英文(安装时选定并锁定,也可选按消息自动切换)**、即时开场提示、决策优先的结果播报、双 Agent 音色区分；一条命令安装、跨平台播放、离线秒回。

## 适合谁使用？

这个 skill 适合：

- 经常让 Claude Code / Codex 跑长任务、不想干等屏幕的人
- 同时开多个 Agent、想"听声辨人"知道是谁干完了的人
- 想给自己的 Agent 工作流加一层语音反馈的人

## 它能做什么？

每一轮对话，Voice Reply 在两个时刻发声：

- **开场提示**：你一提交，hook 立刻按你这句话的**语种和类型**播一句即时回应——中文「我看看 / 好，这就做 / 收到」，英文 "Let me look / On it / Got it"。它在模型读懂你的话之前触发，所以只确认收到、不假装回答。固定词预先合成成 mp3 缓存，离线、不到 1 秒就出声。
- **结果播报**：这一轮结束时，把模型写的一句话念出来——可能是结论，**也可能是这一步要你拍板的选择（决策优先）**。你听到就能直接回、接着往下推，把"单向播报"变成"双向对话"。可带真答案（对/错、一个数字、"改好了，记得重启"），并按回答语种自动选中/英文音色。

"说什么"的智能在模型，不在脚本：模型在每轮结尾写一行 `<<voice: ...>>`，hook 只负责把它抠出来念。缺了这行，结果播报就保持静默，避免误读长正文或中途状态。

## 核心能力

| 能力 | 它能帮你做什么 |
|---|---|
| 即时开场提示 | 你一提交任务就马上出声回应，让你知道 Agent 已经开始处理。 |
| 结果语音播报 | Agent 完成后只朗读最终 `voice` 标记，避免把长正文或过程状态念出来。 |
| 决策优先提醒 | 如果结果需要你确认、选择或继续拍板，会优先把下一步说清楚。 |
| 中英文语音 | 支持固定中文、固定英文，或根据每条消息自动切换语言。 |
| 多 Agent 声音区分 | Claude Code 和 Codex 使用不同音色，多个 Agent 同时工作也能听声辨别。 |

## 平台兼容性

| 平台 | 状态 |
|---|---|
| Claude Code | ✅ 已支持（`~/.claude/settings.json` hooks） |
| Codex | ✅ 已支持（`~/.codex/hooks.json`） |
| OpenClaw | ⚪ 未实测 |

播放层支持 macOS（`afplay`）与 Linux/Windows（`ffplay`/`mpv`/`mpg123`）。

## 安装

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/chemny/voice-reply/main/install.sh)"
```

安装器会引导完成仓库安装、Python 环境、Edge TTS、语音缓存、Claude Code / Codex hooks、结果播报规则和最终声音测试。完成后重启 Agent 会话即可生效。

默认安装到 `~/.agents/skills/voice-reply`。如需换目录，可设置 `VOICE_REPLY_INSTALL_DIR` 后再运行安装命令。

## 快速开始

安装并重启会话后，随便发一句话：

- 发问题 → 立刻听到「我看看」，答完听到结论（如「对」）。
- 下指令 → 立刻听到「好，这就做」，干完听到「改好了，记得重启」。

安装结束会自动播放测试音，并输出每一项检查结果。

## 使用示例

结果播报来自 Agent 最终回复里的 `<<voice: ...>>` 标记。这个标记专门为耳朵写：短、直接、优先说结论或下一步。

## 工作原理

| 时刻 | 谁决定说什么 | 你听到 |
|---|---|---|
| 你提交 | hook 按关键词粗判输入类型（`scripts/opening.mjs`，两个 Agent 共用） | 我看看 / 好，这就做 / 收到 |
| Agent 答完 | **模型**写 `<<voice: …>>` 标记 | 真正的结论；缺标记则静默 |

hook 脚本本身是"复读机"——只负责播放。播放在后台进行，hook ~200ms 返回，绝不阻塞 Agent。朗读文本硬上限 60 字。

## 仓库结构

```text
voice-reply/
├── scripts/
│   ├── speak.mjs        # 核心：文本 → Edge TTS mp3 → 跨平台播放
│   ├── opening.mjs      # 共享的开场提示规则（两个 Agent 共用）
│   ├── claude-hook.mjs  # Claude Code hook 入口
│   ├── codex-hook.mjs   # Codex hook 入口
│   ├── codex-notify.mjs # Codex notify 兜底
│   └── manage-hooks.mjs # 幂等地安装/卸载 hooks（先备份）
├── install.sh / setup.sh / uninstall.sh / test.sh
├── SKILL.md / README.md / README.en.md / LICENSE / .gitignore
└── agents/openai.yaml
```

运行时数据在 `~/.voice-reply/`：`config.json`（音色/语速/音量）、`hooks.json`（开关与固定文案）、`cache/`（开场缓存）。

## 运行要求

- Node 18+
- Python 3（用于运行 edge-tts，安装在本地 venv）
- 音频播放器：macOS 自带 `afplay`，或 Linux/Windows 上的 `ffplay` / `mpv` / `mpg123`
- 网络（[edge-tts](https://github.com/rany2/edge-tts) 使用微软的语音端点）

内置**中文 + 英文**两套开场词与分类规则。安装时可选择固定中文、固定英文，或按每条消息自动切换。加更多语言可扩展 `scripts/opening.mjs` 的语言包。

## 没声音？

先跑自检,它会逐项告诉你哪一环断了：

```bash
node scripts/doctor.mjs
```

常见原因：

- **装完没重启 agent** —— hook 在会话启动时加载,改完必须重启 Claude Code / Codex。
- **没装播放器**(Linux/Windows)—— 装 `ffplay`(ffmpeg)、`mpv` 或 `mpg123`;macOS 自带 `afplay`。
- **hook 没注册,或命令路径被加了引号** —— 重新运行一键安装命令,会把 hook 写成正确格式。
- **Codex 这个版本不支持 hooks**(部分旧版 / 某些 Windows 构建)—— 用 `notify` 兜底:`node scripts/manage-notify.mjs add "$(pwd)"`,然后重启 Codex。它接管 Codex 的 `notify`(会**保留并链式调用**你原有的 notify),**只在"完成"时播报 voice 标记、没有开场提示**。
- **edge-tts 没装上** —— 重新运行一键安装命令(需要 python3 + 网络)。

安装流程结尾会自动跑一次 doctor 并播一句测试音,听到就说明声音正常。

## 协议

[Apache License 2.0](LICENSE)
