# Issue #7 sharp 安全升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CLI 本地图片解码从存在 HIGH 公告的 sharp 0.34.5 精确升级到 0.35.3，保持图片规范化契约，并以 Windows 真实 CLI 回环 HTTP 与生产审计完成验收。

**Architecture:** 依赖只存在于 `packages/node-runtime`，不改 AI Flow、Web、Capacitor 或 Android。安全 RED 由 `pnpm audit --prod` 提供；行为兼容由固定 Orientation fixture 与专责测试提供；端测在 fresh TEMP clone 中运行真实 `pnpm cli diagnosis serve`，APK 只做隔离证明。

**Tech Stack:** Node.js 24（根 engine 最低 22）、pnpm 10、TypeScript/tsx/node:test、sharp 0.35.3/libvips、PowerShell/.NET 临时 TLS、OpenAI-compatible SSE loopback mock。

---

## 任务契约摘要

- 允许路径与非目标以 [`2026-08-10-issue-07-sharp-security-design.md`](../specs/2026-08-10-issue-07-sharp-security-design.md) 为准。
- 生产状态权威依次为：精确 package/lock、实施时刻 audit、fresh Windows runtime、真实 CLI 标准 JPEG 产物。
- `SharpImagePreprocessor` 原则上不改；0.35.3 的真实失败才能授权最小兼容修改。
- 不修 Issue #8；端测直接调用 HTTP API，不渲染任何模型文本。
- 开发阶段只跑定向检查；实现稳定后运行唯一一次 `pnpm check`。review 后只有源码/lock 再变化才需要重新运行全量检查。
- 不用 AVD证明 Node sharp，不运行 release builder，不改 Android 版本或签名。

## 文件职责图

| 文件 | 操作 | 单一职责 |
| --- | --- | --- |
| `package.json` | 修改 | 声明整个 workspace 的 Node `>=22.0.0` 最低契约 |
| `packages/node-runtime/package.json` | 修改 | 精确声明 `sharp: "0.35.3"` |
| `pnpm-lock.yaml` | 修改 | 锁定 sharp、平台 optional dependency 与 integrity |
| `tests/sharp-image-preprocessor.test.ts` | 新增 | 独立验证方向、限边、JPEG、损坏与超限契约 |
| `tests/fixtures/images/generate-sharp-orientation-fixture.mjs` | 新增 | 可重复生成唯一的合成 Orientation fixture |
| `tests/fixtures/images/sharp-orientation-6.jpg` | 新增 | 无隐私、非对称、带 EXIF Orientation 6 的固定输入 |
| `tests/fixtures/images/README.md` | 新增 | 记录生成工具、命令、尺寸、颜色布局、许可与实际 SHA-256 |
| `tests/diagnosis-harness.test.ts` | 修改 | 验证生产 Harness 的稳定成功/失败 HTTP 边界与 session 副作用 |
| `README.md` | 修改 | Node 24 推荐值与 Node 22 最低值保持一致 |
| `docs/CLI运行与产物说明.md` | 修改 | 说明 CLI Node 下限、sharp 作用域和本地回归边界 |
| `docs/当前能力与发布状态.md` | 修改 | 只在验收后记录 Issue #7 的当前事实 |
| `docs/验收/2026-08-10-cli-sharp-security.md` | 新增 | 保存实施 commit、audit、fresh install、真实 CLI 与 APK 隔离证据 |

不新增生产 wrapper、版本 helper、测试 barrel 或 CI workflow。fixture generator 只有一个真实职责，测试运行时读取固定 JPEG，不在每次测试中重生成二进制。

## Task 1: 固定安全 RED 与图片行为基线

**Files:**
- Read: `packages/node-runtime/package.json`
- Read: `pnpm-lock.yaml`
- Read: `packages/node-runtime/src/ai/sharp-image-preprocessor.ts`
- Read: `tests/diagnosis-harness.test.ts`
- Evidence outside Git: a newly created Issue #7 TEMP directory

- [ ] **Step 1: 确认干净边界与实际工具链**

Run:

