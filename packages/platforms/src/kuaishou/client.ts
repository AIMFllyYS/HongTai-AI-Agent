import { TaskError, type HttpClient } from "@hongtai/core";
import { DESKTOP_USER_AGENT, asArray, asNumber, asRecord, asString } from "../shared";

const KUAISHOU_GRAPHQL_URL = "https://video.kuaishou.com/graphql";
const OPERATION_NAME = "visionVideoDetail";

const VIDEO_DETAIL_QUERY = `query visionVideoDetail($photoId: String, $type: String, $page: String) {
  visionVideoDetail(photoId: $photoId, type: $type, page: $page) {
    status
    type
    author { id name }
    photo {
      id
      duration
      caption
      coverUrl
      photoUrl
      manifest {
        adaptationSet {
          representation { url width height codecs avgBitrate qualityType }
        }
      }
    }
  }
}`;

export interface KuaishouDetailResult {
  readonly detail: Record<string, unknown>;
  readonly httpStatus: number;
  readonly graphqlErrorCount: number;
}

function graphqlErrors(payload: Record<string, unknown>): readonly Record<string, unknown>[] {
  return asArray(payload.errors).flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  });
}

function isRiskControlled(error: Record<string, unknown>): boolean {
  const message = asString(error.message)?.toLowerCase() ?? "";
  const extensions = asRecord(error.extensions);
  return /need captcha|captcha|验证码|验证/.test(message)
    || asNumber(extensions?.result) === 2;
}

export async function fetchKuaishouDetail(
  http: HttpClient,
  photoId: string,
  referer: string,
): Promise<KuaishouDetailResult> {
  const response = await http.post({
    url: KUAISHOU_GRAPHQL_URL,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": DESKTOP_USER_AGENT,
      Origin: "https://www.kuaishou.com",
      Referer: referer,
    },
    body: JSON.stringify({
      operationName: OPERATION_NAME,
      variables: { photoId, page: "search" },
      query: VIDEO_DETAIL_QUERY,
    }),
    maxRedirects: 0,
    timeoutMs: 30_000,
    maxAttempts: 2,
  });

  if (response.status === 401 || response.status === 403) {
    throw new TaskError({ code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED", message: "快手作品需要登录或没有访问权限", action: "edit_input", details: { httpStatus: response.status } });
  }
  if (response.status === 429) {
    throw new TaskError({ code: "PLATFORM_API_RATE_LIMITED", message: "快手平台访问过于频繁，请稍后重试", retryable: true, action: "wait_and_retry", details: { httpStatus: 429 } });
  }
  if ([500, 502, 503, 504].includes(response.status)) {
    throw new TaskError({ code: "PLATFORM_API_UNAVAILABLE", message: "快手平台服务暂时不可用", retryable: true, action: "wait_and_retry", details: { httpStatus: response.status } });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "快手作品详情请求失败", action: "retry", details: { httpStatus: response.status } });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body) as unknown;
  } catch (error) {
    throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "快手作品详情返回了无效JSON", action: "retry", cause: error });
  }
  const root = asRecord(payload);
  if (!root) throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "快手作品详情返回格式无效", action: "retry" });
  const errors = graphqlErrors(root);
  if (isRiskControlled(root) || errors.some(isRiskControlled)) {
    throw new TaskError({ code: "PLATFORM_RISK_CONTROLLED", message: "快手平台触发风控，暂时无法获取视频", retryable: true, action: "wait_and_retry", details: { graphqlErrorCount: errors.length } });
  }
  if (errors.length > 0) {
    throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "快手作品详情返回平台错误", action: "retry", details: { graphqlErrorCount: errors.length } });
  }
  const detail = asRecord(asRecord(root.data)?.visionVideoDetail);
  if (!detail) throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "快手作品详情缺少必要数据", action: "retry" });
  return { detail, httpStatus: response.status, graphqlErrorCount: errors.length };
}

export const KUAISHOU_OPERATION_NAME = OPERATION_NAME;
