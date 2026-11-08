---
id: extension-001
scope: 扩展随小程序安装（miniapp/extension/ + miniapp.json extension）；监控面板 injection（观众、主播语音、AI、自己）
status: implemented; owner verification pending
depends-on: [Dozin miniapp-extension-001]
verify: "yarn test（test/douyinLive.test.mjs、test/miniapp.test.mjs，每个文件单独跑）"
---

# extension-001

契约：[design.md](../../design.md) #1、#5、#7。迭代计划：overmind `areas/agent-runtime/mini-apps/iteration/iteration-2611081427.md`。

- 2026-11-08：扩展从 `extension/douyin-live/` 移到 `miniapp/extension/`，`miniapp.json` 加 `"extension": "extension"`；用 Dozin 的安装代码把整个 `miniapp/` 装进临时主目录核对过：扩展装到 extensions、小程序目录不含扩展。监控面板 `showPanel` / `addToPanel`，观察与发送步骤喂它，扩展推主播语音；douyinLive 7、miniapp 8 通过。真直播间里的面板位置与发送未实测；独立复核未跑（复核 Agent 额度报错）。
