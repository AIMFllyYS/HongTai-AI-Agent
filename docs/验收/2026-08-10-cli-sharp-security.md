# CLI sharp 安全升级验收记录（2026-08-10）

## 当前结论

Issue #7 的实现和 Windows x64 CLI 端测已完成。验收基线为提交
`0c328339451c891a3b6c33a99e5f4c1d108842bd`：`packages/node-runtime` 精确依赖
`sharp 0.35.3`，fresh `git archive` 副本经 frozen install 后实际加载 sharp `0.35.3`、
libvips `8.18.3`，`pnpm audit --prod` 退出码为 0，且真实 `diagnosis serve` 成功、
损坏和请求级超限场景均符合稳定 HTTP 契约。

原 clean Git 工作树上的唯一一次权威 `pnpm check` 为 218/218 通过。fresh archive
不带 `.git`；两份中文文档实际存在于 `head.tar`，但 Windows `tar` 展开时误解码其 UTF-8
路径；被忽略的外部 `android/.native-deps` 源码缓存也不在副本中。其 full check
因此只作为“该 Windows 展开副本不能运行仓库级验收测试”的透明诊断，不作为产品失败或权威
full gate。独立 spec 与 quality review 均已批准，本 Loop 的代码、Windows x64 CLI 端测与审查已收口。

本结论只覆盖 Windows x64 CLI。Linux、macOS 预构建二进制未验证；sharp/libvips 不进入
Web、Capacitor 或 APK 路径，本轮没有重建 APK、运行 AVD 或声称 Android 端测。

## 范围与状态权威

- 实现与验收 HEAD：`0c328339451c891a3b6c33a99e5f4c1d108842bd`。
- 声明权威：根 `engines.node = ">=22.0.0"`；`packages/node-runtime/package.json`
  精确声明 `sharp = "0.35.3"`。
- 解析权威：`pnpm-lock.yaml` 只解析 sharp/@img `0.35.3` 和 sharp-libvips `1.3.2`，
  不再包含 `0.34.5` 或 `1.2.4`。
- 生产实现：`SharpImagePreprocessor` 未新增 wrapper、格式或并行规则；既有方向修正、
  2048 限边、JPEG 输出和稳定 `TaskError` 契约保持不变。
- 非目标：未运行漏洞载荷、未修改 Android 版本或签名、未构建 release、未运行 AVD、
  未验证 Linux/macOS 或未来公告库状态。

## 安全 RED 与 GREEN

升级前的受控 RED：

- Node `v24.15.0`、pnpm `10.30.0`、Windows x64；
- sharp `0.34.5`、libvips `8.17.3`；
- `pnpm audit --prod` 报告唯一 1 个 HIGH，路径为 `packages__node-runtime>sharp`，
  公告为 `GHSA-f88m-g3jw-g9cj`，退出码 `1`；
- 未运行公告漏洞载荷，也未运行 `audit --fix`。

升级和 fresh install 后的 GREEN：

- sharp `0.35.3`、libvips `8.18.3`、平台 `win32-x64`；
- `pnpm why sharp -r` 只发现一个 sharp 版本，唯一生产调用方为
  `@hongtai/node-runtime`；
- `pnpm audit --prod` 退出码 `0`，输出为 `No known vulnerabilities found`；
- 以上只代表 2026-08-10 时点的公告库结果，不是未来持续无漏洞承诺。

## Fresh install 与 full gate

在仓库外唯一 TEMP 根目录中执行 `git archive HEAD`，archive SHA-256 为
`fdfa4d658b80b369a7e1cc12521d89062e748ddb4324a77f71dd2c4370b06282`。
展开目录不含 `node_modules`，随后运行 `pnpm install --frozen-lockfile`；安装新建副本内
`node_modules`，仅复用全局 pnpm store 的包缓存
`C:\Users\AIMFl\AppData\Local\pnpm\store\v10`，没有复用另一副本的 `node_modules`。

fresh archive 中误触发的一次 `pnpm check` 得到 216 tests、209 pass、7 fail。Python
`tarfile` 复核证明中文架构/HEIF 文档都存在于 `head.tar`；失败前置来自 archive 无 `.git`、
Windows `tar` 将两份中文路径误解码，以及被忽略的外部 `android/.native-deps` 源码缓存
不在副本中。这不是有效 Git checkout 的 full gate。
保留该日志是为了不隐藏验收环境失配。

