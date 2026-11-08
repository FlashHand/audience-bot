# audience-bot · 抖音直播间 AI 助手（Dozin）

An AI assistant for Douyin (抖音) live rooms, built for [Dozin](https://dozin.ai): live comments and the host's voice flow into a Dozin chat, and the chat's AI replies as comments, following a persona you write.

Audience BOT 让 Dozin 里的一个 AI 对话接管抖音直播间：弹幕和主播语音进入对话，AI 按你写的人格回弹幕。对话里不起后台进程，消息由 Dozin 的 Gateway 推进对话。

## 组成

| 目录 | 是什么 |
|---|---|
| [`miniapp/`](miniapp/) | Dozin 外置小程序"Audience BOT"：编辑 BOT 的人格（`Agent.md`），提示也可以和 AI 聊天来改。安装它时一起装下面的扩展 |
| [`miniapp/extension/`](miniapp/extension/) | 小程序带的 Dozin 扩展：在直播间标签页里收弹幕、读主播语音、发回复，注册一个 Gateway connector |
| [`skill/douyin-live-reply/`](skill/douyin-live-reply/) | 技能：教 Dozin 的 AI 一句话接管直播间 |
| [`kit/`](kit/) | 本机语音识别（macOS）：把主播的话转成文字给扩展读 |
| [`docs/design.md`](docs/design.md) | 设计：组成、消息流、两层提示词、人格页行为 |

## 现状（v0.1.0）

| 部分 | 状态 |
|---|---|
| 扩展、技能、语音识别 kit | 可用；需要支持 Gateway 对话接入（connector `chat`）的 Dozin 版本。真直播间里的发送还没有实测 |
| 小程序（人格页） | 代码与测试完成；需要 Dozin 支持外置小程序和 `MAESTROSDK.connectors`，在这之前页面会提示版本不支持 |
| 语音识别 | 只支持 macOS 13+；采的是 Dozin 整个应用的声音，用之前确认 Dozin 里只有目标直播间在出声 |

## 安装

1. `git clone https://github.com/FlashHand/audience-bot.git`
2. **小程序和扩展**：在 Dozin 对话里说「安装小程序 <clone 的目录>/miniapp」。小程序和它带的扩展一起装上（Dozin 的 `miniapp_install`）；然后在 设置 › Extensions 批准并打开扩展 `douyin-live`。
3. **技能和语音识别**（要主播语音时）：在 macOS 上运行 `kit/install.sh`（需要 Xcode Command Line Tools 和 cmake），它会编译识别器、下载并校验模型、签名采音 App，并把技能装进 Dozin 的技能目录。只要弹幕不要语音时，可以只把 `skill/douyin-live-reply/` 复制到 `~/.dozin/skills/`。
4. **打包**（可选）：`yarn install && yarn pack:miniapp` 生成 `dist/io.github.flashhand.audience-bot-<version>.asar`，里面同样含扩展。

## 使用

1. 在 Dozin 的浏览器里打开直播间 `https://live.douyin.com/<房间号>`，登录要发弹幕的账号。
2. 要语音时运行 `kit/start-bridge.sh` 和 `kit/start-caption.sh`（`kit/doctor.sh` 检查状态，`kit/stop.sh` 停止）。
3. 在直播间旁的 Dozin 对话里说「接管这个抖音直播间」，按 AI 的提示在 设置 › Extensions 允许这个标签页。
4. 在小程序"Audience BOT"里写人格，或直接在对话里让 AI 改。改了下一条回复起生效。

请遵守抖音的平台规则，AI 发出的内容由使用者负责。

## 开发

```bash
yarn install
yarn test           # 每个测试文件单独跑
yarn pack:miniapp   # 打小程序 .asar，打印 sha256
```

## License

[MIT](LICENSE)
