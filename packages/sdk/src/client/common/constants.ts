/**
 * Constants used throughout the SDK
 */

export const DOCKER_PLATFORM = "linux/amd64";
export const REGISTRY_PROPAGATION_WAIT_SECONDS = 3;
export const LAYERED_DOCKERFILE_NAME = "Dockerfile.eigencompute";
export const ENV_SOURCE_SCRIPT_NAME = "compute-source-env.sh";
export const KMS_CLIENT_BINARY_NAME = "kms-client";
export const KMS_ENCRYPTION_KEY_NAME = "kms-encryption-public-key.pem";
export const KMS_SIGNING_KEY_NAME = "kms-signing-public-key.pem";
export const TLS_KEYGEN_BINARY_NAME = "tls-keygen";
export const CADDYFILE_NAME = "Caddyfile";
export const TEMP_IMAGE_PREFIX = "ecloud-temp-";
export const LAYERED_BUILD_DIR_PREFIX = "ecloud-layered-build";
export const SHA256_PREFIX = "sha256:";
export const JWT_FILE_PATH =
  "/run/container_launcher/attestation_verifier_claims_token";

// Template paths (relative to templates directory)
export const LAYERED_DOCKERFILE_TEMPLATE_PATH = "Dockerfile.layered.tmpl";
export const ENV_SOURCE_SCRIPT_TEMPLATE_PATH = "compute-source-env.sh.tmpl";
