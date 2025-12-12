/**
 * Browser-safe app action encoders
 *
 * These functions encode calldata for app lifecycle operations.
 * They only depend on viem and are safe to use in browser environments.
 */

import { parseAbi, encodeFunctionData } from "viem";
import type { AppId } from "../types";

// Minimal ABI for app lifecycle operations
const CONTROLLER_ABI = parseAbi([
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

/**
 * Encode start app call data for gas estimation or transaction
 */
export function encodeStartAppData(appId: AppId): `0x${string}` {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "startApp",
    args: [appId],
  });
}

/**
 * Encode stop app call data for gas estimation or transaction
 */
export function encodeStopAppData(appId: AppId): `0x${string}` {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "stopApp",
    args: [appId],
  });
}

/**
 * Encode terminate app call data for gas estimation or transaction
 */
export function encodeTerminateAppData(appId: AppId): `0x${string}` {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "terminateApp",
    args: [appId],
  });
}
