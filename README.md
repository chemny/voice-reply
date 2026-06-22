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

"说什么"的智能在模型，不在脚本：模型在每轮结尾写一行 `<<voice: ...>>`，hook 只负责把它抠出来念。缺了这行，就退回关键词打分兜底。

## 核心能力

| 能力 | 处理内容 | 输出结果 |
|---|---|---|
| 即时开场提示 | 按语种 + 类型粗判（提问/指令/其它） | 缓存语音，离线、<1 秒、后台不阻塞 |
| 决策优先的结果播报 | 模型撰写的 `<<voice:>>` 标记，缺失则关键词打分 | 一句话给结论**或要你拍板的选择**，可直接接话 |
| 中英文 | 安装时选定并锁定（也可选"自动按消息切换"） | 中文用中文词+中文声，英文用英文词+英文声 |
| 双 Agent 音色 | Claude 男声、Codex 女声（各含中/英） | 听声辨别是谁在说话 |
| 通用规则单一事实源 | `scripts/opening.mjs` | 改一处，两个 Agent、中英文同时生效 |

## 平台兼容性

| 平台 | 状态 |
|---|---|
| Claude Code | ✅ 已支持（`~/.claude/settings.json` hooks） |
| Codex | ✅ 已支持（`~/.codex/hooks.json`） |
| OpenClaw | ⚪ 未实测 |

播放层支持 macOS（`afplay`）与 Linux/Windows（`ffplay`/`mpv`/`mpg123`）。

## 安装

```bash
git clone https://github.com/chemny/voice-reply ~/.agents/skills/voice-reply
cd ~/.agents/skills/voice-reply
./setup.sh
```

`setup.sh` 会：创建 Python 虚拟环境并安装 edge-tts、生成两个音色的开场缓存、把默认配置写进 `~/.voice-reply/`，并在**征得你同意后**把 hooks 安全合并进 `~/.claude/settings.json` 和 `~/.codex/hooks.json`（先备份、不覆盖你已有的 hooks）。然后按提示把"播报标记规则"加进你的 Agent 指令文件，并**重启 Agent 会话**。

## 快速开始

安装并重启会话后，随便发一句话：

- 发问题 → 立刻听到「我看看」，答完听到结论（如「对」）。
- 下指令 → 立刻听到「好，这就做」，干完听到「改好了，记得重启」。

手动验证（不依赖 hook）：

```bash
node scripts/speak.mjs done
./test.sh        # 干跑回归检查（无音频、无网络）
```

## 使用示例

```bash
# 念一句话
node scripts/speak.mjs text --text "改好了，记得重启。" --full

# 念一个已有音频文件（跨平台播放器）
node scripts/speak.mjs play --file ~/.voice-reply/cache/opening-question-zh-CN-YunxiNeural.mp3

# 预览将朗读的文本与依赖状态，不出声
node scripts/speak.mjs summary --text "修复了参数解析并通过校验。" --dry-run
```

模型每轮结尾写的播报标记长这样：

```text
<<voice: 改好了，记得重启会话生效>>
```

## 工作原理

| 时刻 | 谁决定说什么 | 你听到 |
|---|---|---|
| 你提交 | hook 按关键词粗判输入类型（`scripts/opening.mjs`，两个 Agent 共用） | 我看看 / 好，这就做 / 收到 |
| Agent 答完 | **模型**写 `<<voice: …>>` 标记 | 真正的结论；缺标记则退回关键词打分 |

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
├── setup.sh / uninstall.sh / test.sh
├── SKILL.md / README.md / README.en.md / LICENSE / .gitignore
└── agents/openai.yaml
```

运行时数据在 `~/.voice-reply/`：`config.json`（音色/语速/音量）、`hooks.json`（开关与固定文案）、`cache/`（开场缓存）。

## 运行要求

- Node 18+
- Python 3（用于运行 edge-tts，安装在本地 venv）
- 音频播放器：macOS 自带 `afplay`，或 Linux/Windows 上的 `ffplay` / `mpv` / `mpg123`
- 网络（[edge-tts](https://github.com/rany2/edge-tts) 使用微软的语音端点）

内置**中文 + 英文**两套开场词与分类规则。**安装时会让你选一个语言并锁定**（写进 `~/.voice-reply/hooks.json` 的 `"lang"`）；想随时改：把 `lang` 设成 `"zh"`/`"en"`，或**删掉 `lang` 改回"按每条消息自动切换"**。加更多语言可编辑 `scripts/opening.mjs` 里的语言包。

## 没声音？

先跑自检,它会逐项告诉你哪一环断了：

```bash
node scripts/doctor.mjs
```

常见原因：

- **装完没重启 agent** —— hook 在会话启动时加载,改完必须重启 Claude Code / Codex。
- **没装播放器**(Linux/Windows)—— 装 `ffplay`(ffmpeg)、`mpv` 或 `mpg123`;macOS 自带 `afplay`。
- **hook 没注册,或命令路径被加了引号** —— 重跑 `./setup.sh`,会把 hook 重新写成正确(无引号)格式。
- **Codex 这个版本不支持 hooks**(部分旧版 / 某些 Windows 构建)—— 用 `notify` 兜底:`node scripts/manage-notify.mjs add "$(pwd)"`,然后重启 Codex。它接管 Codex 的 `notify`(会**保留并链式调用**你原有的 notify),**只在"完成"时播报、没有开场提示**。
- **edge-tts 没装上** —— 重跑 `./setup.sh`(需要 python3 + 网络)。

`setup.sh` 结尾会自动跑一次 doctor 并播一句测试音,听到就说明声音正常。

## 协议

[MIT](LICENSE)
