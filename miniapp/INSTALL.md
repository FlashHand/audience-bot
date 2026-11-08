# Audience BOT · 安装手册（给 Agent）

装好后，在用户说「安装小程序」的这个对话里，按顺序做完：

1. **打开**：`open_miniapp`，`miniapp_id` = `miniapp:io.github.flashhand.audience-bot`。
2. **扩展**：直播间的弹幕收发靠扩展 `douyin-live`。
   - `miniapp_install` 的结果里有 `extension` 且还没批准，或用户说扩展还没装好：告诉用户到 设置 › Extensions 批准并打开 `douyin-live`；用户要你带他去时，用 `menu` 打开 `extensions`。不要替用户批准。
3. **告诉用户怎么开始**（三句以内，小程序里「上手三步」也写着）：
   - 在 Dozin 浏览器打开直播间 `live.douyin.com/房间号`，登录要发弹幕的账号。
   - 在直播间旁的对话里说「接管这个抖音直播间」。
   - 在小程序里写 BOT 的人格，保存后下一条回复起生效；也可以直接跟 AI 说想怎么改人格。

小程序本身不接 Gateway：它只读写人格文件 `<home>/connectors/douyin-live/Agent.md`。和对话收发消息的是扩展的 connector。
