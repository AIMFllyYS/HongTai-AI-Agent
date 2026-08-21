# 2026-08-21 未归档稿页面层 1:1

## 目标

- 用户可感知的结果：舌诊/面诊起始页、设置页、底部导航按 `hongtai-mobile.pen` 未归档画板还原；稿上的采集样张随包使用；设置里稿上有的行都有真实本机行为。

## 允许修改

- `AGENTS.md`、`docs/交互信息架构规范.md`、`docs/文档索引.md`、本任务契约
- `apps/web` 页面、样式、本机偏好、静态资源与对应测试

## 明确不做

- 不改 `core` / `ai` / `platforms` / Capacitor / Kotlin 业务流程
- 不造官方模板热度人数、假缓存 128 MB、假检查更新成功
- 观察报告允许不确定初步判断，但禁止确诊口吻、处方、概率数字、健康评分
- 不提交 `docs/Hong/新设计/`
- 不 push、不声称真机通过

## 架构归属

- 所属层：UI
- 页面只消费 `AppRuntime` 与版本化 DTO；外观/通知/清缓存为 Web 本机偏好，不新增云端

## 权威状态与数据

- 视觉权威：未归档 `BO8h1` / `UNqX4` / `y7AVws` / `Sy2ri` / `S2chx9`
- 观察会话权威：`runtime.diagnosis`；确认选图后才 `createSession` + `runReport`
- 设置资料/AI/版本：`profile` / `aiSettings.getPublic` / `deviceSettings.getAppInfo`

## 验收

- 定向测试：观察、设置、底栏、外观偏好
- `pnpm check`；`pnpm --filter @hongtai/web typecheck` 与 `build`
- 浏览器约 390px 对照未归档画板
