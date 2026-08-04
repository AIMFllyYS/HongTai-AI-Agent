import { TaskError, type HttpClient, type HttpRequest, type HttpResponse } from "@hongtai/core";

export interface NodeHttpClientOptions {
  readonly retryDelaysMs?: readonly number[];
}

function validateHttps(url: string, redirect = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new TaskError({
      code: redirect ? "LINK_REDIRECT_INVALID" : "INPUT_URL_INVALID",
      message: redirect ? "平台返回了无效跳转地址" : "链接格式无效",
      action: "edit_input",
      cause: error,
    });
  }
  if (parsed.protocol !== "https:") {
    throw new TaskError({
      code: "LINK_REDIRECT_INVALID",
      message: "链接被重定向到非HTTPS地址，已停止访问",
      action: "edit_input",
      details: { hostname: parsed.hostname || "unknown" },
    });
  }
  return parsed;
}

function networkError(error: unknown, hostname: string): TaskError {
  const name = error instanceof Error ? error.name : "UnknownError";
  const timedOut = name === "AbortError" || name === "TimeoutError";
  return new TaskError({
    code: timedOut ? "LINK_TIMEOUT" : "LINK_NETWORK_FAILED",
    message: timedOut ? "链接请求超时，请稍后重试" : "链接请求失败，请检查网络连接",
    retryable: true,
    action: timedOut ? "retry" : "check_network",
    details: { hostname },
    cause: error,
  });
}

export class NodeHttpClient implements HttpClient {
  readonly #retryDelaysMs: readonly number[];

  constructor(options: NodeHttpClientOptions = {}) {
    this.#retryDelaysMs = options.retryDelaysMs ?? [0, 1_000, 3_000];
  }

  async get(request: HttpRequest): Promise<HttpResponse> {
    let current = validateHttps(request.url);
    const maxRedirects = request.maxRedirects ?? 5;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await this.#fetchWithRetry(current, request);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          throw new TaskError({ code: "LINK_REDIRECT_INVALID", message: "平台跳转响应缺少目标地址", action: "retry" });
        }
        if (redirectCount === maxRedirects) {
          throw new TaskError({
            code: "LINK_REDIRECT_LIMIT",
            message: `链接跳转超过${maxRedirects}次，可能已经失效`,
            action: "edit_input",
            details: { maxRedirects },
          });
        }
        current = validateHttps(new URL(location, current).toString(), true);
        continue;
      }

      return {
        url: response.url || current.toString(),
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    }
    throw new TaskError({ code: "LINK_REDIRECT_LIMIT", message: "无法完成链接跳转", action: "edit_input" });
  }

  async #fetchWithRetry(url: URL, request: HttpRequest): Promise<Response> {
    let lastError: TaskError | undefined;
    for (let attempt = 0; attempt < this.#retryDelaysMs.length; attempt += 1) {
      const delay = this.#retryDelaysMs[attempt] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: request.headers,
          redirect: "manual",
          signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
        });
        const retryableStatus = response.status === 429 || response.status >= 500;
        if (!retryableStatus) return response;
        await response.body?.cancel();
        lastError = new TaskError({
          code: response.status === 429 ? "PLATFORM_API_RATE_LIMITED" : "PLATFORM_API_UNAVAILABLE",
          message: response.status === 429 ? "平台请求过于频繁，请稍后重试" : "平台服务暂时不可用",
          retryable: true,
          action: "wait_and_retry",
          details: { httpStatus: response.status, hostname: url.hostname, attempts: attempt + 1 },
        });
      } catch (error) {
        lastError = networkError(error, url.hostname);
      }
    }
    throw lastError ?? networkError(new Error("request failed"), url.hostname);
  }
}
