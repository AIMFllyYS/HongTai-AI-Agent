# v0.1.10 APK 图标与富迪素材库验收

> 日期：2026-08-15
>
> 阶段：三阶段功能扩展的阶段 2
>
> 结论：`0.1.10` / `versionCode=18` Release 候选通过自动化、主机签名构建和 API 35 模拟器端测；没有物理手机、公开上传或公网哈希回验，因此不是正式发布证明。

## 范围

- 用户提供的 2048×2048 PNG 经过居中方形裁剪与 1024×1024 缩放，去除右下角生成水印后保存为 `apps/web/public/brand/hongtai-app-icon.png`。
- Android manifest 的普通图标和圆形图标都切换到 `@drawable/hongtai_launcher`；Android 源文件与 public 裁剪图 SHA-256 均为 `b7666580d788a694be1a331f4dac36aebfb06b1000190cef6eb542bb49afceac`。
- 应用内既有 SVG、Pulse Flow 页头标记和导航图标没有被替换。
- 用户提供的 1125×2436 富迪宣传图原样保存为 `apps/web/public/materials/fudi-material-library.jpg`，SHA-256 为 `cb86a094e7535d4923a0edecd159349b3ff94e4c4cbbe376a3e1f7100ecdb7d2`。
- 底栏新增“富迪素材库”动作，打开可访问的图片弹层；该动作不进入页面路由或横向滑动顺序。

## 自动化证据

- 图标、Manifest、public 资源、底栏弹层与版本定向测试：26/26 通过。
- `pnpm typecheck` 与 ESLint 通过；完整测试：275/275 通过。
- `pnpm --filter @hongtai/web build`：638 个模块转换成功。
- Release 脚本完成 `testReleaseUnitTest`、`lintRelease`、四 ABI native build、16 KiB zipalign、v2/v3 签名和包身份后验。

## Release APK

- 构建入口：`scripts/build-android-release.ps1`。
- 归档文件：`output/apk-archive/HongTai-AI-Agent-release-v0.1.10.apk`。
- 包名：`com.hongtai.aiagent`。
- 版本：`0.1.10` / `versionCode=18`。
- 大小：28,954,090 字节。
- APK SHA-256：`9a4b78ba7e75259e6809d04f42e6b73f9ad0e02524ed3eb6640b2126c3600c39`。
- 证书 SHA-256：`54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。
- `aapt2 dump badging` 将各密度 launcher icon 指向打包资源 `res/08.png`。

## API 35 端测

- 设备：只读覆盖层 AVD `SciChatApi35`，`sdk_gphone64_x86_64`，API 35，ADB `emulator-5554`，物理像素 1080×2340、密度 440。
- 普通升级：从同证书 `0.1.9/code17` 执行 `adb install --no-streaming -r`，未卸载、未使用 `-d`，结果 `Success`。
- 数据保留证据：`firstInstallTime` 继续为 `2026-08-12 12:14:26`；安装后 PackageManager 为 `0.1.10/code18`。
- 冷启动：`topResumedActivity` 为 `com.hongtai.aiagent/.MainActivity`，目标包未见 crash 或 ANR。
- 底栏：UIAutomator 读取到 AI、拆解、制作、模板、设置和富迪素材库六项，素材库按钮边界为 `[885,2189][1061,2340]`。
- 弹层：点击“富迪素材库”后 UIAutomator 同时读取到弹层标题、`富迪素材库宣传图` 图片替代文本和关闭按钮；截图确认纵向宣传图完整采用 `contain` 方式显示，点击关闭按钮后图片节点消失。

## 明确未验证

- 没有物理 Android 手机，不能声称 OEM launcher mask、桌面图标视觉、物理屏色彩、真实触控或正常升级已通过。
- Android 系统返回键未作为本阶段弹层关闭契约；已验证的是弹层内关闭按钮。Esc 键关闭只属于桌面可访问性实现。
- 没有更新 `download.html`，也没有公开上传 v0.1.10 或从公网重新下载核对哈希。
