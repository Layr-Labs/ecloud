import { AttestClient, type AttestClientConfig } from "../attest/attest-client";
import { JwtProvider } from "../attest/jwt-provider";

export const DEFAULT_AI_GATEWAY_BASE_URL = "https://ai-gateway.eigencloud.xyz";

const CLOUDFLARE_TRANSIENT_STATUSES = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530,
]);

export type AiGatewayTokenProvider = { getToken: () => Promise<string> } | (() => Promise<string>);

export interface AiGatewayClientConfig {
  tokenProvider: AiGatewayTokenProvider;
  baseUrl?: string;
  fallbackBaseUrls?: string[];
  fetchFn?: typeof fetch;
}

export interface AttestedAiGatewayClientConfig
  extends
    Omit<AiGatewayClientConfig, "tokenProvider">,
    Pick<AttestClientConfig, "audience" | "socketPath"> {
  kmsServerURL?: string;
  kmsPublicKey?: string;
  jwtBufferSeconds?: number;
}

export interface AiGatewayRequestErrorDetails {
  status?: number;
  statusText?: string;
  url: string;
  cfRay?: string;
  contentType?: string;
  bodySnippet?: string;
}

export class AiGatewayRequestError extends Error {
  readonly details: AiGatewayRequestErrorDetails;

  constructor(
    message: string,
    details: AiGatewayRequestErrorDetails,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "AiGatewayRequestError";
    this.details = details;
    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AiGatewayClient {
  private readonly tokenProvider: AiGatewayTokenProvider;
  private readonly baseUrls: string[];
  private readonly fetchFn: typeof fetch;

  constructor(config: AiGatewayClientConfig) {
    this.tokenProvider = config.tokenProvider;
    this.baseUrls = resolveBaseUrls(config.baseUrl, config.fallbackBaseUrls);
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getBearerToken(this.tokenProvider);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    let lastNetworkError: unknown;

    for (let index = 0; index < this.baseUrls.length; index++) {
      const url = joinUrl(this.baseUrls[index], path);
      try {
        const response = await this.fetchFn(url, { ...init, headers });
        if (index < this.baseUrls.length - 1 && isCloudflareTransient(response)) {
          continue;
        }
        return response;
      } catch (error) {
        lastNetworkError = error;
        if (index === this.baseUrls.length - 1) {
          throw new AiGatewayRequestError(
            `AI gateway request failed before receiving a response: ${errorMessage(error)}`,
            { url },
            { cause: error },
          );
        }
      }
    }

    throw new AiGatewayRequestError(
      `AI gateway request failed before receiving a response: ${errorMessage(lastNetworkError)}`,
      { url: joinUrl(this.baseUrls[this.baseUrls.length - 1], path) },
      { cause: lastNetworkError },
    );
  }

  async requestJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(path, init);
    if (!response.ok) {
      throw await createResponseError(response);
    }
    return response.json() as Promise<T>;
  }

  async listModels<T = unknown>(init: RequestInit = {}): Promise<T> {
    return this.requestJson<T>("/v1/models", { ...init, method: init.method ?? "GET" });
  }

  async chatCompletions<T = unknown>(body: unknown, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return this.requestJson<T>("/v1/chat/completions", {
      ...init,
      method: init.method ?? "POST",
      headers,
      body: init.body ?? JSON.stringify(body),
    });
  }
}

export function createAiGatewayClient(config: AiGatewayClientConfig): AiGatewayClient {
  return new AiGatewayClient(config);
}

export function createAttestedAiGatewayClient(
  config: AttestedAiGatewayClientConfig,
): AiGatewayClient {
  const kmsServerURL = config.kmsServerURL ?? process.env.KMS_SERVER_URL;
  const kmsPublicKey = config.kmsPublicKey ?? process.env.KMS_PUBLIC_KEY;

  if (!kmsServerURL) {
    throw new Error("KMS_SERVER_URL is required to create an attested AI gateway client");
  }
  if (!kmsPublicKey) {
    throw new Error("KMS_PUBLIC_KEY is required to create an attested AI gateway client");
  }

  const attestClient = new AttestClient({
    kmsServerURL,
    kmsPublicKey,
    audience: config.audience,
    socketPath: config.socketPath,
  });

  return new AiGatewayClient({
    ...config,
    tokenProvider: new JwtProvider(attestClient, config.jwtBufferSeconds),
  });
}

function getBearerToken(provider: AiGatewayTokenProvider): Promise<string> {
  if (typeof provider === "function") {
    return provider();
  }
  return provider.getToken();
}

function resolveBaseUrls(baseUrl?: string, fallbackBaseUrls?: string[]): string[] {
  const primary =
    normalizeBaseUrl(baseUrl) ??
    normalizeBaseUrl(readEnv("ECLOUD_AI_GATEWAY_URL")) ??
    DEFAULT_AI_GATEWAY_BASE_URL;
  const fallbacks =
    fallbackBaseUrls ??
    readEnv("ECLOUD_AI_GATEWAY_FALLBACK_URLS")
      ?.split(",")
      .map((value) => value.trim());

  return dedupe([primary, ...(fallbacks ?? [])].map(normalizeBaseUrl).filter(isDefined));
}

function normalizeBaseUrl(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

function readEnv(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : process.env[name];
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function isCloudflareTransient(response: Response): boolean {
  if (!CLOUDFLARE_TRANSIENT_STATUSES.has(response.status)) {
    return false;
  }

  const server = response.headers.get("server")?.toLowerCase() ?? "";
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    server.includes("cloudflare") ||
    response.headers.has("cf-ray") ||
    contentType.includes("text/html")
  );
}

async function createResponseError(response: Response): Promise<AiGatewayRequestError> {
  const contentType = response.headers.get("content-type") ?? undefined;
  const cfRay = response.headers.get("cf-ray") ?? undefined;
  const bodySnippet = (await response.clone().text()).slice(0, 500);
  const cloudflareHint =
    isCloudflareTransient(response) && cfRay ? ` Cloudflare ray: ${cfRay}.` : "";

  return new AiGatewayRequestError(
    `AI gateway request failed (${response.status} ${response.statusText}).${cloudflareHint}`,
    {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      cfRay,
      contentType,
      bodySnippet,
    },
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
