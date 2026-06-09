/**
 * Deploy-time guard against accidentally provisioning a second billable app
 * with a name that is already in use by a live app for the same developer.
 *
 * Authoritative by construction: enumeration is a direct on-chain read
 * (getAllAppsByDeveloper) and names come from the coordinator-DB-backed /info
 * profile — neither touches the lagging Ponder indexer. The check is
 * fail-open: any read error returns undefined so a transient blip never blocks
 * a legitimate deploy.
 */
import { Address } from "viem";
import {
  getAllAppsByDeveloper,
  getEnvironmentConfig,
  UserApiClient,
} from "@layr-labs/ecloud-sdk";
import { createViemClients } from "./viemClients";
import { getAppInfosChunked } from "./appResolver";
import { getClientId } from "./version";

// Mirrors ContractAppStatusTerminated in prompts.ts (AppStatus enum).
const CONTRACT_APP_STATUS_TERMINATED = 3;

export interface FindLiveAppByNameArgs {
  environment: string;
  privateKey: string;
  rpcUrl: string;
  name: string;
}

/** Normalize a profile name for comparison: trimmed + lowercased. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Return the address of a non-terminated app owned by the caller whose profile
 * name matches `name`, or undefined if none (or if the check cannot complete).
 */
export async function findLiveAppByName(
  args: FindLiveAppByNameArgs,
): Promise<Address | undefined> {
  try {
    const environmentConfig = getEnvironmentConfig(args.environment);
    const { publicClient, walletClient, address } = createViemClients({
      privateKey: args.privateKey,
      rpcUrl: args.rpcUrl,
      environment: args.environment,
    });

    const { apps, appConfigs } = await getAllAppsByDeveloper(
      publicClient,
      environmentConfig,
      address,
    );

    // Keep only non-terminated apps.
    const liveApps: Address[] = [];
    for (let i = 0; i < apps.length; i++) {
      if (appConfigs[i]?.status !== CONTRACT_APP_STATUS_TERMINATED) {
        liveApps.push(apps[i]);
      }
    }
    const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
      clientId: getClientId(),
    });
    const infos = await getAppInfosChunked(userApiClient, liveApps);

    const target = normalizeName(args.name);
    const match = infos.find(
      (info) => info.profile?.name && normalizeName(info.profile.name) === target,
    );
    return match?.address;
  } catch (error) {
    // Fail-open: never block a deploy on a read failure. Log at debug so a
    // maintainer can see why the collision guard didn't fire.
    console.debug?.("findLiveAppByName: name-collision check failed, proceeding:", error);
    return undefined;
  }
}
