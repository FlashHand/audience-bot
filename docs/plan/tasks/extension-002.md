---
id: extension-002
scope: 主播语音第一步：按标签页采音自检（audio 能力、target.json voice=tab、面板音量行、日志汇总）
status: implemented; owner verification pending
depends-on: [extension-001, Dozin extension-live-001]
verify: "yarn test（test/douyinLive.test.mjs 单独跑）；实机五项见 design.md #8.1，由 Ral 验收"
---

# extension-002

契约：[design.md](../../design.md) #8.1。Dozin 侧采音底座：`extension-live-001`（2026-11-08 Ral 恢复）。

- 2026-11-08 15:01：实现。`voice.mjs`（采音、每秒音量、10 秒汇总、失败原因与重试：平台不支持等不重试，刷新导致的结束 3 秒后重新采）；面板标题下加状态行；`target.json` `voice: "tab"`；清单加 `audio`（不加 `platforms`）。douyinLive 12、miniapp 8 通过；用 Dozin 的清单解析与安装代码核对：清单通过、扩展四个文件装上。没有识别、不进对话。真直播间五项待 Ral；独立复核未跑。