```powershell
git status --short --branch
node --version
pnpm --version
pnpm --filter @hongtai/node-runtime why sharp
pnpm --filter @hongtai/node-runtime exec node --input-type=module -e "import sharp from 'sharp'; console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips,platform:process.platform,arch:process.arch,node:process.version}))"
```

Expected: 只看到已知且不属于本 Issue 的改动（若有则保留）；基线仍解析到 sharp 0.34.5，平台为当前 Windows x64。不得把旧值写成升级结果。

- [ ] **Step 2: 运行安全 RED**

Run:

```powershell
pnpm audit --prod
$auditExit = $LASTEXITCODE
"auditExit=$auditExit"
```

Expected: `GHSA-f88m-g3jw-g9cj`、`packages__node-runtime>sharp`、1 HIGH，`auditExit=1`。保存脱敏输出；不要运行漏洞载荷，也不要运行 `audit --fix`。

- [ ] **Step 3: 运行现有行为与 APK 边界基线**

Run:

```powershell
pnpm exec tsx --test tests/diagnosis-harness.test.ts tests/apk-runtime-boundary.test.ts
```

Expected: 现有 PNG→JPEG Harness 和 APK Node 隔离测试通过。这是回归基线，不是安全 GREEN。

## Task 2: 生成可追溯 Orientation fixture

**Files:**
- Create: `tests/fixtures/images/generate-sharp-orientation-fixture.mjs`
- Create: `tests/fixtures/images/sharp-orientation-6.jpg`
- Create: `tests/fixtures/images/README.md`

- [ ] **Step 1: 写唯一的 fixture generator**

生成脚本应以合成 SVG 作为输入，画布 2560×1280，四象限依次为红、绿、蓝、黄，输出质量 95、4:4:4 JPEG，并写入 EXIF Orientation 6。核心实现保持如下形状：

```js
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(fileURLToPath(import.meta.url));
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1280" viewBox="0 0 2560 1280">
  <rect width="1280" height="640" x="0" y="0" fill="#ff0000"/>
  <rect width="1280" height="640" x="1280" y="0" fill="#00b000"/>
  <rect width="1280" height="640" x="0" y="640" fill="#0000ff"/>
  <rect width="1280" height="640" x="1280" y="640" fill="#ffff00"/>
</svg>`);
const output = await sharp(svg)
  .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
  .withMetadata({ orientation: 6 })
  .toBuffer();
