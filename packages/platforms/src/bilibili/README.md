# B站适配器

只解析公开作品链接，不携带 Cookie、登录态或设备标识，也不绕过平台风控。

## 支持的链接

- `www.bilibili.com/video/BVxxxx`、`m.bilibili.com/video/BVxxxx`（可带 `?spm_id_from=` 等查询参数）
- `www.bilibili.com/video/av12345` 以及 `aid=` 查询参数
- `?p=` 分 P；缺省为 P1，超出页数时明确失败
- `b23.tv`、`bili2233.cn` 短链：只跟随 HTTPS `Location` 取 BV/av，不读取最终 HTML

URL 已含 BV 或 av 时，`resolve()` 不发 HTTP。`parse()` 只调用公开 `view` 与公开档 `playurl`（`qn=64`，无 `fourk`）；若 nav 返回公开 wbi 口令，则为 playurl 附加 wbi 签名。

## 明确失败

- 无 Cookie 拿不到的播放源：`MEDIA_SOURCE_NOT_FOUND`，不返回空 dash、不走 pipeline 降级
- `-352`：`PLATFORM_RISK_CONTROLLED`（`retryable=false`）
- 短链跳到非 B 站域名：`LINK_REDIRECT_INVALID`
- 大会员、登录或非公开清晰度：不采集

自动化测试只使用模拟响应，不能当作真网已通过。
