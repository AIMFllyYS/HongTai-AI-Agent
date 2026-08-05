# 快手实验性适配器

当前只支持匿名公开的单条视频：

- `v.kuaishou.com/<token>` 分享短链；
- `www.kuaishou.com/short-video/<photoId>` 标准作品页。

适配器跟随HTTPS跳转后，通过 `video.kuaishou.com/graphql` 的
`visionVideoDetail` 只读查询取得作品详情。它不携带 Cookie、登录态或设备标识，
不执行验证码绕过，也不依赖浏览器。

媒体选择只接受路径明确为 MP4 的 `photoUrl` 或 manifest representation。
m3u8 只计入脱敏诊断信息，不进入下载。下载、FFprobe、ASR和任务产物继续由统一流水线处理。

快手匿名接口可能返回验证码、限流、连接中断或过期CDN地址，因此该适配器固定标记为
`experimental`。自动化测试只使用模拟响应；正式稳定支持需要跨日期、多链接人工验收。
