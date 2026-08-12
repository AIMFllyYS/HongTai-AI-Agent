# Issue #7：CLI sharp 安全升级设计

> 状态：2026-08-10 定案，等待实现与 Windows CLI 端测。本文只定义 Issue #7 的范围、架构边界与验收契约；当前能力结论仍以 [`docs/当前能力与发布状态.md`](../../当前能力与发布状态.md) 为准。

## 1. 结论

CLI 本地图片观察入口目前通过 `packages/node-runtime` 的 `SharpImagePreprocessor` 解码用户选择的 JPEG、PNG 和 WebP。锁文件解析到 `sharp 0.34.5` / libvips `8.17.3`，`pnpm audit --prod` 因 [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) 报告唯一一个 HIGH 并以退出码 1 结束。该公告明确 `<0.35.0` 受影响，并建议预构建二进制用户升级到当时最新的 `sharp 0.35.3`。

本 Issue 采用以下最小修复：

1. 在 `packages/node-runtime/package.json` **精确固定** `sharp` 为 `0.35.3`，由 `pnpm-lock.yaml` 锁定完整平台可选包与完整性摘要；
2. 根 `package.json` 增加 `engines.node = ">=22.0.0"`，与 README 推荐的 Node 24、`@capacitor/cli 8.0.0` 的 Node 22 下限和 sharp 0.35 的 Node 20.9 下限保持一致；
3. 原则上不改 `SharpImagePreprocessor` 生产实现，只用专责契约测试证明升级未改变方向修正、2048 限边、JPEG 输出和稳定错误映射；
4. 安全 RED 是升级前真实的 `pnpm audit --prod` HIGH，而不是在仓库中实现或运行公开漏洞载荷；
5. 最终端测运行 Windows 上真实的 `pnpm cli diagnosis serve` 子进程，通过回环 HTTP 上传固定合成图片；AVD 不能验证 Node 原生依赖，不作为 Issue #7 证据。

## 2. 已确认事实

### 2.1 真实调用链

```text
pnpm cli diagnosis serve
  -> apps/cli/src/index.ts
  -> createDiagnosisHarnessServer
  -> SharpImagePreprocessor.normalize
  -> sharp / bundled libvips
  -> FileDiagnosisRepository/source/normalized-image.jpg
```

- `apps/cli/src/index.ts` 在 `diagnosis serve` 中直接构造 `SharpImagePreprocessor`。
- `packages/node-runtime/src/ai/sharp-image-preprocessor.ts` 只接受 JPEG、PNG、WebP，原始字节上限为 15 MiB，调用 `rotate()`、最长边 2048 的 `inside` resize，再输出质量 90、4:4:4 的 JPEG。
- `packages/node-runtime/package.json` 是唯一声明 `sharp` 的 workspace 包；`pnpm why sharp` 只有这一条生产路径。
- `apps/web`、`packages/capacitor-runtime` 与 `android/app` 不导入 `@hongtai/node-runtime` 或 `sharp`。现有 release APK 清单不包含 sharp/libvips，只包含 Android HEIF fallback 自己的原生库。
- CLI 包为 `private`，没有 `bin` 或独立可执行文件发布流程；真实支持形态是开发机上的 `pnpm cli ...` / `tsx`，不能描述成已发布的独立 CLI 二进制。

### 2.2 基线观测

2026-08-10 的只读基线为：

| 项目 | 观测值 |
| --- | --- |
| Windows Node | `v24.15.0` |
| pnpm | `10.30.0` |
| 平台 | `win32/x64` |
| sharp | `0.34.5` |
| libvips | `8.17.3` |
| 输入能力 | JPEG、PNG、WebP 的 file/buffer/stream 均可用 |
| 生产审计 | 1 HIGH，`packages__node-runtime>sharp`，退出码 1 |
| 现有定向测试 | 1×1 PNG 经真实 preprocessor 转为 JPEG 并保存；没有方向、限边、损坏与精确 15 MiB 边界用例 |
| 本地 AI 配置 | 当前 worktree 无 `.env`，不能依赖真实供应商完成无人值守端测 |

这些是开始实现前的时间点事实，不得改写成升级后的结果。最终版本、libvips 版本和审计计数必须从实现后的 fresh install 与实际运行重新记录。

