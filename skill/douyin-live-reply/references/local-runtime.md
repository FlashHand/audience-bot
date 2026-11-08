# 本机语音识别（kit）

主播语音来自 audience-bot 仓库的 `kit/`：一个 macOS 采音 App（ScreenCaptureKit，只采 Dozin 的应用音轨）加一个本地识别桥（whisper.cpp）。它把识别出的句子写进快照文件，扩展每秒读一次。kit 由用户装、由用户或 AI 用脚本启动，不在接管直播间的对话里常驻。

运行目录默认 `~/.dozin-live-caption/`（环境变量 `RUNTIME_DIR` 可改），快照是 `<运行目录>/runtime/continuous-state.json`。

| 脚本（在 `<repo>/kit/`） | 做什么 |
|---|---|
| `install.sh` | 一次性安装：编译 whisper.cpp、下载并校验模型、编译并签名采音 App、把技能装进 `<home>/skills/` |
| `doctor.sh` | 只读检查：识别器、模型、采音 App、识别桥、快照是否在更新 |
| `start-bridge.sh` | 前台运行识别桥（`http://127.0.0.1:18761`），用后台任务启动 |
| `start-caption.sh` | 启动采音 App；已有一个在跑就拒绝再起 |
| `stop.sh` | 停掉本 kit 起的采音 App 和识别桥，模型和编译产物保留 |

## 启动前确认

1. 先跑 `doctor.sh`。缺什么就照它的提示补；系统的"屏幕录制"权限由用户在系统设置里给。
2. 识别桥已在跑就复用（`/health` 有响应），不要重复占端口；采音 App 只能有一个。
3. 采音范围是 Dozin 的整个应用音轨，没有标签页隔离：先请用户确认 Dozin 里只有目标直播间在出声。
4. 读快照确认 `audioFrames` 在增长、最新一句的时间晚于接管时刻，再把快照路径写进 `target.json` 的 `voiceFile`。快照停滞或范围不明时不写 `voiceFile`。

## 停止

用户要停语音时运行 `stop.sh`，并从 `target.json` 里去掉 `voiceFile`。只停本次启动的进程；别人起的进程和模型缓存保留。
