import { TaskError } from "@hongtai/core";
import type { AiTransport, OpenAiCompatibleProviderConfig } from "./contracts/provider";
import { OpenAiCompatibleProvider, reasoningDialectForBaseUrl } from "./providers/openai-compatible-provider";
import {
  createFetchAiTransport,
  type FetchAiTransportConfig,
} from "./transports/fetch-ai-transport";

export { FetchAiTransport, createFetchAiTransport, type FetchAiTransportConfig } from "./transports/fetch-ai-transport";

export type NodeAiConnectionConfig = FetchAiTransportConfig;

export interface NodeOpenAiCompatibleProviderConfig extends Omit<OpenAiCompatibleProviderConfig, "transport" | "reasoningDialect">, NodeAiConnectionConfig {}

/** Builds the Node-only HTTP transport after validating the local .env connection values. */
export function createNodeAiTransport(config: NodeAiConnectionConfig): AiTransport {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) {
    throw new TaskError({ code: "AI_NOT_CONFIGURED", message: "AI连接缺少Base URL或API Key", action: "configure_ai" });
  }
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:") {
    throw new TaskError({ code: "AI_NETWORK_FAILED", message: "AI Base URL必须使用HTTPS", action: "configure_ai" });
  }
  return createFetchAiTransport(config);
}

/** Keeps CLI callers on a safe Node factory while the root package stays runtime-agnostic. */
export function createNodeOpenAiCompatibleProvider(
  config: NodeOpenAiCompatibleProviderConfig,
): OpenAiCompatibleProvider {
  const { baseUrl, apiKey, fetchImpl, ...providerConfig } = config;
  return new OpenAiCompatibleProvider({
    ...providerConfig,
    reasoningDialect: reasoningDialectForBaseUrl(baseUrl),
    transport: createNodeAiTransport({ baseUrl, apiKey, fetchImpl }),
  });
}
