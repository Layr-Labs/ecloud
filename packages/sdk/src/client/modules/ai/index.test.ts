import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiGatewayClient,
  createAttestedAiGatewayClient,
  DEFAULT_AI_GATEWAY_BASE_URL,
} from "./index";

describe("AiGatewayClient", () => {
  const originalAiGatewayUrl = process.env.ECLOUD_AI_GATEWAY_URL;
  const originalFallbackUrls = process.env.ECLOUD_AI_GATEWAY_FALLBACK_URLS;
  const originalKmsServerUrl = process.env.KMS_SERVER_URL;
  const originalKmsPublicKey = process.env.KMS_PUBLIC_KEY;

  beforeEach(() => {
    delete process.env.ECLOUD_AI_GATEWAY_URL;
    delete process.env.ECLOUD_AI_GATEWAY_FALLBACK_URLS;
    delete process.env.KMS_SERVER_URL;
    delete process.env.KMS_PUBLIC_KEY;
  });

  afterEach(() => {
    restoreEnv("ECLOUD_AI_GATEWAY_URL", originalAiGatewayUrl);
    restoreEnv("ECLOUD_AI_GATEWAY_FALLBACK_URLS", originalFallbackUrls);
    restoreEnv("KMS_SERVER_URL", originalKmsServerUrl);
    restoreEnv("KMS_PUBLIC_KEY", originalKmsPublicKey);
    vi.restoreAllMocks();
  });

  it("adds the attestation bearer token to gateway requests", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [] }, { status: 200 }));
    const client = new AiGatewayClient({
      tokenProvider: async () => "jwt-token",
      fetchFn,
    });

    await client.listModels();

    expect(fetchFn).toHaveBeenCalledWith(`${DEFAULT_AI_GATEWAY_BASE_URL}/v1/models`, {
      method: "GET",
      headers: expect.any(Headers),
    });
    const headers = fetchFn.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt-token");
  });

  it("does not fail over normal API responses such as JSON 401s", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "invalid token" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }, { status: 200 }));
    const client = new AiGatewayClient({
      tokenProvider: { getToken: async () => "bad-token" },
      baseUrl: "https://primary.example.com/",
      fallbackBaseUrls: ["https://fallback.example.com"],
      fetchFn,
    });

    await expect(client.listModels()).rejects.toMatchObject({
      details: { status: 401, contentType: "application/json" },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe("https://primary.example.com/v1/models");
  });

  it("fails over Cloudflare transient HTML responses to the next configured base URL", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse("<html><!--[if lt IE 7]>cloudflare</html>", {
          status: 502,
          headers: { server: "cloudflare", "cf-ray": "abc-SIN" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "model-a" }] }, { status: 200 }));
    const client = new AiGatewayClient({
      tokenProvider: async () => "jwt-token",
      baseUrl: "https://primary.example.com",
      fallbackBaseUrls: ["https://fallback.example.com"],
      fetchFn,
    });

    const models = await client.listModels<{ data: Array<{ id: string }> }>();

    expect(models.data[0].id).toBe("model-a");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe("https://primary.example.com/v1/models");
    expect(fetchFn.mock.calls[1][0]).toBe("https://fallback.example.com/v1/models");
  });

  it("reads fallback URLs from ECLOUD_AI_GATEWAY_FALLBACK_URLS", async () => {
    process.env.ECLOUD_AI_GATEWAY_URL = "https://primary.example.com";
    process.env.ECLOUD_AI_GATEWAY_FALLBACK_URLS =
      "https://fallback-a.example.com, https://fallback-b.example.com/";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse("cloudflare", {
          status: 502,
          headers: { server: "cloudflare" },
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse("cloudflare", {
          status: 502,
          headers: { server: "cloudflare" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));
    const client = new AiGatewayClient({
      tokenProvider: async () => "jwt-token",
      fetchFn,
    });

    await expect(client.listModels()).resolves.toEqual({ ok: true });

    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual([
      "https://primary.example.com/v1/models",
      "https://fallback-a.example.com/v1/models",
      "https://fallback-b.example.com/v1/models",
    ]);
  });

  it("throws diagnostics when the final gateway response is not ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      htmlResponse("<html><!--[if lt IE 7]>cloudflare error page</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { server: "cloudflare", "cf-ray": "ray-id-SIN" },
      }),
    );
    const client = new AiGatewayClient({
      tokenProvider: async () => "jwt-token",
      fetchFn,
    });

    await expect(client.listModels()).rejects.toMatchObject({
      name: "AiGatewayRequestError",
      message: "AI gateway request failed (502 Bad Gateway). Cloudflare ray: ray-id-SIN.",
      details: {
        status: 502,
        statusText: "Bad Gateway",
        cfRay: "ray-id-SIN",
        contentType: "text/html",
      },
    });
  });

  it("posts chat completions with JSON content type", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ choices: [] }, { status: 200 }));
    const client = new AiGatewayClient({
      tokenProvider: async () => "jwt-token",
      fetchFn,
    });
    const body = { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hi" }] };

    await client.chatCompletions(body);

    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("requires KMS environment when creating an attested gateway client from env", () => {
    expect(() =>
      createAttestedAiGatewayClient({ audience: "https://ai-gateway.eigencloud.xyz" }),
    ).toThrow("KMS_SERVER_URL is required");

    process.env.KMS_SERVER_URL = "http://kms.internal:8080";
    expect(() =>
      createAttestedAiGatewayClient({ audience: "https://ai-gateway.eigencloud.xyz" }),
    ).toThrow("KMS_PUBLIC_KEY is required");
  });
});

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...headersRecord(init.headers) },
  });
}

function htmlResponse(body: string, init: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html", ...headersRecord(init.headers) },
  });
}

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
