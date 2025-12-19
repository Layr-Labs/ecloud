/**
 * Build module entry point (verifiable builds + provenance)
 */

import { getEnvironmentConfig } from "../../common/config/environment";
import { withSDKTelemetry } from "../../common/telemetry/wrapper";
import { getLogger, addHexPrefix } from "../../common/utils";
import { BuildApiClient } from "../../common/utils/buildapi";

import { BUILD_STATUS } from "./types";
import type {
  Build,
  BuildProgress,
  BuildStatus,
  LogChunk,
  SubmitBuildRequest,
  SubmitBuildResponse,
  VerifyProvenanceResult,
} from "./types";
import { AuthRequiredError, BuildFailedError, TimeoutError } from "./errors";

export interface BuildModuleConfig {
  privateKey?: string;
  environment?: string;
  verbose?: boolean;
  clientId?: string;
  skipTelemetry?: boolean;
}

export interface BuildModule {
  submit(request: SubmitBuildRequest): Promise<SubmitBuildResponse>;
  getLogs(buildId: string): Promise<string>;

  get(buildId: string): Promise<Build>;
  getByDigest(digest: string): Promise<Build>;
  verify(identifier: string): Promise<VerifyProvenanceResult>;

  submitAndWait(
    request: SubmitBuildRequest,
    options?: {
      onLog?: (chunk: string) => void;
      onProgress?: (progress: BuildProgress) => void;
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<Build>;

  waitForBuild(
    buildId: string,
    options?: {
      onLog?: (chunk: string) => void;
      onProgress?: (progress: BuildProgress) => void;
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<Build>;

  streamLogs(buildId: string, pollIntervalMs?: number): AsyncGenerator<LogChunk, void, unknown>;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 30 * 60 * 1000;

export function createBuildModule(config: BuildModuleConfig): BuildModule {
  const { verbose = false, skipTelemetry = false } = config;
  const logger = getLogger(verbose);

  const environment = config.environment || "sepolia";
  const environmentConfig = getEnvironmentConfig(environment);

  // NOTE: build endpoints are served from the compute UserAPI host
  const api = new BuildApiClient({
    baseUrl: environmentConfig.userApiServerURL,
    privateKey: config.privateKey ? addHexPrefix(config.privateKey) : undefined,
    clientId: config.clientId,
  });

  return {
    async submit(request: SubmitBuildRequest): Promise<SubmitBuildResponse> {
      return withSDKTelemetry(
        {
          functionName: "build.submit",
          skipTelemetry,
          properties: { environment, repoUrl: request.repoUrl },
        },
        async () => {
          if (!config.privateKey) throw new AuthRequiredError("Private key required for submit()");

          const data = await api.submitBuild({
            repo_url: request.repoUrl,
            git_ref: request.gitRef,
            dockerfile_path: request.dockerfilePath ?? "Dockerfile",
            build_context_path: request.buildContextPath ?? ".",
            dependencies: request.dependencies ?? [],
          });

          logger.debug(`Submitted build: ${data.build_id}`);
          return { buildId: data.build_id };
        },
      );
    },

    async get(buildId: string): Promise<Build> {
      return withSDKTelemetry(
        { functionName: "build.get", skipTelemetry, properties: { environment, buildId } },
        async () => transformBuild(await api.getBuild(buildId)),
      );
    },

    async getByDigest(digest: string): Promise<Build> {
      return withSDKTelemetry(
        { functionName: "build.getByDigest", skipTelemetry, properties: { environment, digest } },
        async () => transformBuild(await api.getBuildByDigest(digest)),
      );
    },

    async verify(identifier: string): Promise<VerifyProvenanceResult> {
      return withSDKTelemetry(
        { functionName: "build.verify", skipTelemetry, properties: { environment, identifier } },
        async () => transformVerifyResult(await api.verify(identifier)),
      );
    },

    async getLogs(buildId: string): Promise<string> {
      return withSDKTelemetry(
        { functionName: "build.getLogs", skipTelemetry, properties: { environment, buildId } },
        async () => {
          if (!config.privateKey) throw new AuthRequiredError("Private key required for getLogs()");
          return api.getLogs(buildId);
        },
      );
    },

    async submitAndWait(request, options = {}) {
      const { buildId } = await this.submit(request);
      return this.waitForBuild(buildId, options);
    },

    async waitForBuild(buildId, options = {}) {
      const {
        onLog,
        onProgress,
        pollIntervalMs = DEFAULT_POLL_INTERVAL,
        timeoutMs = DEFAULT_TIMEOUT,
      } = options;

      const startTime = Date.now();
      let lastLogLength = 0;

      while (true) {
        if (Date.now() - startTime > timeoutMs) {
          throw new TimeoutError(`Build timed out after ${timeoutMs}ms`);
        }

        const build = await this.get(buildId);
        let logs = "";

        try {
          logs = await this.getLogs(buildId);
          if (onLog && logs.length > lastLogLength) {
            onLog(logs.slice(lastLogLength));
            lastLogLength = logs.length;
          }
        } catch {
          // ignore
        }

        onProgress?.({ build, logs });

        if (build.status === BUILD_STATUS.SUCCESS) return build;
        if (build.status === BUILD_STATUS.FAILED) {
          throw new BuildFailedError(build.errorMessage ?? "Build failed", buildId);
        }

        await sleep(pollIntervalMs);
      }
    },

    async *streamLogs(buildId, pollIntervalMs = DEFAULT_POLL_INTERVAL) {
      let lastLength = 0;
      while (true) {
        const build = await this.get(buildId);
        let logs = "";

        try {
          logs = await this.getLogs(buildId);
        } catch {
          // ignore
        }

        if (logs.length > lastLength) {
          yield {
            content: logs.slice(lastLength),
            totalLength: logs.length,
            isComplete: build.status !== BUILD_STATUS.BUILDING,
            finalStatus: build.status !== BUILD_STATUS.BUILDING ? build.status : undefined,
          };
          lastLength = logs.length;
        }

        if (build.status !== BUILD_STATUS.BUILDING) break;
        await sleep(pollIntervalMs);
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transformBuild(raw: any): Build {
  return {
    buildId: raw.build_id,
    billingAddress: raw.billing_address,
    repoUrl: raw.repo_url,
    gitRef: raw.git_ref,
    status: raw.status as BuildStatus,
    buildType: raw.build_type,
    imageName: raw.image_name,
    imageUrl: raw.image_url,
    imageDigest: raw.image_digest,
    provenanceJson: raw.provenance_json ?? undefined,
    provenanceSignature: raw.provenance_signature ?? undefined,
    errorMessage: raw.error_message ?? undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    dependencies: raw.dependencies
      ? Object.fromEntries(Object.entries(raw.dependencies).map(([k, v]) => [k, transformBuild(v)]))
      : undefined,
  };
}

function transformVerifyResult(raw: any): VerifyProvenanceResult {
  if (raw.status === "verified") {
    return {
      status: "verified",
      buildId: raw.build_id,
      imageUrl: raw.image_url,
      imageDigest: raw.image_digest,
      repoUrl: raw.repo_url,
      gitRef: raw.git_ref,
      provenanceJson: raw.provenance_json,
      provenanceSignature: raw.provenance_signature,
      payloadType: raw.payload_type,
      payload: raw.payload,
    };
  }

  return {
    status: "failed",
    error: raw.error,
    buildId: raw.build_id,
  };
}

// Re-export errors/types for convenience
export * from "./types";
export * from "./errors";
