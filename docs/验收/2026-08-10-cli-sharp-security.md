# CLI sharp 安全升级验收记录（2026-08-10）

## 当前结论

Issue #7 的实现阶段已完成：`packages/node-runtime` 将 sharp 从锁文件解析的 `0.34.5` 精确升级到 `0.35.3`，安全公告 `GHSA-f88m-g3jw-g9cj` 已不再出现在本轮生产依赖审计中，既有图片规范化契约保持不变。

本记录当前只证明代码、锁文件、Windows x64 当前工作树运行时和定向测试通过。fresh TEMP clone 的 frozen install、真实 `diagnosis serve` 回环 HTTP、唯一一次 `pnpm check`、独立 spec/code review 尚未执行，因此 Issue #7 还不能据此关闭。

## 范围与状态权威

- 实现提交：本文件所在的 Issue #7 实现阶段提交。
- 依赖声明：根 `engines.node = ">=22.0.0"`；`packages/node-runtime/package.json` 精确声明 `sharp = "0.35.3"`。
- 解析权威：`pnpm-lock.yaml` 只包含 sharp/@img `0.35.3` 和 sharp-libvips `1.3.2`，不再包含 `0.34.5` 或 `1.2.4`。
- 生产实现：`SharpImagePreprocessor` 未改动，没有新增 wrapper、格式或并行规则。
- 非目标：未启动真实 CLI 服务、未执行漏洞载荷、未运行 AVD、未重建 release APK、未修改 Android 版本或签名。

## 安全 RED 与 GREEN

升级前的受控 RED：

- Node `v24.15.0`、pnpm `10.30.0`、Windows x64；
- sharp `0.34.5`、libvips `8.17.3`；
- `pnpm audit --prod` 报告唯一 1 个 HIGH，路径为 `packages__node-runtime>sharp`，公告为 `GHSA-f88m-g3jw-g9cj`，退出码 `1`；
- 未运行公告漏洞载荷，也未运行 `audit --fix`。

升级后的实现期 GREEN：

- 运行时加载 sharp `0.35.3`、libvips `8.18.3`；
- JPEG、PNG、WebP 的 2×1 合成 buffer 均完成真实编码和解码；
- `pnpm licenses list --prod` 将 sharp 标为 Apache-2.0，并将当前 Windows x64 预构建包标为 `Apache-2.0 AND LGPL-3.0-or-later`；本仓库当前不分发独立 CLI，未来如分发须另做完整 notice/重新链接义务审查；
- `pnpm audit --prod` 退出码 `0`；JSON 结果为 high `0`、critical `0`、总已知漏洞 `0`，公告标识不再出现。

上述审计只代表 2026-08-10 的公告库结果，不是未来持续无漏洞承诺。

## 固定图片与契约证据

合成 fixture `tests/fixtures/images/sharp-orientation-6.jpg` 由升级前 sharp `0.34.5`/libvips `8.17.3` 一次性生成：

- 只含四个纯色象限，无用户、设备、位置或网络数据；
- 物理尺寸 `2560×1280`，EXIF Orientation `6`，40580 字节；
- SHA-256：`5789c7cc69d0e2ec757cccb5f60fa8213785ed48b77735a31624b51f3313dbc6`；
- 测试读取固定二进制，不在运行时用被测 sharp 重新生成输入。

升级前和升级后的专责行为测试均证明：方向应用后输出 `1024×2048` JPEG、无待应用 Orientation，四角为蓝/红/黄/绿；截断、空输入与不支持 MIME 映射为 `IMAGE_INVALID/edit_input`；`15 MiB + 1` 在解码前映射为 `IMAGE_TOO_LARGE/edit_input`。

Harness 定向测试同时证明损坏输入返回 HTTP 400、超限请求返回 HTTP 413，两者都不创建 session 或调用 Provider。

## 已运行检查

| 检查 | 结果 |
| --- | --- |
| 升级前 Harness + APK runtime boundary | 2/2 通过 |
| 升级前 preprocessor + Harness 行为表征 | 5/5 通过 |
| 升级后 preprocessor + Harness + APK runtime boundary | 6/6 通过 |
| `@hongtai/node-runtime` typecheck | 通过 |
| `@hongtai/cli` typecheck | 通过 |
| `pnpm why/list sharp` | 唯一版本 `0.35.3` |
| Windows JPEG/PNG/WebP 最小运行探针 | 通过 |
| `pnpm audit --prod` | 退出 0，0 个已知漏洞 |

本阶段按计划没有运行 `pnpm check`、Web 全构建、真实 CLI server、fresh frozen install、AVD 或 release builder。

## APK 隔离边界

sharp 是 Node-API 原生模块，只由开发期 `apps/cli` 经 `packages/node-runtime` 使用。`apps/web`、`packages/capacitor-runtime` 与 Android APK 不导入该包；APK 图片导入走 Kotlin/平台解码和 API 24/25 HEIF fallback。因此本次升级不需要 Android `versionCode`、签名或模拟器验收，Android 运行不能证明 Node 漏洞已修复。

## 后续验收

下一阶段必须在本实现提交的 fresh TEMP clone 中完成 `pnpm install --frozen-lockfile`、Windows x64 原生加载与真实 CLI 回环 HTTP 的成功/损坏/超限场景，随后只运行一次 `pnpm check`，再经 spec compliance 与 code quality/security review。所有临时证书、进程、端口和测试环境变量必须按已记录目标精确收尾。
