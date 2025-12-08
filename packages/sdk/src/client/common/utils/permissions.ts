/**
 * Permission checking utilities
 */

import { Address, createPublicClient, http, Hex } from "viem";
import { EnvironmentConfig, Logger } from "../types";
import PermissionControllerABI from "../abis/PermissionController.json";
import { getChainFromID } from "./helpers";

// Permission constants (matching Go version)
const AnyoneCanCallAddress = "0x493219d9949348178af1f58740655951a8cd110c" as Address;
const ApiPermissionsTarget = "0x57ee1fb74c1087e26446abc4fb87fd8f07c43d8d" as Address;
const CanViewAppLogsPermission = "0x2fd3f2fe" as Hex;

/**
 * Check if an app currently has public log viewing permissions
 */
export async function checkAppLogPermission(
  preflightCtx: {
    environmentConfig: EnvironmentConfig;
    rpcUrl: string;
  },
  appAddress: Address,
  logger: Logger,
): Promise<boolean> {
  const chain = getChainFromID(preflightCtx.environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(preflightCtx.rpcUrl),
  });

  try {
    // Call the canCall method on PermissionController
    const canCall = await publicClient.readContract({
      address: preflightCtx.environmentConfig.permissionControllerAddress as Address,
      abi: PermissionControllerABI,
      functionName: "canCall",
      args: [appAddress, AnyoneCanCallAddress, ApiPermissionsTarget, CanViewAppLogsPermission],
    });

    return canCall as boolean;
  } catch (err: any) {
    logger.warn(`Failed to check log permission: ${err.message}. Assuming private logs.`);
    // Default to false (private) on error
    return false;
  }
}
