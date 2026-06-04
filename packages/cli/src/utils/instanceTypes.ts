import { UserApiClient } from "@layr-labs/ecloud-sdk";
import { createViemClients } from "./viemClients";
import { getClientId } from "./version";
import type { SkuInfo } from "./prompts";

/**
 * Fetch the instance types (SKUs) offered by the backend for an environment.
 *
 * Best-effort: on any failure (network, auth, empty list) this warns and returns
 * a single safe fallback SKU rather than aborting, so deploy/upgrade can still
 * proceed with a sensible default.
 */
export async function fetchAvailableInstanceTypes(
  environment: string,
  environmentConfig: any,
  privateKey: string,
  rpcUrl: string,
): Promise<SkuInfo[]> {
  try {
    const { publicClient, walletClient } = createViemClients({
      privateKey,
      rpcUrl,
      environment,
    });
    const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
      clientId: getClientId(),
    });

    const skuList = await userApiClient.getSKUs();
    if (skuList.skus.length === 0) {
      throw new Error("No instance types available from server");
    }

    return skuList.skus;
  } catch (err: any) {
    console.warn(`Failed to fetch instance types: ${err.message}`);
    // Return a default fallback
    return [{ sku: "g1-standard-4t", description: "4 vCPUs, 16 GB memory, TDX" }];
  }
}
