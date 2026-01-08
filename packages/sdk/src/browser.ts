/**
 * Browser-safe SDK entry point
 *
 * This module exports only code that can run in browser environments.
 * It excludes Node.js-only dependencies like:
 * - dockerode (Docker API)
 * - @napi-rs/keyring (OS keychain)
 * - fs operations (file system)
 * - @inquirer/prompts (CLI prompts)
 *
 * Use this entry point in React/Next.js/browser applications:
 * import { ... } from "@layr-labs/ecloud-sdk/browser"
 */

// =============================================================================
// Types (all browser-safe)
// =============================================================================
export * from "./client/common/types";

// =============================================================================
// Environment Configuration (browser-safe)
// =============================================================================
export {
  getEnvironmentConfig,
  getAvailableEnvironments,
  isEnvironmentAvailable,
  getBuildType,
  isMainnet,
} from "./client/common/config/environment";

// =============================================================================
// Validation Utilities (browser-safe subset only)
// Note: validateFilePath, validateImagePath, validateDeployParams, validateUpgradeParams
// are excluded because they use fs/path Node.js modules
// =============================================================================
export {
  // App name
  validateAppName,
  // Image reference
  validateImageReference,
  assertValidImageReference,
  extractAppNameFromImage,
  // Instance type
  validateInstanceTypeSKU,
  // Private key
  validatePrivateKeyFormat,
  assertValidPrivateKey,
  // URL validation
  validateURL,
  validateXURL,
  // Description
  validateDescription,
  // App ID
  validateAppID,
  // Log visibility
  validateLogVisibility,
  type LogVisibility,
  // Sanitization
  sanitizeString,
  sanitizeURL,
  sanitizeXURL,
  // Parameter validation (browser-safe ones only)
  validateCreateAppParams,
  validateLogsParams,
  type CreateAppParams,
  type LogsParams,
} from "./client/common/utils/validation";

// =============================================================================
// Billing Utilities (browser-safe)
// =============================================================================
export { isSubscriptionActive } from "./client/common/utils/billing";

// =============================================================================
// Key Generation (browser-safe - uses viem)
// =============================================================================
export { generateNewPrivateKey, type GeneratedKey } from "./client/common/auth/generate";

// =============================================================================
// API Clients (browser-safe - use axios/fetch)
// =============================================================================
export {
  UserApiClient,
  type UserApiClientOptions,
  type AppInfo,
  type AppProfileInfo,
  type AppMetrics,
  type AppInfoResponse,
} from "./client/common/utils/userapi";

// =============================================================================
// Contract Read Operations (browser-safe)
// =============================================================================
export {
  // Read operations
  getAllAppsByDeveloper,
  getAppsByCreator,
  getAppsByDeveloper,
  getActiveAppCount,
  getMaxActiveAppsPerUser,
  // Gas estimation
  estimateTransactionGas,
  formatETH,
  // Types
  type GasEstimate,
  type EstimateGasOptions,
  type AppConfig,
} from "./client/common/contract/caller";

// =============================================================================
// Batch Gas Estimation (browser-safe)
// =============================================================================
export { estimateBatchGas, type EstimateBatchGasOptions } from "./client/common/contract/eip7702";

// =============================================================================
// App Action Encoders (browser-safe - pure viem encoding)
// =============================================================================
export {
  encodeStartAppData,
  encodeStopAppData,
  encodeTerminateAppData,
} from "./client/common/contract/encoders";

// =============================================================================
// SIWE (Sign-In with Ethereum) Utilities (browser-safe)
// =============================================================================
export {
  createSiweMessage,
  parseSiweMessage,
  generateNonce,
  isSiweMessageExpired,
  isSiweMessageNotYetValid,
  type SiweMessageParams,
  type SiweMessage,
} from "./client/common/auth/siwe";

// =============================================================================
// Compute API Session Management (browser-safe)
// =============================================================================
export {
  loginToComputeApi,
  logoutFromComputeApi,
  getComputeApiSession,
  isSessionValid,
  SessionError,
  type ComputeApiConfig,
  type SessionInfo,
  type LoginResult,
  type LoginRequest,
} from "./client/common/auth/session";

// =============================================================================
// React Hooks (requires React 18+ as peer dependency)
// =============================================================================
export {
  useComputeSession,
  type UseComputeSessionConfig,
  type UseComputeSessionReturn,
} from "./client/common/hooks";

// =============================================================================
// Re-export common types
// =============================================================================
export type Environment = "sepolia" | "sepolia-dev" | "mainnet-alpha";