## 3. 官方兼容与许可依据

- [GitHub Advisory GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)：受影响版本 `<0.35.0`，修复版本 `0.35.0`，并建议预构建二进制用户升级到 `0.35.3`。
- [sharp 0.35.0 变更说明](https://sharp.pixelplumbing.com/changelog/v0.35.0/)：Node 最低版本提高到 `20.9.0`，升级到 libvips `8.18.3`，删除的是已弃用的 `failOnError`；本仓库使用的 `failOn: "error"` 不受该删除影响。
- [sharp 0.35.3 变更说明](https://sharp.pixelplumbing.com/changelog/v0.35.3/)：包含额外的尺寸、数值与边界校验，因此选择最新修复线的 `0.35.3`，而不是只满足公告下限的 `0.35.0`。
- [sharp 安装要求](https://sharp.pixelplumbing.com/install/)：Node `>=20.9.0`，平台预构建包通过 optional dependencies 安装；锁文件必须保留跨平台可选依赖。
- [sharp 源码与许可](https://github.com/lovell/sharp)：sharp 使用 Apache-2.0。
- [libvips 源码与许可](https://github.com/libvips/libvips)：libvips 使用 LGPL-2.1-or-later。

本仓库当前不发布独立 CLI 安装包，也不把 sharp/libvips 打进 APK，因此本 Issue 不新增 Android 第三方许可文件。实现阶段仍需用安装包元数据和生产依赖许可清单核对实际解析结果，并在 CLI 文档说明依赖范围。若未来分发独立 CLI，必须另行审查 Apache/LGPL notice、源代码替换/重新链接义务和各平台二进制清单，不能沿用“仅开发期本地回归”的结论。

## 4. 任务契约

### 目标

- 用户可感知的结果：开发机运行 `pnpm cli diagnosis serve` 时，不再使用公告标记为 HIGH 的 sharp 版本；合法图片仍能按原契约输出标准 JPEG，损坏或超限图片仍返回稳定错误。
- 工程结果：`pnpm audit --prod` 中 GHSA-f88m-g3jw-g9cj 消失，Windows fresh install 能加载被锁定的 sharp 原生包，Node 运行时下限在根包与文档中显式一致。

### 允许修改

- `package.json`
- `packages/node-runtime/package.json`
- `pnpm-lock.yaml`
- `tests/sharp-image-preprocessor.test.ts`
- `tests/fixtures/images/` 下本 Issue 的小型合成 fixture、生成脚本和 provenance 文档
- `tests/diagnosis-harness.test.ts`，仅补稳定 HTTP 错误与不创建会话的集成断言
- `README.md`
- `docs/CLI运行与产物说明.md`
- `docs/当前能力与发布状态.md`
- `docs/验收/2026-08-10-cli-sharp-security.md`

### 明确不做

- 不修改 `packages/node-runtime/src/ai/sharp-image-preprocessor.ts`，除非 0.35.3 的真实编译或契约测试证明现有 API 不兼容；任何例外都必须先给出失败证据并保持最小改动。
- 不扩大接受格式，不增加 GIF、TIFF、SVG、HEIF、AVIF 或远程 URL 解码。
- 不改变 15 MiB 原始输入、20 MiB Harness 请求体、2048 最长边、JPEG 质量、色度采样、错误码或 action。
- 不修改 AI Flow、Prompt、Schema、报告、会话状态机或供应商配置。
- 不修复 Issue #8 的 `innerHTML` 注入；本 Issue 的端测只调用 HTTP API，不在浏览器中渲染模型文本。
- 不新增 CI；CI 自动化属于 Issue #23。
- 不修改 Web、Capacitor、Kotlin、Gradle、Android native 或 release 版本号，不重建或重签 APK来伪造 sharp 验证。
- 不使用 `pnpm audit --fix`、`--force`、跳过 optional dependencies、忽略脚本或 TLS 校验放宽来掩盖问题。
- 不提交 `.env`、API Key、Authorization、模型 reasoning、TEMP clone、node_modules、证书、私钥或端测工作区。

### 架构归属

- 所属层：`apps/cli` 开发回归组合入口与 `packages/node-runtime` Node 平台运行时。
- 依赖方向：CLI 可以依赖 node-runtime；Web/Capacitor/Android 不得反向导入 node-runtime。
- `SharpImagePreprocessor` 仍是唯一 Node 图片规范化实现，不新增 wrapper、adapter 或第二套规则。
- fixture 与测试只验证公开的 `normalize(data, mimeType)` 契约，不把 libvips 英文错误、内部线程数或平台文件名变成业务契约。

### 权威状态与数据

- 依赖声明权威：`packages/node-runtime/package.json` 中精确的 `sharp: "0.35.3"`。
- 解析与完整性权威：`pnpm-lock.yaml` 中 sharp 0.35.3 及平台 optional dependency 的 resolution/integrity。
- Node 下限权威：根 `package.json` 的 `engines.node >=22.0.0`；README 继续推荐 Node 24。
- 当前安全状态权威：实施时刻的 `pnpm audit --prod` 输出与退出码。审计结果会随公告数据库变化，不是永久保证。
- Windows 可执行状态权威：fresh TEMP clone 中 `sharp.versions`、`process.platform/arch` 和真实图片规范化结果，而不是现有 `node_modules`。
- 图片行为权威：固定 fixture、专责 preprocessor 测试及真实 CLI 产生的 `normalized-image.jpg`。
- APK 边界权威：静态依赖测试、源码导入图和现有 artifact 清单；AVD 不能证明 Node sharp 已升级。
- 端测 `sessionId` 只存在于新建 TEMP workspace；失败、进程终止或测试结束后不得留下监听端口。TLS 私钥必须在 `finally` 中按精确路径删除，非敏感证据保留到 review 完成。

### 验收

- 定向测试：preprocessor 的方向/限边/JPEG/损坏/超限契约，现有 diagnosis harness 集成，APK runtime boundary。
- 安全审计：升级前 RED 为 1 HIGH；升级后 `pnpm audit --prod` 退出 0 且 GHSA 不再出现。若出现与 sharp 无关的低/中项，验收记录逐项说明；任何 sharp HIGH 仍然阻断。
- 构建/lint：实现稳定后只运行一次 `pnpm check`。文档阶段不重复全量检查，只做 UTF-8、链接、diff 与 staged 检查。
- 真实端测：Windows fresh clone 运行真实 `pnpm cli diagnosis serve`，用受信任的临时 localhost TLS mock Provider 和回环 HTTP API完成成功、损坏与超限场景。
- Android：只证明依赖隔离与既有 APK 清单无 sharp/libvips；不运行 AVD来宣称 Node 路径通过。
- 用户实际会看到：CLI 正常启动，合法图片仍生成报告和标准 JPEG；无效图片仍显示稳定中文错误，不暴露 libvips 文案。

### 交付说明

- 改了什么：精确升级依赖、显式 Node 下限、增加可追溯行为 fixture/test、完成 Windows CLI 端测和审计证据。
- 刻意没有做什么：不重写生产预处理器，不修 #8，不改变 APK，不新增 CI或格式支持。
- 剩余风险：审计数据库会变化；目前只验证 Windows x64 fresh install，其他 Node 支持平台由 lockfile/optional dependency 保留但不冒充实际运行；独立 CLI 正式分发许可仍需单独门禁。

## 5. Fixture 与行为测试设计

实现阶段生成一张无用户数据的非对称四色 JPEG：原始像素为 2560×1280，四角依次为红、绿、蓝、黄，并写入 EXIF Orientation 6。生成脚本、生成时的 Node/sharp/libvips 版本、命令、原始/输出尺寸和 SHA-256 一并进入 `tests/fixtures/images/README.md`。生成脚本只用于可追溯测试数据，不进入生产路径。

规范化后应为 1024×2048 JPEG，方向已应用且不再携带待应用的 Orientation；四角应映射为蓝、红、黄、绿。像素断言使用远离压缩边界的采样点和主色阈值，不比较整张 JPEG 字节，避免编码器的非契约变化造成脆弱测试。

专责测试还覆盖：

- 输出 `mimeType` 为 `image/jpeg`，魔数为 `ffd8`，真实 metadata.format 为 `jpeg`；
- `15 * 1024 * 1024 + 1` 字节在进入 sharp 前得到 `IMAGE_TOO_LARGE/edit_input`；
- 截断 JPEG 得到 `IMAGE_INVALID/edit_input`；
- 空输入和不支持 MIME 保持既有稳定语义；
- 不断言 libvips cause/message、具体 JPEG 文件大小或内部并发参数。

## 6. Windows 真实 CLI 端测

端测必须在实现 commit 的 fresh TEMP clone 中进行：

1. `pnpm install --frozen-lockfile`，证明 lockfile 能在 Windows x64 重建，而不是复用当前 worktree 的 `node_modules`；
2. 输出 Node、pnpm、`sharp.versions.sharp`、`sharp.versions.vips`、platform/arch 与 JPEG/PNG/WebP buffer 能力；
3. 在 TEMP 内用 .NET `CertificateRequest` 生成仅用于 `localhost` 的自签测试证书，导出 PFX 与 CA PEM；不写入永久 Windows 证书库；
4. 启动本地 HTTPS OpenAI-compatible SSE mock，只返回固定、安全、符合 `diagnosis-report.v1` 的 JSON；CLI 子进程通过 `NODE_EXTRA_CA_CERTS` 信任该 CA，禁止设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`；
5. 用无敏感测试 key/model 启动真实 `pnpm cli diagnosis serve --port <ephemeral>`，`HONGTAI_WORKSPACE_DIR` 指向 TEMP，验证只监听 `127.0.0.1`；
6. 直接 POST `/api/sessions`，不打开含 `innerHTML` 的页面：
   - Orientation fixture：HTTP 201，mock 只收到一次请求，TEMP workspace 生成标准 JPEG/report/session；
   - 截断 JPEG：HTTP 400 + `IMAGE_INVALID`，不新增 session、不调用 mock；
   - 超限 Data URL：HTTP 413 + `IMAGE_TOO_LARGE`，不新增 session、不调用 mock。Base64 会先接近/超过 Harness 20 MiB 请求上限，所以精确 15 MiB 原始边界由专责单元测试负责；
7. 用 upgraded sharp 检查真实产物的格式、尺寸、方向和角点；记录 fixture/产物 SHA-256、HTTP 状态、稳定 code、运行时版本和进程日志；
8. `finally` 停止 CLI/mock 进程，确认端口关闭，并按已解析的 TEMP 绝对路径精确删除 PFX、私钥载荷和测试 key 环境；保留脱敏证据与 fresh clone 到 review 完成，不做递归广删。

## 7. Android 非适用边界

sharp 是 Node-API 原生模块，APK 没有 Node 运行时，也不经过 `packages/node-runtime`。因此：

- AVD、Photo Picker 或 Android instrumentation 无法证明 GHSA 已修复；
- 本 Issue 不触发 `versionCode`、签名、升级或物理真机门禁；
- `tests/apk-runtime-boundary.test.ts`、受影响路径检查和现有 release APK entry 清单足以证明依赖未跨入 APK；
- 如额外运行 Android 冷启动，只能称与本 Issue 无关的普通冒烟，不能写进 sharp 修复结论。

## 8. 完成条件

Issue #7 只有在以下事实同时成立时才可结束：

- `sharp` 声明与 lock 解析均为精确 `0.35.3`；
- 根 Node engine 为 `>=22.0.0`，README/CLI 指南没有相反版本描述；
- fresh Windows clone 加载的确是 sharp 0.35.3，并完成真实图片规范化；
- preprocessor 与 harness 定向契约通过，`pnpm check` 唯一一次全量运行通过；
- `pnpm audit --prod` 不再报告 GHSA-f88m-g3jw-g9cj，HIGH 为 0；
- 真实 CLI 回环 HTTP 的成功、损坏、超限场景有脱敏证据，进程与 TLS 私钥已安全收尾；
- Web/Capacitor/Android 未引入 node-runtime/sharp，现有 APK 清单仍无 sharp/libvips；
- spec compliance review 与 code quality/security review 均批准，所有重要意见已修复并只重跑受影响验证；
- 实现与验收阶段分别精确暂存并本地 commit，未 push。
