import assert from "node:assert/strict";
import test from "node:test";
import type { HttpClient, HttpRequest, HttpResponse } from "../packages/core/src/index";
import { TaskError } from "../packages/core/src/index";
import {
  BilibiliAdapter,
  DouyinAdapter,
  XiaohongshuAdapter,
  extractAssignedJson,
} from "../packages/platforms/src/index";

class FakeHttpClient implements HttpClient {
  readonly #handler: (request: HttpRequest) => HttpResponse;

  constructor(handler: (request: HttpRequest) => HttpResponse) {
    this.#handler = handler;
  }

  async get(request: HttpRequest): Promise<HttpResponse> {
    return this.#handler(request);
  }
}

function response(url: string, body: string): HttpResponse {
  return { url, status: 200, headers: { "content-type": "text/html" }, body };
}

test("extractAssignedJson支持嵌套对象和undefined", () => {
  const value = extractAssignedJson(
    '<script>window.__INITIAL_STATE__={"note":{"value":undefined,"nested":{"ok":true}}};</script>',
    ["window.__INITIAL_STATE__"],
  );
  assert.deepEqual(value, { note: { value: null, nested: { ok: true } } });
});

test("现有平台显式标记为稳定支持", () => {
  assert.equal(new DouyinAdapter().supportLevel, "stable");
  assert.equal(new XiaohongshuAdapter().supportLevel, "stable");
  assert.equal(new BilibiliAdapter().supportLevel, "stable");
});

test("抖音适配器从公开页面状态提取无水印视频", async () => {
  const html = `<script>window._ROUTER_DATA={"loaderData":{"video":{"aweme_id":"7600000000000000000","desc":"测试抖音","author":{"nickname":"作者甲"},"video":{"duration":45000,"cover":{"url_list":["https://img.example/cover.jpg"]},"bit_rate":[{"gear_name":"1080p","bit_rate":2000000,"play_addr":{"uri":"video-file-id","url_list":["https://cdn.example/playwm/item.mp4"]}}]}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.douyin.com/video/7600000000000000000", html));
  const adapter = new DouyinAdapter();
  const resolved = await adapter.resolve("https://www.douyin.com/video/7600000000000000000", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.platform, "douyin");
  assert.equal(content.contentType, "video");
  assert.equal(content.title, "测试抖音");
  assert.equal(content.videos[0]?.hasWatermark, false);
  assert.match(content.videos[0]?.url ?? "", /aweme\.snssdk\.com/);
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

test("小红书适配器提取H264视频流", async () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc123":{"note":{"noteId":"abc123","title":"测试小红书","desc":"正文","user":{"nickname":"作者乙"},"imageList":[{"urlDefault":"https://img.example/xhs.jpg"}],"video":{"duration":30000,"media":{"stream":{"h264":[{"masterUrl":"https://sns-video.example/master.mp4","videoQuality":"HD","width":1080,"height":1920,"avgBitrate":1800000}]}}}}}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/explore/abc123", html));
  const adapter = new XiaohongshuAdapter();
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/explore/abc123", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.platform, "xiaohongshu");
  assert.equal(content.contentType, "video");
  assert.equal(content.author, "作者乙");
  assert.equal(content.videos[0]?.codec, "H.264");
});

test("小红书适配器识别图文笔记", async () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"img123":{"note":{"noteId":"img123","title":"图文测试","desc":"正文","user":{"nickname":"作者戊"},"imageList":[{"urlDefault":"https://img.example/1.jpg"},{"urlDefault":"https://img.example/2.jpg"}]}}}}};</script>`;
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/discovery/item/img123", html));
  const adapter = new XiaohongshuAdapter();
  assert.equal(adapter.matches("https://xhslink.cn/o/example"), true);
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/discovery/item/img123", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.contentType, "image_text");
  assert.equal(content.images.length, 2);
  assert.equal(content.videos.length, 0);
});

test("平台页面结构变化返回稳定错误码", async () => {
  const client = new FakeHttpClient(() => response("https://www.xiaohongshu.com/explore/deadbeef", "<html>empty</html>"));
  const adapter = new XiaohongshuAdapter();
  const resolved = await adapter.resolve("https://www.xiaohongshu.com/explore/deadbeef", client);
  await assert.rejects(() => adapter.parse(resolved, client), (error) => error instanceof TaskError && error.code === "CONTENT_SCHEMA_CHANGED");
});

test("B站适配器提取P1 DASH音视频", async () => {
  const client = new FakeHttpClient((request) => {
    if (request.url.includes("/x/web-interface/view")) {
      return response(request.url, JSON.stringify({
        code: 0,
        data: {
          bvid: "BV1xx411c7mD",
          title: "测试B站",
          desc: "简介",
          duration: 60,
          owner: { name: "作者丙" },
          pages: [{ cid: 123, duration: 60 }],
        },
      }));
    }
    if (request.url.includes("/x/player/playurl")) {
      return response(request.url, JSON.stringify({
        code: 0,
        data: {
          dash: {
            video: [{ id: 80, baseUrl: "https://video.example/video.m4s", bandwidth: 2000000, width: 1920, height: 1080, codecs: "avc1" }],
            audio: [{ id: 30280, baseUrl: "https://video.example/audio.m4s", bandwidth: 192000, codecs: "mp4a" }],
          },
        },
      }));
    }
    return response("https://www.bilibili.com/video/BV1xx411c7mD", "<html></html>");
  });
  const adapter = new BilibiliAdapter();
  const resolved = await adapter.resolve("https://www.bilibili.com/video/BV1xx411c7mD", client);
  const content = await adapter.parse(resolved, client);
  assert.equal(content.platform, "bilibili");
  assert.equal(content.contentType, "video");
  assert.equal(content.videos.length, 1);
  assert.equal(content.audios.length, 1);
});
