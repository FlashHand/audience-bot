# Audience BOT 设计

状态：v0.1.0，2026-11-08。Audience BOT 是给 [Dozin](https://dozin.ai) 用的抖音直播间 AI 助手：弹幕和主播语音进入一个 Dozin 对话，对话里的 AI 按你写的人格回弹幕。它作为**外置**部件交付：不在 Dozin 的安装包里，每个部件单独安装，Dozin 只提供通用能力。

## #1 组成

| 部分 | 目录 | 做什么 | 装到哪里 |
|---|---|---|---|
| 扩展 `douyin-live` | `miniapp/extension/` | 在直播间标签页里收弹幕、读主播语音、发回复；注册一个带 `chat` 的 Gateway connector | `<home>/extensions/packages/douyin-live/`：安装小程序时一起装，再在 设置 › Extensions 批准、打开 |
| 小程序 `io.github.flashhand.audience-bot` | `miniapp/` | 人格页：编辑 `connectors/douyin-live/Agent.md`，提示也可以和 AI 聊天来改 | `<home>/miniapps/io.github.flashhand.audience-bot/<version_code>.asar` |
| 技能 `douyin-live-reply` | `skill/douyin-live-reply/` | 教 Dozin 的 AI 接管一个直播间：写 `target.json`、请人允许标签页、接入对话、写人格 | `<home>/skills/douyin-live-reply/`（`kit/install.sh` 安装） |
| 本机语音识别 | `kit/` | macOS 采音 App（只采 Dozin 的应用音轨）+ whisper.cpp 识别桥，把主播的话写成 `continuous-state.json` | 运行目录 `~/.dozin-live-caption/` |

`<home>` 是 Dozin 的主目录：正式版 `~/.dozin`，Preview 版 `~/.dozin_preview`。

扩展里的文件：

```text
miniapp/extension/
  package.json   只有 name、dozin.capabilities ["browser"]、dozin.origins ["https://live.douyin.com"]
  index.mjs      activate(dozin)：registerConnector({ systemPrompt, chat, start, stop, send })
  room.mjs       注入直播间页面的三个 injection：showPanel（监控面板，#7）、observeRoom（观察弹幕）、sendInRoom（发一条弹幕并核对回显）；addToPanel 供扩展把主播语音加进面板
```

扩展在小程序包里：`miniapp/miniapp.json` 的 `"extension": "extension"` 指向它，Dozin 的 `miniapp_install` 先把它装进 `<home>/extensions/packages/douyin-live/`（照旧要人批准才运行），再复制小程序（不含扩展目录）；卸载小程序时扩展一起卸掉（Dozin `docs/features/miniapp-extension.md`）。两者运行时不直接通信，只靠目录名 `douyin-live` 对上：扩展注册时 Dozin 用包名建 `connectors/douyin-live/`，人格页按这个名字读写。

## #2 Dozin 需要提供的能力

| 能力 | 用在哪 |
|---|---|
| 扩展宿主：从目录安装、按哈希批准、独立进程、把人允许的标签页交给扩展（`ctx.browser`） | 运行扩展 |
| Gateway：connectors 目录、带 `chat` 的 connector 把消息分批送进接入的对话、`gateway_send`、`gateway_attach` | 消息进对话、回复发出 |
| 外置小程序宿主：安装 `.asar`、`miniapp://<appId>/` 加载、注入 `MAESTROSDK` | 打开人格页 |
| `MAESTROSDK.connectors`：`agentMdPath`、`readAgentMd`、`writeAgentMd`（带 `stamp`）、`onAgentMdChange` | 人格页读写 `Agent.md` |

人格页用到的 SDK 形状：

```ts
interface AgentMdFile { path: string; exists: boolean; content: string; bytes: number; limit: number; stamp: string }
type AgentMdWrite = { ok: true; stamp: string } | { ok: false; reason: 'changed' | 'io'; stamp?: string };
MAESTROSDK.connectors.readAgentMd(dir): Promise<AgentMdFile>
MAESTROSDK.connectors.writeAgentMd(dir, content, { stamp }): Promise<AgentMdWrite>   // stamp 不是磁盘当前值就不写，返回 changed
MAESTROSDK.connectors.onAgentMdChange(cb: ({ dir, stamp }) => void): () => void
```

## #3 两层提示词与运行时文件

- **connector 系统提示词**：写在 `index.mjs` 的 `systemPrompt`，随扩展自带，用户改不了：每条回复只针对一条消息、不超过 50 字、自己的消息不回、不谈钱和隐私。
- **`Agent.md`**：用户的人格，写什么都行。人格页、AI、编辑器都可以改，下一条消息起生效。两层冲突时以系统提示词为准。

| 文件（在 `<home>/` 下） | 谁写 | 谁读 |
|---|---|---|
| `connectors/douyin-live/Agent.md` | Dozin 第一次建；之后是人格页、AI、人 | Gateway 每轮读进接入对话的系统提示；人格页 |
| `connectors/douyin-live/connector.json` | Dozin，每次注册 | Dozin |
| `extensions/data/douyin-live/target.json` | 技能（AI），接管或换房间时：`{ tabId, room, ownName, voiceFile }` | 扩展，每秒一次 |
| `~/.dozin-live-caption/runtime/continuous-state.json` | 语音识别程序 | 扩展（路径来自 `voiceFile`） |

## #4 人格页

- 打开时读文件填进编辑框，记下 `stamp`；保存时带上它。
- 文件在别处被改了（AI 或编辑器）：这里没有未保存的修改就自动载入并提示；有未保存的修改就让人二选一，"用别处改的"或"用我的"。保存时发现文件已被改过，同样二选一。不会悄悄覆盖任何一方。
- 超过 16 KB 时提示"超出部分不进对话"，仍可保存。
- "也可以和 AI 聊天来改"的示例句可以一键复制，复制时附上文件路径，让 AI 改对文件。
- 有未保存的修改时，刷新前用宿主的原生确认框问一次。
- Dozin 没有 `MAESTROSDK.connectors` 时，页面说明需要更新的 Dozin，编辑框不可用。

## #5 消息怎么走

| 链路 | 经过 |
|---|---|
| 接管 | 人说「接管这个直播间」→ 技能写 `target.json` → 人在 设置 › Extensions 允许标签页 → `gateway_attach douyin-live` |
| 收弹幕 | `room.mjs` 的 `observeRoom` → 扩展 `ctx.emit` → Gateway 分批 → 对话里的 `<gateway_messages>` |
| 收语音 | 语音识别 → `continuous-state.json` → 扩展（`role: host`，`modality: voice`）→ 同上 |
| 回复 | AI `gateway_send` → Gateway → 扩展 `send` → `sendInRoom` 填字、发送、5 秒内在列表里看到原文才算 `verified` |
| 监控面板 | 弹幕由 `observeRoom` 、AI 回复由 `sendInRoom`（核对成功后）在页面里直接加进面板；主播语音由扩展用 `evaluate` 调 `addToPanel` 加进去（#7） |
| 停止 | `gateway_detach douyin-live`；扩展在 设置 › Extensions 关掉；删掉 `target.json` 放开标签页 |

## #6 打包与版本

- `yarn pack:miniapp`：把 `miniapp/` 打成 `dist/io.github.flashhand.audience-bot-<version>.asar`，打印 sha256；`version_code` 写成本地构建时间 `YYMMDDHHmmss`（12 位字符串），同时写进 `miniapp.json` 和 `package.json`。
- 扩展不需要构建，目录即安装包。
- 测试：`yarn test`，每个测试文件单独跑。

## #7 监控面板

Ral 2026-11-08：「Injection 部分是要向网页注入一些信息，注册一个监控面板，这个监控面板可以体现观众、主播和 AI 发出去的消息」。

- 接管标签页时先注入 `showPanel`（injection id `audience-panel`），再注入弹幕观察。面板在直播间页面左下角，按时间列最近 20 条，四种颜色：观众（带昵称）· 主播（语音）· AI · 自己（本账号人手打的）。标题行显示条数和「收起 / 展开」。无边框。
- 内容只用 `textContent` 写入，弹幕里的标签不会变成页面元素。
- AI 发出的弹幕会被观察读回成「自己」：2 分钟内同文的只留一行，显示为 AI（读回先到或后到都一样）。
- 面板只是给人看：进对话的消息不经过它；主播语音加不进去（页面刷新中）也不影响对话。
- 扩展放开标签页（换房间、关页、停止）时 Dozin 清掉全部 injection，面板随之移除。

## #8 主播语音：按标签页采音

Ral 2026-11-08 14:58：选「恢复按标签页采音」。语音之后由扩展自己采直播间这个标签页的声音、自带识别，不再靠 `kit/` 采整个 Dozin。分两步，第一步先验证只采到这个标签页。

**原理**：Dozin 用 Electron 的 `session.setDisplayMediaRequestHandler`，回调里 `audio` 传直播间标签页的 frame（Electron 转成 Chromium 的标签页采集 ID），`enableLocalEcho: true` 让直播声音照常外放。Chromium 在声音送到扬声器之前截取这个标签页的全部声音（含其中 iframe），同进程的其他标签页不混入；不经 macOS 录屏接口。扩展只调 `ctx.browser.captureAudio(tabId)`，拿到 16 kHz 单声道 Float32 帧（Dozin `docs/features/extension-audio-transport.md`）。

### #8.1 第一步：采音自检

- 清单：`dozin.capabilities` 加 `"audio"`。不加 `platforms`：采音只在 macOS Apple 芯片上可用，别的平台采音报错，弹幕功能照常。
- `target.json` 可选 `"voice": "tab"`：接管标签页后开始采音。写了 `voice: "tab"` 时不读 `voiceFile`。
- 每秒算一次这一秒的音量（RMS，换成 dBFS，最低 -90 dB）和收到的帧数，写进监控面板标题下的一行：`采音：本标签页 · 音量 -23 dB`；没声音时显示「静音」（低于 -60 dB）。每 10 秒在扩展日志记一行汇总，不记声音内容。
- 采音失败（平台不支持、标签页没允许、超时）在面板这一行和日志里写原因；弹幕收发不受影响。放开标签页时先停采音。
- 这一步不识别、不进对话。

**实机验收**（Ral，`yarn dev:prod`）：① 直播间有声音时音量在跳；② 暂停直播、在另一个 Dozin 标签页放声音，面板仍是静音；③ 采音期间直播声音照常能听见；④ 不弹 macOS 录屏权限；⑤ 刷新直播间后能接着采。

### #8.2 第二步：识别（自检通过后）

扩展用受管辅助进程（`dozin.helpers`）跑识别：按停顿切句，每句 `ctx.emit({ role: 'host', modality: 'voice' })` 并加进面板。模型与识别引擎的选择到时另定。
