// ============ Request/Response Types ============

export interface SubmitBuildRequest {
  repoUrl: string;
  gitRef: string;
  dockerfilePath?: string;
  /**
   * Path to a Caddyfile within the repository (relative to buildContextPath).
   * If omitted, the build service will not copy a Caddyfile into the image.
   */
  caddyfilePath?: string;
  buildContextPath?: string;
  dependencies?: string[];
}

export interface SubmitBuildResponse {
  buildId: string;
}

export const BUILD_STATUS = {
  BUILDING: "building",
  SUCCESS: "success",
  FAILED: "failed",
} as const;

export type BuildStatus = (typeof BUILD_STATUS)[keyof typeof BUILD_STATUS];

export interface Build {
  buildId: string;
  billingAddress: string;
  repoUrl: string;
  gitRef: string;
  status: BuildStatus;
  /** 'application' | 'dependency' (as returned by the API) */
  buildType: string;
  imageName: string;
  imageUrl?: string;
  imageDigest?: string;
  provenanceJson?: Record<string, unknown>;
  provenanceSignature?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  dependencies?: Record<string, Build>;
}

// ============ Verification Types ============

export type VerifyProvenanceResult = VerifyProvenanceSuccess | VerifyProvenanceFailure;

export interface VerifyProvenanceSuccess {
  status: "verified";
  buildId: string;
  imageUrl: string;
  imageDigest: string;
  repoUrl: string;
  gitRef: string;
  provenanceJson: Record<string, unknown>;
  provenanceSignature: string;
  payloadType: string;
  payload: string;
}

export interface VerifyProvenanceFailure {
  status: "failed";
  error: string;
  buildId?: string;
}

// ============ Log Streaming ============

export interface LogChunk {
  content: string;
  totalLength: number;
  isComplete: boolean;
  finalStatus?: BuildStatus;
}

export interface BuildProgress {
  build: Build;
  logs: string;
}