await writeFile(join(root, "sharp-orientation-6.jpg"), output);
console.log(JSON.stringify({ node: process.version, sharp: sharp.versions.sharp, vips: sharp.versions.vips, bytes: output.byteLength }));
```

脚本不得读取网络、用户图片、`.env` 或 workspace 数据；不得在生产代码中调用。

- [ ] **Step 2: 在升级前生成一次 fixture 并记录真实来源**

Run:

```powershell
pnpm exec node tests/fixtures/images/generate-sharp-orientation-fixture.mjs
Get-FileHash tests/fixtures/images/sharp-orientation-6.jpg -Algorithm SHA256
pnpm --filter @hongtai/node-runtime exec node --input-type=module -e "import sharp from 'sharp'; const m=await sharp('tests/fixtures/images/sharp-orientation-6.jpg').metadata(); console.log(JSON.stringify(m))"
```

Expected: metadata 的物理尺寸为 2560×1280、Orientation 为 6。将命令输出中的实际 Node/sharp/libvips、字节数和完整 64 位 SHA-256 原样写进 README；不猜测摘要，不写绝对路径。

- [ ] **Step 3: 核对 fixture 体积与隐私边界**

Expected: fixture 是小型合成文件，只有四色块，无人脸、舌象、账号、EXIF 设备/位置或未知网络来源。README 说明它仅用于 Apache-2.0 sharp/libvips 行为回归，生成脚本与本项目一起按仓库许可使用。

## Task 3: 增加专责 preprocessor 契约测试

**Files:**
- Create: `tests/sharp-image-preprocessor.test.ts`
- Modify: `tests/diagnosis-harness.test.ts`
- Test: `tests/fixtures/images/sharp-orientation-6.jpg`

- [ ] **Step 1: 写方向、限边和输出契约测试**

测试读取固定 JPEG，调用真实 `new SharpImagePreprocessor().normalize`，断言：

```ts
assert.equal(result.mimeType, "image/jpeg");
assert.equal(Buffer.from(result.data).subarray(0, 2).toString("hex"), "ffd8");
const metadata = await sharp(result.data).metadata();
assert.equal(metadata.format, "jpeg");
assert.equal(metadata.width, 1_024);
assert.equal(metadata.height, 2_048);
assert.equal(metadata.orientation, undefined);
```

再把输出转为 `raw()`，在四角内部各取一个远离分界线的像素，按主色阈值断言顺序为蓝、红、黄、绿；不要比较完整 JPEG 字节或精确文件大小。

- [ ] **Step 2: 写损坏、空输入与不支持 MIME 测试**

用 `new Uint8Array([0xff, 0xd8, 0xff])` 作为截断 JPEG，分别断言损坏、空输入和 `image/gif` 都是 `TaskError`，`code === "IMAGE_INVALID"`、`action === "edit_input"`。不匹配 `cause` 或 libvips 英文文本。

- [ ] **Step 3: 写精确原始字节上限测试**

```ts
const tooLarge = new Uint8Array(15 * 1024 * 1024 + 1);
await assert.rejects(
  () => new SharpImagePreprocessor().normalize(tooLarge, "image/jpeg"),
  (error) => error instanceof TaskError && error.code === "IMAGE_TOO_LARGE" && error.action === "edit_input",
);
```

该测试证明 15 MiB 原始边界在 sharp 调用前结束；真实 HTTP 的 Base64 请求体可能先触发 20 MiB Harness 上限，二者不能互相替代。

- [ ] **Step 4: 补 Harness 稳定 HTTP 与副作用断言**

保留现有成功路径；新增截断 JPEG 的 HTTP 400/`IMAGE_INVALID` 和超限请求的 HTTP 413/`IMAGE_TOO_LARGE`。失败前后比较 repository 目录，确认不创建 session；为 fake Provider 增加调用计数并断言失败输入不调用 Provider。

- [ ] **Step 5: 运行行为表征测试**

Run:

```powershell
pnpm exec tsx --test tests/sharp-image-preprocessor.test.ts tests/diagnosis-harness.test.ts
```

Expected before dependency upgrade: 行为测试应通过，证明本 Issue 是安全依赖替换而非业务重写。安全门禁仍由 Task 1 的 audit RED 保持失败。

## Task 4: 精确升级 sharp 并显式声明 Node 下限

**Files:**
- Modify: `package.json`
- Modify: `packages/node-runtime/package.json`
- Modify: `pnpm-lock.yaml`
- Modify only if a proved 0.35.3 incompatibility exists: `packages/node-runtime/src/ai/sharp-image-preprocessor.ts`

- [ ] **Step 1: 添加根 Node engine**

在根 `package.json` 的 `packageManager` 后加入：

```json
"engines": {
  "node": ">=22.0.0"
}
```

README 仍以 Node 24 作为推荐开发环境；engine 是最低值，不把未经测试的 Node 22 写成已端测版本。

- [ ] **Step 2: 精确升级 workspace 依赖**

Run:

```powershell
pnpm --filter @hongtai/node-runtime add --save-exact sharp@0.35.3
```

Expected: `packages/node-runtime/package.json` 为精确 `"sharp": "0.35.3"`，lock importer specifier/version 均为 0.35.3，跨平台 optional dependency 仍保留且有 integrity。不得手工删掉非 Windows 平台条目来缩小 lockfile。

- [ ] **Step 3: 核对原生包、兼容与许可**

Run:

```powershell
pnpm --filter @hongtai/node-runtime why sharp
pnpm --filter @hongtai/node-runtime exec node --input-type=module -e "import sharp from 'sharp'; console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips,platform:process.platform,arch:process.arch,node:process.version,format:{jpeg:sharp.format.jpeg.input,png:sharp.format.png.input,webp:sharp.format.webp.input}}))"
pnpm licenses list --prod
```

Expected: 只有 sharp 0.35.3；Windows x64 原生加载成功；JPEG/PNG/WebP buffer 输入可用；许可输出与 sharp Apache-2.0、libvips LGPL-2.1-or-later 的官方说明一致。若 `pnpm licenses` 不展开 bundled libvips，验收文档同时记录 sharp 官方安装页和 libvips 官方许可链接，不伪造包管理器未提供的字段。

- [ ] **Step 4: 只在真实失败时做最小兼容修复**

现有 `failOn: "error"`、`metadata()`、`rotate()`、`resize()`、`jpeg()` 和 `toBuffer()` 应继续支持。若编译或测试失败，先保存完整错误，再仅修改对应调用；不得借升级新增格式、抽象或业务规则。

## Task 5: 完成定向 GREEN、安全 GREEN 与唯一一次全量检查

**Files:**
- All implementation/test files from Tasks 2-4

- [ ] **Step 1: 运行定向 GREEN**

Run:

```powershell
pnpm exec tsx --test tests/sharp-image-preprocessor.test.ts tests/diagnosis-harness.test.ts tests/apk-runtime-boundary.test.ts
pnpm --filter @hongtai/node-runtime typecheck
```

Expected: 方向、限边、JPEG、损坏、超限、Harness 与 APK 隔离全部通过。

- [ ] **Step 2: 运行生产审计 GREEN**

Run:

```powershell
pnpm audit --prod
$auditExit = $LASTEXITCODE
pnpm audit --prod --json
"auditExit=$auditExit"
```

Expected: `auditExit=0`，GHSA-f88m-g3jw-g9cj 不再出现，HIGH 为 0。若公告库同时新增与 sharp 无关的低/中项，记录包、路径和严重级别；任何 sharp HIGH 或 audit 失败都阻断提交。

- [ ] **Step 3: 运行唯一一次 `pnpm check`**

Run:

```powershell
pnpm check
```

Expected: typecheck、lint、全部 Node 测试通过。后续只改验收文档时不重复；review 导致源码、package 或 lock 再变化时才重新运行。

- [ ] **Step 4: 检查 Android 隔离，不运行 AVD**

Run:

```powershell
pnpm exec tsx --test tests/apk-runtime-boundary.test.ts
rg -n "@hongtai/node-runtime|sharp|libvips" apps/web packages/capacitor-runtime android capacitor.config.ts
tar -tf android/app/build/outputs/apk/release/app-release.apk | Select-String -Pattern "sharp|vips"
```

Expected: boundary test 通过，源码搜索无 Node 依赖跨层，既有 release APK 无 sharp/libvips。APK 是既有 artifact 隔离证据，不是本次重新构建或 Android sharp 端测。

- [ ] **Step 5: 创建本地实现 commit**

精确暂存 package、lock、测试、fixture 与实现期文档，不暂存 TEMP/Android artifact：

```powershell
git diff --check
git add -- package.json packages/node-runtime/package.json pnpm-lock.yaml tests/sharp-image-preprocessor.test.ts tests/diagnosis-harness.test.ts tests/fixtures/images/generate-sharp-orientation-fixture.mjs tests/fixtures/images/sharp-orientation-6.jpg tests/fixtures/images/README.md README.md docs/CLI运行与产物说明.md
git diff --cached --check
git commit -m "fix(cli): upgrade sharp image decoder"
```

Do not push. Record the implementation commit SHA for fresh-clone acceptance.

## Task 6: 在 fresh TEMP clone 运行 Windows 原生安装检查

**Files:**
- Read-only committed implementation from Task 5
- Create outside Git: exact Issue #7 TEMP clone and evidence directory

- [ ] **Step 1: 建立可恢复的 committed clone**

使用 `New-Item` 或 `mktemp` 等价方式创建新的 TEMP 父目录，解析为绝对路径并确认位于系统 TEMP 后，再运行：

```powershell
git clone --local --no-hardlinks . <TEMP绝对路径下的fresh-clone>
git -C <fresh-clone绝对路径> rev-parse HEAD
```

Expected: HEAD 等于 Task 5 implementation commit；不复制当前 `node_modules`、`.env`、workspace 数据或未提交改动。尖括号表示执行者必须代入刚刚由系统创建并已校验的绝对路径，不得作为字面路径运行。

- [ ] **Step 2: 从 lockfile 完整安装一次**

Run in fresh clone:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @hongtai/node-runtime why sharp
pnpm --filter @hongtai/node-runtime exec node --input-type=module -e "import sharp from 'sharp'; console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips,platform:process.platform,arch:process.arch,node:process.version}))"
pnpm cli --help
```

