# v0.1.7 Release-only 命名与 APK 留存验收

> 日期：2026-08-14。本文记录 v0.1.7 的本地主机构建与归档证据，不代表物理真机或公开发布通过。

## 交付结论

- Android 源码身份：`versionName=0.1.7`、`versionCode=15`。
- APK 唯一产品类型：Release；不构建、不交付、不归档 Debug APK。
- v0.1.7 交付文件：`output/apk-archive/HongTai-AI-Agent-release-v0.1.7.apk`。
- 精确源码提交：`21bd759f355c4c96e2fe20b75887cf6b0f29cf82`。
- APK 大小：25,955,837 字节。
- APK SHA-256：`70A5A11074C94EB9DBC85708158C4E7A57C59AA0390F5D38AB4768A38509952A`。
- 包名：`com.hongtai.aiagent`。
- 签名证书 SHA-256：`54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。
- APK Signature Scheme v2/v3：均为 `true`；16 KiB zipalign 校验成功。

## 本次功能范围

v0.1.7 没有再增加一套业务架构。它完整继承 v0.1.6 的单次结构化 AI 生成、深度思考运行期展示、五板块渐显、自动状态更新和视频选择器返回修复；本次新增内容仅为：

1. 版本递增到 v0.1.7/code15；
2. Release 成为唯一 APK 产品与交付路径；
3. 构建脚本从 Gradle 唯一版本源读取并核对包身份；
4. 通过全部后验后自动保存版本化 APK；
5. 同版本相同字节可重复执行，同版本不同字节拒绝覆盖。

## 版本化 APK 归档

以下文件均实际存在并重新核对了包身份、版本、正式证书和 SHA-256：

| 文件 | 包内版本 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| `HongTai-AI-Agent-release-v0.1.5.apk` | 0.1.5 / 12 | 25,943,725 | `48D65860532BF1641222173BA42FFE479EA3180B3B75A146357EB44C25D1DE6D` |
| `HongTai-AI-Agent-release-v0.1.6.apk` | 0.1.6 / 14 | 25,955,765 | `6575FA8C8AE14D557959233D9BE3A62B903A276B234D646B126C1D911093BEFE` |
| `HongTai-AI-Agent-release-v0.1.7.apk` | 0.1.7 / 15 | 25,955,837 | `70A5A11074C94EB9DBC85708158C4E7A57C59AA0390F5D38AB4768A38509952A` |

v0.1.4 及更早版本只有历史 Debug/QA 证据，不属于新的 Release-only 产品谱系，因此不把 Debug APK 混入此目录，也不使用当前源码伪造历史 Release。

## 自动化和构建证据

- Release 归档定向测试及关联版本/UI 测试：29/29 通过。
- `pnpm check`：类型检查、ESLint、270/270 测试通过。
- Web production build：637 个模块构建通过。
- Release 构建入口完成 `testReleaseUnitTest`、`lintRelease`、`assembleRelease`，随后才生成版本化归档。
- 独立运行 `aapt2`、`zipalign` 和 `apksigner` 再次核对 v0.1.7，不依赖构建脚本自报结果。
- 变更文件 UTF-8/U+FFFD 与 `git diff --check` 通过。

## 尚未通过的门禁

构建时 `adb devices -l` 没有任何连接设备，因此本轮没有安装 v0.1.7，也没有声称模拟器或物理真机通过。正式公开前仍需：

1. 用户在真实手机上正常覆盖安装，不卸载、不使用降级参数；
2. 核对 v0.1.7/code15、旧数据、冷启动、舌诊/面诊、内容拆解、本地视频选择和自动状态更新；
3. 人工上传后从公网重新下载并核对字节数与 SHA-256；
4. 最后更新并部署公开下载页。