回到运行前仍为 clean 的原 Git 工作树后，仅运行一次权威 `pnpm check`：

| 检查 | 结果 |
| --- | --- |
| TypeScript typecheck | 通过 |
| ESLint | 通过 |
| Node test | 218 tests / 218 pass / 0 fail |
| sharp 方向、损坏、15 MiB 前置上限测试 | 全部通过 |
| diagnosis harness HTTP 契约测试 | 全部通过 |

## 真实 Windows CLI 回环端测

端测使用 fresh install 副本启动真实
`pnpm cli diagnosis serve --port 51732`，工作区指向同一 TEMP 证据根。另一个 Node
HTTPS OpenAI-compatible SSE mock 只监听 `127.0.0.1:51731`；CLI 只监听
`127.0.0.1:51732`，`Get-NetTCPConnection` 未发现任一端口绑定通配地址或外部网卡。

TLS 没有被关闭：使用 Git 随附 OpenSSL 临时生成独立 CA 和 `localhost` 服务端证书，
SAN 为 `DNS:localhost` 与 `IP:127.0.0.1`，`openssl verify` 通过；CLI 只通过
`NODE_EXTRA_CA_CERTS` 信任该临时 CA，没有写 Windows 证书存储。mock 只记录调用时间、
路径、测试模型名、是否流式、消息数、是否包含 JPEG data URL、鉴权方案和请求字节数，
不保存测试 key、提示词或图像正文。

固定图片 `tests/fixtures/images/sharp-orientation-6.jpg` 的 SHA-256 为
`5789c7cc69d0e2ec757cccb5f60fa8213785ed48b77735a31624b51f3313dbc6`，
物理尺寸 `2560×1280`、EXIF Orientation `6`，不含用户或设备数据。真实 HTTP 结果：

- 正向请求返回 HTTP 201，HTTPS provider 恰被调用一次；会话只公开
  `{ "mimeType": "image/jpeg" }`，HTTP 响应和 `session.json` 均不泄露私有绝对路径；
- 私有 `source/normalized-image.jpg` 为 30794 字节 JPEG，尺寸 `1024×2048`，不带待应用
  Orientation；蓝/红/黄/绿四象限采样证明 Orientation 6 已实际应用；
- 截断 JPEG 返回 HTTP 400 + `IMAGE_INVALID`，不调用 provider、不新增会话；
- 16 MiB 原始数据经 base64 包装后触发真实 20 MiB HTTP JSON request guard，返回
  HTTP 413 + `IMAGE_TOO_LARGE`，同样不调用 provider、不新增会话。这一项只证明请求级
  20 MiB 门禁，不冒充 preprocessor 的 15 MiB 契约；后者由 218/218 中的专责单测覆盖。

## APK 隔离边界

sharp 是 Node-API 原生模块，只由开发期 `apps/cli` 经 `packages/node-runtime` 使用。
对 `apps/web`、`packages/capacitor-runtime`、`android/app/src` 的精确只读检索没有
sharp/libvips 引用；`LIBSHARPYUV` 是 libheif 的另一独立选项，不是 sharp。

本轮只读检查既有 v7 release APK，SHA-256 为
`85c669347ed6c9d80fcf085d20a841b2c62a5dea2ee7462501633e5a996f4a0f`；
460 个 ZIP entry 中没有 sharp/libvips。本结果说明该 CLI 升级不适用于 APK 运行路径，
不代表本轮重建或重新验收了 Android release。

## 证据与清理

- TEMP 根：
  `C:\Users\AIMFl\AppData\Local\Temp\HongTai-Issue7-Acceptance-20260810-083353-8218318`；
- 脱敏 manifest：`manifest.json`；
- manifest SHA-256：
  `826c4643c4364cafe8891c4a4a8be00bfe3ab18924372d6d4b3ae5765c4d4bfa`；
- manifest 固定 16 项安装、审计、运行、HTTP、APK 和 full-check 证据文件哈希；fresh
  archive、副本 node_modules、运行产物、公有证书与非私密日志保留，便于复核；
- CLI 与 mock 已通过各自会话精确停止，复核两个端口无监听残留；
- 仅精确删除本轮生成的 `ca-private.key`、`server-private.key`，两者已确认不存在。
  这是直接文件删除，不能由本流程恢复，但未删除用户数据；未做广泛 TEMP 清理。
