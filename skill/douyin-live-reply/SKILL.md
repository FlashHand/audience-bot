---
name: douyin-live-reply
description: >-
  通过 Gateway 接管抖音直播间对话：douyin-live 扩展在直播间标签页里收弹幕、读主播语音转写，交给 Gateway；
  Gateway 把它们以事件推进接入的对话，对话 AI 用 gateway_send 回弹幕。对话里不起任何后台进程。
  用于“对这个直播间开启AI回复功能”“接管这个抖音直播间”“开启直播间监控”及明确的换房间请求。
---

# 抖音直播间接管（扩展 + Gateway）

收发由 audience-bot 仓库的 `miniapp/extension/` 扩展完成，Gateway 负责把消息送进对话（设计见仓库的 `docs/design.md`）。本对话**不轮询、不起后台进程**：弹幕和主播语音以 `<gateway_messages>` 事件到达。

下文 `<home>` 是应用主目录（Dozin Preview 为 `~/.dozin_preview`，正式版 `~/.dozin`）；`<repo>` 是用户 clone audience-bot 仓库的目录，不知道就问用户。

## 0. 前提

- `gateway_sources`：Gateway 必须是 `open`。不是就请用户在 设置 › Gateway 打开，停在这里。
- 看结果里有没有 `douyin-live`（种类 `extension`）：
  - 有：扩展已在运行，跳到第 1 步。
  - 没有：确认 `<home>/extensions/packages/douyin-live/` 是否存在。不存在就 `miniapp_install` `<repo>/miniapp`（小程序和扩展一起装）。然后用 `menu {"tab":"extensions"}` 打开 设置 › Extensions，请用户批准并打开 `douyin-live`。用户说好了，再调 `gateway_sources` 确认出现 `douyin-live`；没出现就停下，说明卡在哪一步。
- 定位用户指定的 `https://live.douyin.com/<room>` 标签页，用 `page_snapshot` 确认是直播间、已登录、输入框在。只用这个标签页。
- 取得本账号显示名（用户给过就沿用），作为 `ownName`：自己的消息只作上下文，绝不回复。

## 1. 写目标

写 `<home>/extensions/data/douyin-live/target.json`：

```json
{ "tabId": "tab-28", "room": "123456789012", "ownName": "<本账号的显示名>", "voiceFile": "~/.dozin-live-caption/runtime/continuous-state.json" }
```

- `voiceFile` 只在要主播语音时写：先按 [references/local-runtime.md](references/local-runtime.md) 确认采音程序和识别桥在跑、快照在更新（由仓库 `kit/` 的脚本启动，不在本对话里起）。路径写绝对路径（把 `~` 展开）。采音范围是整个应用音轨，先请用户确认 Dozin 里只有这个直播在出声。不要语音就不写这一项。
- 采音自检（Ral 2026-11-08 选按标签页采音，第一步）：用户要试时在 `target.json` 加 `"voice": "tab"`，这时不读 `voiceFile`。扩展只采这个标签页的声音、每秒在直播间左下角面板写一行「采音：本标签页 · 音量 … dB / 静音」，还不识别、不进对话。请用户按设计 #8.1 的五项看：有声时音量跳动、另一个标签页出声时这里仍静音、直播声音照常外放、不弹录屏权限、刷新后接着采。面板写「采音失败：…」时把原因告诉用户。
- 扩展每秒读这个文件，内容变了就换目标。

## 2. 允许标签页

用 `menu {"tab":"extensions"}` 打开 设置 › Extensions，请用户在 `douyin-live` 的标签页授权里填 `tabId` 并点授权。扩展不能自己拿标签页。之后 `gateway_sources` 里 `douyin-live` 的状态是 `live` 才算接上。

## 3. 接入对话与人设

- `gateway_attach {"source":"douyin-live","target":"this"}`；用户要求时 `target` 用 `"new"`、`"new_child"` 或某个子对话 id。
- 用户给的人设与风格写进 `gateway_sources` 里 `douyin-live` 的 `agent_md`（`<home>/connectors/douyin-live/Agent.md`）：例如主播优先；温和幽默，不攻击身体或能力；不虚构个人经历；索要礼物时按用户给的固定话术；60 秒没人说话可以起一个相关的短话题。已有内容先读，只改用户要改的部分。改了下一条消息起生效。
- 扩展自带的系统提示词（每条回复针对一条消息、不超过 50 字、自己的消息不回、不谈钱和隐私）改不了，冲突时以它为准。

## 4. 回复

- 收到 `<gateway_messages>` 后按规则决定回不回。要回就 `gateway_send {"source":"douyin-live","text":"…","reply_to":"#n"}`，一次调用即完成发送。不要自己找输入框、点按钮或看页面。
- 文字不加 @：回观众时扩展按 `reply_to` 加 `@昵称`（放得下才加）。总长 ≤ 50。
- 回执 `verified: true` 才算发出。`verified: false`、`receipt_timeout` 或 `not_sent` 时先看下一批消息里有没有回显，绝不直接重发同一句。`input_busy` 表示输入框里有用户自己的草稿，不要动它。
- 主播明确拒绝 AI 互动时停止发言，并告诉用户。

## 5. 换房间与停止

- 换房间：改写 `target.json` 的 `tabId` / `room`，再请用户授权新标签页（第 2 步）。对话不用重新接入。
- 停止回复：`gateway_detach {"source":"douyin-live"}`。要扩展也停下，请用户在 设置 › Extensions 关掉 `douyin-live`；删掉 `target.json` 可让它放开标签页。

## 没有扩展时（旧方式，只收弹幕）

扩展装不上（例如在 Cowork 里）时，读 `scripts/douyin-source.js`，把 `__OWN_NAME__` 换成 JSON 字符串，调用 `gateway_register`（`tab_id` 为直播间，`source` 为 `{"schema":"dozin.gateway.source/v1","type":"douyin-live","instance":"<room>","title":"抖音 · <主播名>","systemPrompt":"…","send":{"enabled":true,"maxLength":50,"maxPerMinute":4},"roles":{"host":"主播","viewer":"观众","self":"自己"}}`），再 `gateway_attach douyin-live#<room>`。这种方式没有主播语音，也不起后台转发。
