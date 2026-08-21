# 小红书适配器

只解析公开单条笔记，不携带 Cookie、登录态或设备标识。

## 支持的链接

- `xhslink.cn/o/<token>` 以及 `www.xiaohongshu.com/explore/<id>`、`/discovery/item/<id>` 等公开页

`parse()` 从 `__INITIAL_STATE__` 提取视频 H.264 流或图文图片列表与正文。图文笔记不强制 ASR。下载与落盘仍由统一管线处理。

自动化测试使用模拟响应。

