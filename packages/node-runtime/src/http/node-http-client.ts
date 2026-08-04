import type { HttpClient, HttpRequest, HttpResponse } from "@hongtai/core";

function validateHttps(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`仅允许HTTPS请求：${parsed.hostname}`);
  return parsed;
}
export class NodeHttpClient implements HttpClient {
  async get(request: HttpRequest): Promise<HttpResponse> {
    let current = validateHttps(request.url);
    const maxRedirects = request.maxRedirects ?? 5;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await fetch(current, {
        method: "GET",
        headers: request.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`重定向缺少Location：HTTP ${response.status}`);
        if (redirectCount === maxRedirects) throw new Error(`链接重定向超过${maxRedirects}次`);
        current = validateHttps(new URL(location, current).toString());
        continue;
      }

      return {
        url: response.url || current.toString(),
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    }
    throw new Error("无法完成链接请求");
  }
}
