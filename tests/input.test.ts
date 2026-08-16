import assert from "node:assert/strict";
import test from "node:test";
import { inspectInput, normalizeInput } from "../packages/core/src/index";

const cases = [
  {
    input: "7.94 复制打开抖音，看看【姜也的作品】原来古人诚不欺我，千里江山图真的存在！  https://v.douyin.com/P3q_lN_8d84/ :0pm c@A.gb 08/08 Xmd:/",
    url: "https://v.douyin.com/P3q_lN_8d84/",
    platform: "douyin",
  },
  {
    input: "兄弟们，不想多说了，给我使劲蹬codex，明天额度要重... http://xhslink.cn/o/3vTWjToTt09 这篇笔记在【小红书】候着你瞧~",
    url: "https://xhslink.cn/o/3vTWjToTt09",
    platform: "xiaohongshu",
  },
  {
    input: "【ai神器，接入任意模型直接对话-哔哩哔哩】 https://b23.tv/mIrEY6j",
    url: "https://b23.tv/mIrEY6j",
    platform: "bilibili",
  },
  {
    input: "复制打开快手，看看这个作品 https://v.kuaishou.com/nvZAnXmn 更多分享文字",
    url: "https://v.kuaishou.com/nvZAnXmn",
    platform: "kuaishou",
  },
  {
    input: "https://www.kuaishou.com/short-video/3xk22yucqvrwx64",
    url: "https://www.kuaishou.com/short-video/3xk22yucqvrwx64",
    platform: "kuaishou",
  },
] as const;

for (const item of cases) {
  test(`分享文字规范化：${item.platform}`, () => {
    const result = normalizeInput(item.input);
    assert.equal(result.normalizedUrl, item.url);
    assert.equal(result.platform, item.platform);
  });
}

test("跳过无关网址并选择第一个受支持链接", () => {
  const result = normalizeInput("先看 https://example.com/a 再看 xhslink.cn/o/first，最后 https://b23.tv/second");
  assert.equal(result.normalizedUrl, "https://xhslink.cn/o/first");
  assert.equal(result.ignoredSupportedUrlCount, 1);
});

test("无受支持链接返回稳定错误码", () => {
  const result = inspectInput("只有普通文字和 https://example.com/a");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issue.code, "INPUT_NO_SUPPORTED_URL");
});

test("未验证的快手地址不是用户作品链接", () => {
  for (const url of [
    "https://video.kuaishou.com/graphql",
    "https://www.kuaishou.com/graphql",
    "https://kuaishou.com/short-video/3xk22yucqvrwx64",
  ]) {
    const result = inspectInput(url);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issue.code, "INPUT_NO_SUPPORTED_URL");
  }
});

test("移动子域名可以进入采集入口", () => {
  const cases = [
    { input: "https://m.douyin.com/video/7600000000000000000", platform: "douyin", url: "https://m.douyin.com/video/7600000000000000000" },
    { input: "https://m.bilibili.com/video/BV1xx411c7mD", platform: "bilibili", url: "https://m.bilibili.com/video/BV1xx411c7mD" },
    { input: "https://m.xiaohongshu.com/explore/abc123", platform: "xiaohongshu", url: "https://m.xiaohongshu.com/explore/abc123" },
  ] as const;
  for (const item of cases) {
    const result = normalizeInput(item.input);
    assert.equal(result.platform, item.platform);
    assert.equal(result.normalizedUrl, item.url);
  }
});

test("api、live、creator 等无关子域名不能进入采集入口", () => {
  for (const url of [
    "https://api.douyin.com/aweme/v1/play/",
    "https://live.douyin.com/123",
    "https://creator.douyin.com/studio",
    "https://api.bilibili.com/x/web-interface/view",
    "https://live.bilibili.com/123",
    "https://creator.bilibili.com/",
    "https://api.xiaohongshu.com/api",
    "https://live.xiaohongshu.com/live",
    "https://creator.xiaohongshu.com/",
  ]) {
    const result = inspectInput(url);
    assert.equal(result.ok, false, url);
    if (!result.ok) assert.equal(result.issue.code, "INPUT_NO_SUPPORTED_URL");
  }
});
