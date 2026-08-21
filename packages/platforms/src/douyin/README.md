# 抖音适配器

只解析公开单条作品，不携带 Cookie、登录态或设备标识，也不绕过平台风控。

## 支持的链接

- `v.douyin.com/<token>` 分享短链：只跟随 HTTPS `Location`
- `www.douyin.com/video/<id>`、`www.iesdouyin.com/share/video/<id>` 等公开作品页

`parse()` 从公开页的 `_ROUTER_DATA`（或等价内嵌 JSON）提取标题、作者、H.264 候选与文案。下载、转写和落盘由 `packages/core` 的 `IngestPipeline` 继续处理。

自动化测试使用模拟响应。无水印源不可用时只保留真实可用结果，不逐帧去水印。

