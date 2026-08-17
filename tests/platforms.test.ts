import assert from "node:assert/strict";
import test from "node:test";
import type { HttpClient, HttpPostRequest, HttpRequest, HttpResponse } from "../packages/core/src/index";
import { inspectInput, TaskError } from "../packages/core/src/index";
import {
  BilibiliAdapter,
  DouyinAdapter,
  KuaishouAdapter,
  XiaohongshuAdapter,
  extractAssignedJson,
  platformRegistry,
  replaceUndefined,
} from "../packages/platforms/src/index";
import { signWbiQuery } from "../packages/platforms/src/bilibili/wbi";

class FakeHttpClient implements HttpClient {
  readonly #handler: (request: HttpRequest | HttpPostRequest) => HttpResponse;

  constructor(handler: (request: HttpRequest | HttpPostRequest) => HttpResponse) {
    this.#handler = handler;
  }

  async get(request: HttpRequest): Promise<HttpResponse> {
    return this.#handler(request);
  }

  async post(request: HttpPostRequest): Promise<HttpResponse> {
    return this.#handler(request);
  }
}

function response(url: string, body: string): HttpResponse {
  return { url, status: 200, headers: { "content-type": "text/html" }, body };
}

function assertWhitelistedRaw(raw: unknown): void {
  const serialized = JSON.stringify(raw);
  assert.doesNotMatch(serialized, /Cookie|Authorization|signature=|fake-sign|synthetic-cookie|Bearer SYNTHETIC/i);
  assert.doesNotMatch(serialized, /https?:\/\/[^"\s]*\?/);
  assert.ok(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  const record = raw as Record<string, unknown>;
  for (const leaked of ["item", "view", "play", "note"] as const) {
    assert.equal(leaked in record, false, `raw must not persist ${leaked}`);
  }
  assert.equal(typeof record.platform, "string");
  assert.equal(typeof record.contentType, "string");
  assert.equal(typeof record.hasAuthor, "boolean");
  assert.equal(typeof record.hasTitle, "boolean");
  assert.ok(record.media !== null && typeof record.media === "object" && !Array.isArray(record.media));
  const media = record.media as Record<string, unknown>;
  assert.equal(typeof media.videoCount, "number");
  assert.equal(typeof media.audioCount, "number");
  assert.equal(typeof media.imageCount, "number");
  assert.ok(Array.isArray(media.candidates));
  for (const candidate of media.candidates as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(candidate).sort(), ["host", "path"]);
    assert.equal(typeof candidate.host, "string");
    assert.equal(typeof candidate.path, "string");
    assert.doesNotMatch(String(candidate.host), /[?&=]/);
    assert.doesNotMatch(String(candidate.path), /[?&=]/);
  }
}

test("extractAssignedJson支持嵌套对象和undefined", () => {
  const value = extractAssignedJson(
    '<script>window.__INITIAL_STATE__={"note":{"value":undefined,"nested":{"ok":true}}};</script>',
    ["window.__INITIAL_STATE__"],
  );
  assert.deepEqual(value, { note: { value: null, nested: { ok: true } } });
});

test("replaceUndefined不改写undefined前缀的字段名", () => {
  assert.equal(replaceUndefined("{undefinedKey:undefined}"), "{undefinedKey:null}");
  assert.equal(replaceUndefined('{"value":undefined}'), '{"value":null}');
});

test("小红书笔记定位不会命中外层包装对象", async () => {
  const html = `<script>window.__INITIAL_STATE__={"imageList":[{"urlDefault":"https://img.example/wrapper.jpg"}],"note":{"noteDetailMap":{"abc123":{"note":{"noteId":"abc123","title":"真实笔记","desc":"正文","user":{"nickname":"作者乙"},"imageList":[{"urlDefault":"https://img.example/real.jpg"}]}}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/explore/abc123", html));
  const adapter = new XiaohongshuAdapter();
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/explore/abc123", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.title, "真实笔记");
  assert.equal(content.author, "作者乙");
  assert.equal(content.images[0]?.url, "https://img.example/real.jpg");
  assert.equal(content.images.some((image) => image.url.includes("wrapper")), false);
});

const BILIBILI_VIEW = {
  bvid: "BV1xx411c7mD",
  title: "测试B站",
  desc: "简介",
  duration: 60,
  owner: { name: "作者丙" },
  pages: [{ cid: 123, duration: 60 }],
} as const;

const BILIBILI_PLAY = {
  dash: {
    video: [{ id: 64, baseUrl: "https://video.example/video.m4s?signature=fake-sign", bandwidth: 800000, width: 1280, height: 720, codecs: "avc1" }],
    audio: [{ id: 30216, baseUrl: "https://video.example/audio.m4s?signature=fake-sign", bandwidth: 128000, codecs: "mp4a" }],
  },
} as const;

function jsonResponse(url: string, payload: unknown): HttpResponse {
  return { url, status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function bilibiliClient(options: {
  readonly view?: unknown;
  readonly play?: unknown;
  readonly nav?: unknown;
  readonly onRequest?: (request: HttpRequest | HttpPostRequest) => void;
  readonly resolve?: (request: HttpRequest | HttpPostRequest) => HttpResponse | undefined;
} = {}): FakeHttpClient {
  return new FakeHttpClient((request) => {
    options.onRequest?.(request);
    const custom = options.resolve?.(request);
    if (custom) return custom;
    if (request.url.includes("/x/web-interface/nav")) {
      return jsonResponse(request.url, options.nav ?? { code: -101, data: {} });
    }
    if (request.url.includes("/x/web-interface/view")) {
      return jsonResponse(request.url, { code: 0, data: options.view ?? BILIBILI_VIEW });
    }
    if (request.url.includes("playurl")) {
      const play = options.play;
      if (play && typeof play === "object" && "code" in play) return jsonResponse(request.url, play);
      return jsonResponse(request.url, { code: 0, data: play ?? BILIBILI_PLAY });
    }
    return response(request.url, "<html>unexpected page fetch</html>");
  });
}

test("B站在URL中没有BV或av号时不从HTML推荐位采集", async () => {
  const recommended = "BV1yyyyyyyy1";
  let apiCalls = 0;
  const client = new FakeHttpClient((request) => {
    if (request.url.includes("api.bilibili.com")) {
      apiCalls += 1;
      return jsonResponse(request.url, {
        code: 0,
        data: {
          bvid: recommended,
          title: "推荐位视频",
          desc: "简介",
          duration: 60,
          owner: { name: "推荐作者" },
          pages: [{ cid: 999, duration: 60 }],
        },
      });
    }
    return response("https://www.bilibili.com/video/", `<html><a href="/video/${recommended}">推荐</a></html>`);
  });
  await assert.rejects(
    () => new BilibiliAdapter().parse({
      sourceUrl: "https://www.bilibili.com/video/",
      finalUrl: "https://www.bilibili.com/video/",
      status: 200,
      body: `<html><a href="/video/${recommended}">推荐</a></html>`,
    }, client),
    (error) => error instanceof TaskError && error.code === "INPUT_URL_INVALID",
  );
  assert.equal(apiCalls, 0);
});

const HOST_DECISIONS = [
  { url: "https://www.douyin.com/video/7600000000000000000", accepted: true, platform: "douyin" },
  { url: "https://v.douyin.com/P3q_lN_8d84/", accepted: true, platform: "douyin" },
  { url: "https://m.douyin.com/video/7600000000000000000", accepted: true, platform: "douyin" },
  { url: "https://www.iesdouyin.com/share/video/7600000000000000000", accepted: true, platform: "douyin" },
  { url: "https://api.douyin.com/aweme/v1/play/", accepted: false },
  { url: "https://live.douyin.com/123", accepted: false },
  { url: "https://creator.douyin.com/studio", accepted: false },
  { url: "https://www.bilibili.com/video/BV1xx411c7mD", accepted: true, platform: "bilibili" },
  { url: "https://m.bilibili.com/video/BV1xx411c7mD", accepted: true, platform: "bilibili" },
  { url: "https://b23.tv/mIrEY6j", accepted: true, platform: "bilibili" },
  { url: "https://bili2233.cn/abcdef", accepted: true, platform: "bilibili" },
  { url: "https://api.bilibili.com/x/web-interface/view", accepted: false },
  { url: "https://live.bilibili.com/123", accepted: false },
  { url: "https://creator.bilibili.com/", accepted: false },
  { url: "https://www.xiaohongshu.com/explore/abc123", accepted: true, platform: "xiaohongshu" },
  { url: "https://m.xiaohongshu.com/explore/abc123", accepted: true, platform: "xiaohongshu" },
  { url: "https://xhslink.cn/o/example", accepted: true, platform: "xiaohongshu" },
  { url: "https://api.xiaohongshu.com/api", accepted: false },
  { url: "https://live.xiaohongshu.com/live", accepted: false },
  { url: "https://creator.xiaohongshu.com/", accepted: false },
  { url: "https://v.kuaishou.com/nvZAnXmn", accepted: true, platform: "kuaishou" },
  { url: "https://www.kuaishou.com/short-video/3xk22yucqvrwx64", accepted: true, platform: "kuaishou" },
  { url: "https://www.kuaishou.com/graphql", accepted: false },
] as const;

test("入口与适配器对同一链接给出相同主机判定", () => {
  for (const item of HOST_DECISIONS) {
    const inspection = inspectInput(item.url);
    const adapter = platformRegistry.find(item.url);
    assert.equal(inspection.ok, item.accepted, `inspectInput ${item.url}`);
    assert.equal(Boolean(adapter), item.accepted, `matches ${item.url}`);
    if (item.accepted && inspection.ok) {
      assert.equal(inspection.value.platform, item.platform);
      assert.equal(adapter?.platform, item.platform);
    }
  }
});

test("现有平台显式标记为稳定支持", () => {
  assert.equal(new DouyinAdapter().supportLevel, "stable");
  assert.equal(new XiaohongshuAdapter().supportLevel, "stable");
  assert.equal(new BilibiliAdapter().supportLevel, "stable");
});

test("平台注册表包含三个稳定平台和一个实验性快手", () => {
  assert.equal(platformRegistry.size, 4);
  assert.deepEqual(platformRegistry.all.map((adapter) => [adapter.platform, adapter.supportLevel]), [
    ["douyin", "stable"],
    ["xiaohongshu", "stable"],
    ["bilibili", "stable"],
    ["kuaishou", "experimental"],
  ]);
});

test("快手适配器优先使用photoUrl直链并输出脱敏原始结果", async () => {
  const postRequests: HttpPostRequest[] = [];
  const client = new FakeHttpClient((request) => {
    if ("body" in request) {
      postRequests.push(request);
      return {
        url: request.url,
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: {
            visionVideoDetail: {
              status: 1,
              type: 1,
              author: { id: "author-1", name: "快手作者" },
              photo: {
                id: "3xk22yucqvrwx64",
                Cookie: "synthetic-cookie",
                Authorization: "Bearer SYNTHETIC",
                duration: 398_000,
                caption: "快手测试视频",
                coverUrl: "https://img.example/cover.jpg?token=cover-secret",
                photoUrl: "https://v23.kwaicdn.com/video.mp4?token=media-secret",
                manifest: {
                  adaptationSet: [{
                    representation: [
                      { url: "https://v1.kwaicdn.com/higher.mp4?token=manifest-secret", width: 1920, height: 1080, avgBitrate: 2_000_000 },
                      { url: "https://v1.kwaicdn.com/playlist.m3u8?token=hls-secret" },
                    ],
                  }],
                },
              },
            },
          },
        }),
      };
    }
    return response("https://www.kuaishou.com/short-video/3xk22yucqvrwx64", "<html>kuaishou</html>");
  });
  const adapter = new KuaishouAdapter();
  assert.equal(adapter.matches("https://v.kuaishou.com/nvZAnXmn"), true);
  assert.equal(adapter.matches("https://www.kuaishou.com/short-video/3xk22yucqvrwx64"), true);
  assert.equal(adapter.matches("https://www.kuaishou.com/graphql"), false);
  assert.equal(adapter.matches("https://kuaishou.com/short-video/3xk22yucqvrwx64"), false);
  const resolved = await adapter.resolve("https://v.kuaishou.com/nvZAnXmn", client);
  assert.equal(resolved.body, undefined);
  assert.equal(resolved.finalUrl, "https://www.kuaishou.com/short-video/3xk22yucqvrwx64");
  const content = await adapter.parse(resolved, client);

  assert.equal(adapter.supportLevel, "experimental");
  assert.equal(content.platform, "kuaishou");
  assert.equal(content.title, "快手测试视频");
  assert.equal(content.author, "快手作者");
  assert.equal(content.durationSeconds, 398);
  assert.deepEqual(content.videos.map((source) => source.url), ["https://v23.kwaicdn.com/video.mp4?token=media-secret"]);
  assert.equal(content.videos[0]?.hasWatermark, undefined);
  assert.equal(postRequests.length, 1);
  assert.equal(postRequests[0]?.maxAttempts, 2);
  assert.equal(postRequests[0]?.maxRedirects, 0);
  assert.match(postRequests[0]?.body ?? "", /visionVideoDetail/);
  assert.equal(postRequests[0]?.headers?.Origin, "https://www.kuaishou.com");
  const raw = JSON.stringify(content.raw);
  assert.doesNotMatch(raw, /media-secret|manifest-secret|hls-secret|cover-secret/);
  assert.match(raw, /v23\.kwaicdn\.com/);
  assert.equal((content.raw as { errorClassification?: string }).errorClassification, "none");
  assertWhitelistedRaw(content.raw);
});

test("快手适配器在没有photoUrl时只选择manifest中的MP4", async () => {
  const client = new FakeHttpClient((request) => {
    if (!("body" in request)) return response("https://www.kuaishou.com/short-video/photo2", "<html></html>");
    return {
      url: request.url,
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          visionVideoDetail: {
            status: 1,
            type: 1,
            photo: {
              id: "photo2",
              duration: 12_000,
              manifest: {
                adaptationSet: [{ representation: [
                  { url: "https://cdn.example/720.mp4?signature=secret", width: 720, height: 1280, avgBitrate: 800_000, codecs: "avc1", qualityType: "720p" },
                  { url: "https://cdn.example/1080.mp4?signature=secret", width: 1080, height: 1920, avgBitrate: 1_800_000, codecs: "avc1", qualityType: "1080p" },
                  { url: "https://cdn.example/stream.m3u8?signature=secret" },
                ] }],
              },
            },
          },
        },
      }),
    };
  });
  const adapter = new KuaishouAdapter();
  const resolved = await adapter.resolve("https://www.kuaishou.com/short-video/photo2", client);
  const content = await adapter.parse(resolved, client);
  assert.deepEqual(content.videos.map((source) => source.quality), ["720p", "1080p"]);
  assert.equal(content.videos.some((source) => source.url.includes("m3u8")), false);
  assert.equal((content.raw as { media?: { hlsCount?: number } }).media?.hlsCount, 1);
  assert.doesNotMatch(JSON.stringify(content.raw), /signature=secret/);
  assertWhitelistedRaw(content.raw);
});

test("快手详情只有HLS时保留视频元数据但不伪造下载源", async () => {
  const client = new FakeHttpClient((request) => ({
    url: request.url,
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { visionVideoDetail: { status: 1, type: 1, photo: {
      id: "hls-only",
      caption: "只有HLS",
      manifest: { adaptationSet: [{ representation: [{ url: "https://cdn.example/only.m3u8?token=secret" }] }] },
    } } } }),
  }));
  const content = await new KuaishouAdapter().parse({
    sourceUrl: "https://v.kuaishou.com/hlsOnly",
    finalUrl: "https://www.kuaishou.com/short-video/hls-only",
    status: 200,
  }, client);
  assert.equal(content.contentType, "video");
  assert.equal(content.videos.length, 0);
  assert.equal((content.raw as { media?: { hlsCount?: number } }).media?.hlsCount, 1);
});

test("快手验证码结果映射为稳定风控错误且不在适配器内重试", async () => {
  const payloads = [
    { errors: [{ message: "Need captcha" }] },
    { errors: [{ message: "blocked", extensions: { result: 2 } }] },
    { message: "Need captcha", result: 2 },
  ];
  for (const payload of payloads) {
    let requests = 0;
    const client = new FakeHttpClient((request) => {
      requests += 1;
      return { url: request.url, status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
    });
    await assert.rejects(
      () => new KuaishouAdapter().parse({
        sourceUrl: "https://v.kuaishou.com/risk",
        finalUrl: "https://www.kuaishou.com/short-video/risk-photo",
        status: 200,
      }, client),
      (error) => error instanceof TaskError
        && error.code === "PLATFORM_RISK_CONTROLLED"
        && error.message === "快手平台触发风控，暂时无法获取视频"
        && error.details?.operationName === "visionVideoDetail"
        && error.details?.httpStatus === 200,
    );
    assert.equal(requests, 1);
  }
});

test("快手无效JSON和空data返回平台响应错误", async () => {
  for (const body of ["not-json", JSON.stringify({ data: null })]) {
    const client = new FakeHttpClient((request) => ({
      url: request.url,
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    }));
    await assert.rejects(
      () => new KuaishouAdapter().parse({
        sourceUrl: "https://v.kuaishou.com/invalid",
        finalUrl: "https://www.kuaishou.com/short-video/invalid-photo",
        status: 200,
      }, client),
      (error) => error instanceof TaskError && error.code === "PLATFORM_API_RESPONSE_INVALID",
    );
  }
});

test("快手HTTP和GraphQL失败映射为既有稳定错误码", async () => {
  const cases = [
    { status: 401, body: "{}", code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED" },
    { status: 403, body: "{}", code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED" },
    { status: 429, body: "{}", code: "PLATFORM_API_RATE_LIMITED" },
    { status: 503, body: "{}", code: "PLATFORM_API_UNAVAILABLE" },
    { status: 404, body: "{}", code: "CONTENT_NOT_FOUND" },
    { status: 200, body: JSON.stringify({ errors: [{ message: "resolver failed" }] }), code: "PLATFORM_API_RESPONSE_INVALID" },
  ] as const;
  for (const item of cases) {
    const client = new FakeHttpClient((request) => ({
      url: request.url,
      status: item.status,
      headers: { "content-type": "application/json" },
      body: item.body,
    }));
    await assert.rejects(
      () => new KuaishouAdapter().parse({
        sourceUrl: "https://v.kuaishou.com/error",
        finalUrl: "https://www.kuaishou.com/short-video/error-photo",
        status: 200,
      }, client),
      (error) => {
        if (!(error instanceof TaskError) || error.code !== item.code) return false;
        if (item.status === 404) return error.action === "edit_input" && error.retryable === false;
        return true;
      },
    );
  }
});

test("快手解析拒绝跳转到未认可域名", async () => {
  const client = new FakeHttpClient(() => response("https://evil.example/short-video/stolen", "<html></html>"));
  await assert.rejects(
    () => new KuaishouAdapter().resolve("https://v.kuaishou.com/example", client),
    (error) => error instanceof TaskError && error.code === "LINK_REDIRECT_INVALID",
  );
});

test("抖音适配器从公开页面状态提取无水印视频", async () => {
  const html = `<script>window._ROUTER_DATA={"loaderData":{"video":{"aweme_id":"7600000000000000000","desc":"测试抖音","author":{"nickname":"作者甲"},"Cookie":"synthetic-cookie","Authorization":"Bearer SYNTHETIC","video":{"duration":45000,"cover":{"url_list":["https://img.example/cover.jpg?signature=fake-sign"]},"bit_rate":[{"gear_name":"1080p","bit_rate":2000000,"play_addr":{"uri":"video-file-id","url_list":["https://cdn.example/playwm/item.mp4?signature=fake-sign"]}}]}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.douyin.com/video/7600000000000000000", html));
  const adapter = new DouyinAdapter();
  const resolved = await adapter.resolve("https://www.douyin.com/video/7600000000000000000", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.platform, "douyin");
  assert.equal(content.contentType, "video");
  assert.equal(content.title, "测试抖音");
  assert.equal(content.videos[0]?.hasWatermark, false);
  assert.match(content.videos[0]?.url ?? "", /aweme\.snssdk\.com/);
  assertWhitelistedRaw(content.raw);
});

test("抖音桌面页受限时回退到公开移动分享页", async () => {
  const html = `<script>window._ROUTER_DATA={"loaderData":{"video":{"aweme_id":"7600000000000000001","desc":"移动分享页","author":{"nickname":"作者丁"},"video":{"duration":10000,"play_addr":{"uri":"mobile-video-id","url_list":[]}}}}};</script>`;
  const requests: HttpRequest[] = [];
  const client = new FakeHttpClient((request) => {
    requests.push(request);
    if (request.url.includes("/share/video/")) return response(request.url, html);
    return response("https://www.douyin.com/video/7600000000000000001", "<script>window.__ac_signature='challenge'</script>");
  });
  const adapter = new DouyinAdapter();
  const resolved = await adapter.resolve("https://v.douyin.com/example/", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.title, "移动分享页");
  assert.match(requests[1]?.headers?.["User-Agent"] ?? "", /Mobile/);
});

test("抖音适配器识别图文帖并解析图片与正文", async () => {
  const html = `<script>window._ROUTER_DATA={"loaderData":{"note":{"aweme_id":"7600000000000000002","desc":"抖音图文正文","author":{"nickname":"作者己"},"Cookie":"synthetic-cookie","Authorization":"Bearer SYNTHETIC","images":[{"url_list":["https://img.example/dy-1.jpg?signature=fake-sign"],"download_url_list":["https://img.example/dy-1-dl.jpg"]},{"url_list":["not-a-url"],"download_url_list":["https://img.example/dy-2.jpg"]},{"url_list":[]}]}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.douyin.com/note/7600000000000000002", html));
  const adapter = new DouyinAdapter();
  const resolved = await adapter.resolve("https://www.douyin.com/note/7600000000000000002", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.platform, "douyin");
  assert.equal(content.contentType, "image_text");
  assert.equal(content.title, "抖音图文正文");
  assert.equal(content.description, "抖音图文正文");
  assert.equal(content.author, "作者己");
  assert.equal(content.videos.length, 0);
  assert.equal(content.images.length, 2);
  assert.equal(content.images[0]?.kind, "image");
  assert.equal(content.images[0]?.url, "https://img.example/dy-1.jpg?signature=fake-sign");
  assert.equal(content.images[1]?.url, "https://img.example/dy-2.jpg");
  assert.equal(content.coverUrl, "https://img.example/dy-1.jpg?signature=fake-sign");
  assert.equal(content.images[0]?.headers?.Referer, "https://www.douyin.com/note/7600000000000000002");
  assert.equal((content.raw as { contentType?: string }).contentType, "image_text");
  assert.equal((content.raw as { media?: { imageCount?: number } }).media?.imageCount, 2);
  assertWhitelistedRaw(content.raw);
});

test("小红书适配器提取H264视频流", async () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc123":{"note":{"noteId":"abc123","title":"测试小红书","desc":"正文","user":{"nickname":"作者乙"},"Cookie":"synthetic-cookie","Authorization":"Bearer SYNTHETIC","imageList":[{"urlDefault":"https://img.example/xhs.jpg?signature=fake-sign"}],"video":{"duration":30000,"media":{"stream":{"h264":[{"masterUrl":"https://sns-video.example/master.mp4?signature=fake-sign","videoQuality":"HD","width":1080,"height":1920,"avgBitrate":1800000}]}}}}}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/explore/abc123", html));
  const adapter = new XiaohongshuAdapter();
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/explore/abc123", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.platform, "xiaohongshu");
  assert.equal(content.contentType, "video");
  assert.equal(content.author, "作者乙");
  assert.equal(content.videos[0]?.codec, "H.264");
  assertWhitelistedRaw(content.raw);
});

test("小红书适配器识别图文笔记", async () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"def456":{"note":{"noteId":"def456","title":"图文测试","desc":"正文","user":{"nickname":"作者戊"},"imageList":[{"urlDefault":"https://img.example/1.jpg"},{"urlDefault":"https://img.example/2.jpg"}]}}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/discovery/item/def456", html));
  const adapter = new XiaohongshuAdapter();
  assert.equal(adapter.matches("https://xhslink.cn/o/example"), true);
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/discovery/item/def456", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.contentType, "image_text");
  assert.equal(content.images.length, 2);
  assert.equal(content.videos.length, 0);
  assertWhitelistedRaw(content.raw);
});

test("平台页面结构变化返回稳定错误码", async () => {
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/explore/deadbeef", "<html>empty</html>"));
  const adapter = new XiaohongshuAdapter();
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/explore/deadbeef", client);
  await assert.rejects(() => adapter.parse(resolved, client), (error) => error instanceof TaskError && error.code === "CONTENT_SCHEMA_CHANGED");
});

test("B站API的HTTP 401/403映射为需要登录且不可自动重试", async () => {
  for (const status of [401, 403] as const) {
    const client = new FakeHttpClient((request) => ({
      url: request.url,
      status,
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    await assert.rejects(
      () => new BilibiliAdapter().parse({
        sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
        finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
        status: 200,
      }, client),
      (error) => error instanceof TaskError
        && error.code === "CONTENT_PRIVATE_OR_LOGIN_REQUIRED"
        && error.action === "edit_input"
        && error.retryable === false
        && error.details?.httpStatus === status,
    );
  }
});

test("B站适配器提取P1 DASH音视频", async () => {
  const requests: string[] = [];
  const client = bilibiliClient({
    play: {
      Cookie: "synthetic-cookie",
      Authorization: "Bearer SYNTHETIC",
      ...BILIBILI_PLAY,
    },
    onRequest: (request) => requests.push(request.url),
  });
  const adapter = new BilibiliAdapter();
  const resolved = await adapter.resolve("https://www.bilibili.com/video/BV1xx411c7mD", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(resolved.body, undefined);
  assert.equal(requests.some((url) => !url.includes("api.bilibili.com")), false);
  assert.equal(content.platform, "bilibili");
  assert.equal(content.contentType, "video");
  assert.equal(content.videos.length, 1);
  assert.equal(content.audios.length, 1);
  const playurl = requests.find((url) => url.includes("playurl"));
  assert.match(playurl ?? "", /[?&]qn=64(?:&|$)/);
  assert.doesNotMatch(playurl ?? "", /fourk=1/);
  assertWhitelistedRaw(content.raw);
});

test("B站URL已含BV时resolve不发HTTP", async () => {
  let calls = 0;
  const client = new FakeHttpClient(() => {
    calls += 1;
    return response("https://www.bilibili.com/video/BV1xx411c7mD", "<html>desktop page</html>");
  });
  const resolved = await new BilibiliAdapter().resolve(
    "https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.1007",
    client,
  );
  assert.equal(calls, 0);
  assert.equal(resolved.finalUrl, "https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.1007");
  assert.equal(resolved.body, undefined);
  assert.equal(resolved.status, 200);
});

test("B站短链resolve只跟Location不读最终HTML", async () => {
  const requests: HttpRequest[] = [];
  const client = bilibiliClient({
    resolve: (request) => {
      requests.push(request);
      if (request.url.includes("b23.tv")) {
        return {
          url: "https://bili2233.cn/hop",
          status: 302,
          headers: {},
          body: "",
        };
      }
      if (request.url.includes("bili2233.cn")) {
        return {
          url: "https://www.bilibili.com/video/BV1xx411c7mD?spm=1",
          status: 302,
          headers: {},
          body: "<html>must-not-be-used-as-page-body</html>",
        };
      }
      throw new Error(`unexpected fetch ${request.url}`);
    },
  });
  const resolved = await new BilibiliAdapter().resolve("https://b23.tv/mIrEY6j", client);
  assert.equal(resolved.finalUrl, "https://www.bilibili.com/video/BV1xx411c7mD?spm=1");
  assert.equal(resolved.body, undefined);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.maxRedirects === 0), true);
  assert.equal(requests.some((request) => request.url.includes("www.bilibili.com/video")), false);
});

test("B站短链跳转到未认可域名时失败", async () => {
  const client = bilibiliClient({
    resolve: () => ({
      url: "https://evil.example/stolen",
      status: 302,
      headers: {},
      body: "",
    }),
  });
  await assert.rejects(
    () => new BilibiliAdapter().resolve("https://b23.tv/mIrEY6j", client),
    (error) => error instanceof TaskError && error.code === "LINK_REDIRECT_INVALID",
  );
});

test("B站识别av号并走aid查询且不采信HTML推荐BV", async () => {
  const requests: string[] = [];
  const client = bilibiliClient({
    view: {
      ...BILIBILI_VIEW,
      aid: 12345,
      bvid: "BV1xx411c7mD",
    },
    onRequest: (request) => requests.push(request.url),
  });
  const content = await new BilibiliAdapter().parse({
    sourceUrl: "https://www.bilibili.com/video/av12345",
    finalUrl: "https://www.bilibili.com/video/av12345",
    status: 200,
    body: `<html><a href="/video/BV1yyyyyyyy1">推荐</a></html>`,
  }, client);
  const viewUrl = requests.find((url) => url.includes("/x/web-interface/view"));
  assert.match(viewUrl ?? "", /[?&]aid=12345(?:&|$)/);
  assert.doesNotMatch(viewUrl ?? "", /BV1yyyyyyyy1/);
  assert.equal(content.id, "BV1xx411c7mD");
  assert.equal(content.canonicalUrl, "https://www.bilibili.com/video/BV1xx411c7mD");
  assert.equal(content.title, "测试B站");
});

test("B站识别分P参数并使用对应cid", async () => {
  const requests: string[] = [];
  const client = bilibiliClient({
    view: {
      ...BILIBILI_VIEW,
      pages: [
        { cid: 111, duration: 40 },
        { cid: 222, duration: 30 },
      ],
    },
    onRequest: (request) => requests.push(request.url),
  });
  const content = await new BilibiliAdapter().parse({
    sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    status: 200,
  }, client);
  const playurl = requests.find((url) => url.includes("playurl"));
  assert.match(playurl ?? "", /[?&]cid=222(?:&|$)/);
  assert.equal(content.durationSeconds, 30);
  assert.equal(content.canonicalUrl, "https://www.bilibili.com/video/BV1xx411c7mD?p=2");
});

test("B站分P超出范围时明确失败", async () => {
  const client = bilibiliClient({
    view: {
      ...BILIBILI_VIEW,
      pages: [{ cid: 111, duration: 40 }],
    },
  });
  await assert.rejects(
    () => new BilibiliAdapter().parse({
      sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=9",
      finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=9",
      status: 200,
    }, client),
    (error) => error instanceof TaskError
      && error.code === "CONTENT_TYPE_UNSUPPORTED"
      && error.action === "edit_input",
  );
});

test("B站HTTP 412映射为可稍后重试的访问限制", async () => {
  const client = new FakeHttpClient((request) => {
    if (request.url.includes("/x/web-interface/nav")) return jsonResponse(request.url, { code: -101, data: {} });
    if (request.url.includes("/x/web-interface/view")) return jsonResponse(request.url, { code: 0, data: BILIBILI_VIEW });
    return { url: request.url, status: 412, headers: { "content-type": "text/plain" }, body: "Risk control" };
  });
  await assert.rejects(
    () => new BilibiliAdapter().parse({
      sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      status: 200,
    }, client),
    (error) => error instanceof TaskError
      && error.code === "PLATFORM_API_RATE_LIMITED"
      && error.retryable === true
      && error.action === "wait_and_retry"
      && error.details?.httpStatus === 412,
  );
});

test("B站-352映射为PLATFORM_RISK_CONTROLLED且不可自动重试", async () => {
  const client = bilibiliClient({
    play: { code: -352, message: "风控校验失败" },
  });
  await assert.rejects(
    () => new BilibiliAdapter().parse({
      sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      status: 200,
    }, client),
    (error) => error instanceof TaskError
      && error.code === "PLATFORM_RISK_CONTROLLED"
      && error.retryable === false
      && error.action === "wait_and_retry"
      && error.details?.providerCode === -352,
  );
});

test("B站空dash明确失败且不返回空视频源", async () => {
  const client = bilibiliClient({
    play: { code: 0, data: { dash: { video: [], audio: [] }, durl: [] } },
  });
  await assert.rejects(
    () => new BilibiliAdapter().parse({
      sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      status: 200,
    }, client),
    (error) => error instanceof TaskError
      && error.code === "MEDIA_SOURCE_NOT_FOUND"
      && error.action === "retry",
  );
});

test("B站公开wbi签名与已知向量一致", () => {
  const query = signWbiQuery(
    { foo: "114", bar: "514", zab: 1_919_810 },
    "7cd084941338484aae1ad9425b84077c",
    "4932caff0ff746eab6f01bf08b70ac45",
    1_702_204_169,
  );
  assert.match(query, /(?:^|&)w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4(?:&|$)/);
  assert.match(query, /(?:^|&)wts=1702204169(?:&|$)/);
});

test("B站在拿到公开wbi口令后为playurl附加签名", async () => {
  const requests: string[] = [];
  const client = bilibiliClient({
    nav: {
      code: -101,
      data: {
        isLogin: false,
        wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        },
      },
    },
    onRequest: (request) => requests.push(request.url),
  });
  await new BilibiliAdapter().parse({
    sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    finalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    status: 200,
  }, client);
  const playurl = requests.find((url) => url.includes("playurl"));
  assert.match(playurl ?? "", /\/x\/player\/wbi\/playurl/);
  assert.match(playurl ?? "", /[?&]w_rid=[0-9a-f]{32}(?:&|$)/);
  assert.match(playurl ?? "", /[?&]wts=\d+(?:&|$)/);
  assert.match(playurl ?? "", /[?&]qn=64(?:&|$)/);
  assert.doesNotMatch(playurl ?? "", /fourk=1/);
});