Expected: frozen install 成功，真实加载 sharp 0.35.3，Windows x64/Node 版本被记录，CLI 帮助退出 0 且中文 UTF-8 正常。TEMP clone 保留到 review 结束，禁止递归删除不明确路径。

## Task 7: 运行真实 CLI 回环 HTTP 端测

**Files:**
- Fresh clone from Task 6
- Create outside Git: TEMP PFX、CA PEM、mock script、stdout/stderr、HTTP/result evidence
- Read: `tests/fixtures/images/sharp-orientation-6.jpg`

- [ ] **Step 1: 在内存生成 localhost 测试证书**

PowerShell 使用 `System.Security.Cryptography.X509Certificates.CertificateRequest` 和 2048-bit RSA，SAN 只包含 `localhost` 与 loopback IP，有效期不超过两天。导出随机高熵口令保护的 PFX 和只含公钥的 PEM 到已校验 TEMP evidence 目录；不导入 Windows 永久证书库，不写进 Git。

- [ ] **Step 2: 启动受控 HTTPS SSE mock**

mock 只监听 `127.0.0.1`，只接受 `/v1/chat/completions`，校验请求为 POST 且模型是测试模型；返回 `text/event-stream`，content delta 为固定、安全、符合 `diagnosis-report.v1` 的舌象报告 JSON，最后发送 `[DONE]`。日志只记录时间、路径、模型和调用次数，不记录 Authorization、完整图片 data URL 或 reasoning。

