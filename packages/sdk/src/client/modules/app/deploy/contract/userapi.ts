import { Agent as UndiciAgent } from 'undici';
import { Address } from 'viem';
import { EnvironmentConfig } from '../types';
import { getKMSKeysForEnvironment } from '../utils/keys';

export interface AppInfo {
  address: Address;
  status: string;
  ip: string;
  machineType: string;
}

export interface AppInfoResponse {
  apps: Array<{
    addresses: {
      data: {
        evmAddresses: Address[];
        solanaAddresses: string[];
      };
      signature: string;
    };
    app_status: string;
    ip: string;
    machine_type: string;
  }>;
}

const MAX_ADDRESS_COUNT = 5;

export class UserApiClient {
  constructor(private readonly config: EnvironmentConfig) {}

  async getInfos(appIDs: Address[], addressCount = 1): Promise<AppInfo[]> {
    const count = Math.min(addressCount, MAX_ADDRESS_COUNT);

    const endpoint = `${this.config.userApiServerURL}/info`;
    const url = `${endpoint}?${new URLSearchParams({ apps: appIDs.join(',') })}`;

    const res = await this.makeAuthenticatedRequest(url, '0x0e67b22f');
    const result: AppInfoResponse = await res.json();

    // optional: verify signatures with KMS key
    const { signingKey } = getKMSKeysForEnvironment(this.config.name);

    // Truncate without mutating the original object
    return result.apps.map((app, i) => {
      // TODO: Implement signature verification
      // const valid = await verifyKMSSignature(appInfo.addresses, signingKey);
      // if (!valid) {
      //   throw new Error(`Invalid signature for app ${appIDs[i]}`);
      // }
      const evm = app.addresses.data.evmAddresses.slice(0, count);
      const sol = app.addresses.data.solanaAddresses.slice(0, count);
      // If the API ties each `apps[i]` to `appIDs[i]`, use i. Otherwise derive from `evm[0]`
      const inferredAddress = evm[0] ?? appIDs[i] ?? appIDs[0];

      return {
        address: inferredAddress as Address,
        status: app.app_status,
        ip: app.ip,
        machineType: app.machine_type,
      };
    });
  }

  private async makeAuthenticatedRequest(url: string, permission?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    // Add auth headers if permission is specified
    if (permission) {
      // TODO: Implement auth header generation
      // const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes
      // const authHeaders = await generateAuthHeaders(permission, expiry);
      // Object.assign(headers, authHeaders);
    }

    // Node fetch uses Undici under the hood - use dispatcher, not https.Agent
    const insecureDispatcher = new UndiciAgent({
      connect: { rejectUnauthorized: false },
    });

    const response = await fetch(url, {
      method: 'GET',
      headers,
      // @ts-expect-error - lib.dom types don’t include Undici extension
      dispatcher: insecureDispatcher,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`UserAPI request failed: ${response.status} ${text}`);
    }
    return response;
  }
}
