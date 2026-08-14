# 2026-08-15 三阶段功能扩展任务契约

## 目标

- 阶段 1：舌象与面部观察使用一份独立 Markdown 知识库，提供五脏六腑相关的传统观察参考，同时保持“可见状态、非诊断、四诊合参”的安全边界。
- 阶段 2：只替换 APK 启动图标；底部导航增加“富迪素材库”，点击后展示用户指定的项目内图片。
- 阶段 3：制作计划同时接收原始文稿、正式爆款拆解与“仅供参考、禁止照抄”的前缀；支持主文字预设、逐镜头字幕与真实 Media3 成片。

## 允许修改

- `packages/ai`：知识库、Prompt、Schema、诊察 Flow、制作计划 Flow 与测试。
- `packages/core`、`packages/capacitor-runtime`：版本化制作 DTO 和既有 Flow 的组合输入。
- `apps/web`：底部导航、素材库弹层、制作输入与计划预览。
- `android/app`：APK 图标资源、已验证制作计划的文字叠加执行。
- `apps/web/public`：用户指定的图标源和富迪素材图片。
- `docs`、`CHANGELOG.md`、`android/app/build.gradle.kts`：阶段契约、版本记录、验收证据和每阶段版本递增。

## 明确不做

- 不修改应用内部既有 SVG 品牌图形，不创建云端知识库、数据库、登录、同步、发布或素材市场。
- 不输出疾病诊断、患病概率、处方、器官功能异常结论或整体健康评分。
- 不把用户参考视频、私有媒体、供应商原始响应或推理文本提交到 Git。
- 不创建 worktree，不读取、移动、暂存或删除未跟踪的 `HongTai.zip`，不推送远端。

## 架构归属

- 阶段 1 属于 `packages/ai`：Markdown 是知识权威，生成模块只做构建期内嵌；UI 和 Kotlin 不复制辨证规则。
- 阶段 2 属于 UI 与 Android 资源：导航只改变展示；APK 图标只由 Android 资源消费。
- 阶段 3 的 Prompt/Schema 属于 `packages/ai`，项目组合属于 `packages/capacitor-runtime`，输入属于 UI，Media3 只执行已验证计划。
- `core`、`ai`、`platforms` 不导入 Node、Capacitor 或 Android API；页面只消费 `AppRuntime` DTO。

## 权威状态与数据

- 观察会话以 `sessionId` 和完整 `diagnosis-report.v1` 为唯一权威；知识上下文与运行期增量不持久化。
- 制作项目以 `projectId` 和 `production-plan.v1` 为唯一权威；原始文稿只在规划调用的受控输入中使用，不复制到项目 JSON 或 UI。
- 每阶段 Android 版本只修改 `android/app/build.gradle.kts`，依次为 `0.1.9/code17`、`0.1.10/code18`、`0.1.11/code19`。
- 同版本不同字节禁止覆盖；计划或渲染失败保留已有成功产物并进入明确失败态。

## 验收

- 定向测试：知识库同步/安全语义、导航弹层、制作 Prompt/Schema/Parser/Renderer。
- 构建 / lint：每阶段运行 `pnpm check`、Web production build和唯一 Release 构建脚本。
- 端侧证据：每阶段将对应 Release APK 安装到 API 35 AVD，完成与阶段相关的页面或原生链路检查；没有物理设备时明确标记模拟器边界。
- 用户实际会看到：更有依据但不越界的传统观察参考、新 APK 图标、可打开的富迪素材库，以及带顶部主文字和底部字幕的竖屏成片。

## 交付说明

- 每个阶段完成后先升版并更新 `CHANGELOG.md`，构建归档 Release APK，完成端测和证据文档，再精确暂存并本地提交。
- 不更新公开下载页；三个 APK 都是本地 Release 候选，直到物理真机、人工上传和公网哈希回验完成。