- [ ] **Step 3: 启动真实 CLI 子进程**

为子进程设置：

```text
NODE_EXTRA_CA_CERTS=<TEMP CA PEM>
HONGTAI_AI_BASE_URL=https://localhost:<mock-port>/v1
HONGTAI_AI_API_KEY=issue-07-loopback-only
HONGTAI_TEXT_MODEL=issue-07-text
HONGTAI_VISION_MODEL=issue-07-vision
HONGTAI_WORKSPACE_DIR=<TEMP workspace>
```

用 `Start-Process -WindowStyle Hidden` 启动 `pnpm cli diagnosis serve --port <cli-port>` 并重定向 stdout/stderr。禁止 `NODE_TLS_REJECT_UNAUTHORIZED=0`。轮询有限次数直到 CLI 输出启动行，再用 `Get-NetTCPConnection` 确认只监听 `127.0.0.1`。

- [ ] **Step 4: 验证成功输入**

把固定 JPEG 编码为 Data URL，POST `http://127.0.0.1:<cli-port>/api/sessions`。Expected: HTTP 201、返回 sessionId 和 `diagnosis-report.v1`，mock 调用恰好一次；TEMP workspace 出现该 session 的 `source/normalized-image.jpg`、session/report/runs。

用 fresh clone 的 upgraded sharp 检查产物：format JPEG、1024×2048、无待应用 Orientation、角点蓝/红/黄/绿。记录 fixture 与产物 SHA-256，不打印图片字节或绝对私有应用路径。

- [ ] **Step 5: 验证损坏与超限输入**

截断 JPEG Expected: HTTP 400、`IMAGE_INVALID`、不新增 session、mock 次数不变。大于请求体边界的合成 Data URL Expected: HTTP 413、`IMAGE_TOO_LARGE`、不新增 session、mock 次数不变。精确 `15 MiB + 1` 原始边界引用 Task 3 单元测试，不把 Harness 20 MiB 边界混写成同一个断言。

- [ ] **Step 6: finally 精确收尾**

无论成功失败，都只按已记录 PID 停止 CLI 和 mock，等待退出并确认两个端口关闭；清空当前 PowerShell 进程中的测试 key 环境变量；只用 `Remove-Item -LiteralPath` 删除已校验的 PFX、私钥载荷和随机口令文件。保留公钥、脱敏日志、HTTP JSON、哈希和 fresh clone 到 review 完成；不递归删除未知或 workspace 根路径。

