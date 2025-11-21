/**
 * Instance type utilities
 */

import { Address } from "viem";
import { PreflightContext } from "./preflight";
import { Logger } from "../types";
import { UserApiClient } from "./userapi";

/**
 * Get current instance type for an app (best-effort)
 * Returns empty string if unable to fetch (API unavailable, app info not ready, etc.).
 * This is used as a convenience default for the upgrade flow.
 */
export async function getCurrentInstanceType(
  preflightCtx: PreflightContext,
  appID: Address,
  logger: Logger,
): Promise<string> {
  try {
    const userApiClient = new UserApiClient(
      preflightCtx.environmentConfig,
      preflightCtx.privateKey,
    );

    const infos = await userApiClient.getInfos([appID], 1, logger);
    if (infos.length === 0) {
      return ""; // No app info available yet
    }

    return infos[0].machineType || "";
  } catch (err: any) {
    logger.debug(`Failed to get current instance type: ${err.message}`);
    return ""; // API call failed, skip default
  }
}