## Task 8: 记录真实验收与当前状态

**Files:**
- Create: `docs/验收/2026-08-10-cli-sharp-security.md`
- Modify: `docs/当前能力与发布状态.md`

- [ ] **Step 1: 写日期验收记录**

记录：实现 commit、Node/pnpm/platform/arch、精确 sharp/libvips、package/lock、baseline/final audit 退出码与计数、fixture provenance/SHA、定向测试、唯一一次 `pnpm check`、fresh frozen install、真实 CLI 三场景、标准 JPEG 属性、进程/TLS 清理、APK 隔离搜索和既有 APK SHA/清单边界。

不得记录 TEMP 私钥、测试 key、Authorization、完整 data URL、模型 reasoning、真实供应商或用户图片。

- [ ] **Step 2: 更新当前状态但保留边界**

在 `docs/当前能力与发布状态.md` 将 #7 更新为已完成的 CLI/Node 安全修复事实，明确：Windows x64 真实 CLI 已验收；其他平台未实际运行；APK 路径不受该依赖影响；审计是 2026-08-10 时间点结果。不要改写 #5/#6 的历史或提前关闭 #8。

- [ ] **Step 3: 运行文档与仓库卫生检查**

Run:

```powershell
git diff --check
node -e "const fs=require('node:fs'); for(const p of process.argv.slice(1)) if(fs.readFileSync(p,'utf8').includes(String.fromCharCode(0xfffd))){ console.error(p); process.exitCode=1 }" package.json packages/node-runtime/package.json tests/sharp-image-preprocessor.test.ts tests/diagnosis-harness.test.ts tests/fixtures/images/generate-sharp-orientation-fixture.mjs tests/fixtures/images/README.md README.md docs/CLI运行与产物说明.md docs/当前能力与发布状态.md docs/验收/2026-08-10-cli-sharp-security.md
git status --short
```

再用严格 UTF-8 decoder 检查所有本 Issue 文本，并逐个打开文档相对链接。Expected: 无 U+FFFD、乱码、无效内部链接、私钥/证书/API Key/TEMP 绝对路径、node_modules 或 fresh clone 跟踪项。

- [ ] **Step 4: 创建本地验收 commit**

```powershell
git add -- docs/验收/2026-08-10-cli-sharp-security.md docs/当前能力与发布状态.md
git diff --cached --check
git commit -m "docs(acceptance): verify sharp CLI security upgrade"
```

Do not push.

## Task 9: 双阶段 review 与 Loop 收口

**Files:**
- All Issue #7 implementation and acceptance paths
- Read-only evidence in the exact TEMP directory

- [ ] **Step 1: 运行 spec compliance review**

Reviewer 对照设计逐项检查：精确 0.35.3、Node >=22、生产 preprocessor 未无证据改写、fixture provenance、错误契约、audit HIGH 归零、fresh install、真实 CLI HTTP、#8 隔离、APK 非适用边界、许可和文档真实性。

- [ ] **Step 2: 运行 code quality/security review**

Reviewer 检查 package/lock 平台 optional dependency、测试是否过拟合 libvips 文案、fixture 是否无隐私、TLS 是否受信且无全局放宽、日志是否脱敏、子进程/端口/finally 是否完整、TEMP 删除是否精确、没有 Node 依赖跨入 APK。

- [ ] **Step 3: 修复 review 发现并最小重验**

Critical/Important 必须修复。只改测试或文档时运行对应定向检查；若 package、lock 或生产源码变化，重跑受影响测试、`pnpm audit --prod`，并因为全量检查之后源码发生变化而重跑 `pnpm check`。不因无代码变化重复 fresh CLI 全矩阵。

- [ ] **Step 4: 最终 Git 与证据核对**

Run:

```powershell
git status --short --branch
git log -4 --oneline
git diff --check
```

Expected: 只有被明确保留的无关改动；Issue #7 实现与验收均有本地 commit，未 push。向主任务回报 commit SHA、audit 计数、Windows runtime、真实 CLI 场景、fixture/产物哈希、APK 非适用边界和未验证平台。
