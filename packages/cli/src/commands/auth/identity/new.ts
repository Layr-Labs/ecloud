/**
 * Auth Identity New Command
 *
 * Create a new identity: Gnosis Safe or Timelock.
 * Requires a signing key in the keyring (run `auth generate` or `auth login` first).
 */

import { Command } from "@oclif/core";
import { confirm, select, input } from "@inquirer/prompts";
import {
  keyExists,
  getPrivateKeyWithSource,
  getAddressFromPrivateKey,
  getEnvironmentConfig,
  deploySafe,
  deployTimelock,
  getTimelocksByDeployer,
  getSafesByDeployer,
  type DeploySafeOptions,
  type DeployTimelockOptions,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createViemClients } from "../../../utils/viemClients";
import { addIdentity, setActiveIdentity, getIdentities } from "../../../utils/globalConfig";
import { SAFE_ABI, TIMELOCK_ABI } from "../../../utils/contractAbis";
import { keccak256, encodePacked } from "viem";
import type { Address } from "viem";

/** Parse human delay strings like "24h", "7d", "30m" into seconds */
function parseDelay(s: string): bigint {
  const match = s.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) throw new Error(`Invalid delay format: "${s}". Use e.g. "24h", "7d", "3600s" (unit required).`);
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return BigInt(n * multipliers[unit]);
}

function makeLogger(log: (m: string) => void, warn: (m: string) => void, verbose: boolean) {
  return {
    debug: (msg: string) => { if (verbose) log(msg); },
    info: (msg: string) => log(msg),
    warn: (msg: string) => warn(msg),
    error: (msg: string) => warn(msg),
  };
}

export default class AuthIdentityNew extends Command {
  static description = "Create a new identity: Gnosis Safe or Timelock";

  static examples = [
    "<%= config.bin %> <%= command.id %>",
  ];

  static flags = {
    ...commonFlags,
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthIdentityNew);

      // Require a signing key
      const exists = await keyExists();
      if (!exists) {
        this.error("No signing key found. Run 'ecloud auth generate' or 'ecloud auth login' first.");
      }

      const kind = await select({
        message: "What type of identity?",
        choices: [
          { name: "Gnosis Safe  (multi-sig)", value: "safe" },
          { name: "Timelock  (for existing EOA or Safe)", value: "timelock" },
        ],
      });

      this.log("");

      if (kind === "safe") {
        await this._runSafe(flags);
      } else {
        await this._runTimelock(flags);
      }
    });
  }

  private async _runSafe(flags: any): Promise<void> {
    const existing = await getPrivateKeyWithSource({ privateKey: flags["private-key"] });
    if (!existing) {
      this.error("No signing key available.");
    }

    const signingKey = existing.key;
    const environmentConfig = getEnvironmentConfig(flags.environment);
    const { walletClient, publicClient, address: signerAddress } = createViemClients({
      privateKey: signingKey,
      rpcUrl: flags["rpc-url"],
      environment: flags.environment,
    });

    this.log(`Signing key ${signerAddress} will be included as an owner and cannot be removed.\n`);

    const extraOwnersRaw = await input({
      message: "Additional owner addresses (comma-separated, leave blank for none):",
      default: "",
    });
    const extraOwners = extraOwnersRaw
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0) as Address[];
    const owners: Address[] = [signerAddress, ...extraOwners];

    const thresholdRaw = await input({
      message: `Threshold (e.g., ${Math.ceil(owners.length / 2)} of ${owners.length}):`,
      default: String(Math.ceil(owners.length / 2)),
      validate: (v) => {
        const n = parseInt(v, 10);
        return n >= 1 && n <= owners.length ? true : `Must be between 1 and ${owners.length}`;
      },
    });
    const threshold = parseInt(thresholdRaw, 10);

    const addTimelock = await confirm({ message: "Add timelock delay?", default: false });
    let delayStr = "";
    if (addTimelock) {
      delayStr = await input({
        message: 'Minimum delay (e.g., "24h", "7d"):',
        default: "24h",
        validate: (v) => /^\d+(s|m|h|d)$/i.test(v.trim()) ? true : 'Invalid format. Use a number followed by a unit: s, m, h, or d (e.g., "24h", "7d").',
      });
    }
    const logger = makeLogger(this.log.bind(this), this.warn.bind(this), flags.verbose);

    this.log("");
    if (addTimelock) {
      this.log(`Deploying Safe (${thresholdRaw} of ${owners.length}) + Timelock via factory...`);
    } else {
      this.log(`Deploying Safe (${thresholdRaw} of ${owners.length}) via factory...`);
    }

    const { tx: safeTx, safe } = await deploySafe(
      { walletClient, publicClient, environmentConfig, owners, threshold } as DeploySafeOptions,
      logger,
    );
    this.log(`\n✓ Safe deployed:     ${safe} (${thresholdRaw}/${owners.length})`);
    this.log(`  Tx: ${safeTx}`);

    if (addTimelock) {
      const minDelay = parseDelay(delayStr);
      const { tx: tlTx, timelock } = await deployTimelock(
        {
          walletClient,
          publicClient,
          environmentConfig,
          minDelay,
          proposers: [safe],
          executors: [safe],
        } as DeployTimelockOptions,
        logger,
      );
      addIdentity({ type: "timelock", address: timelock, delay: delayStr, safeAddress: safe, environment: flags.environment });
      setActiveIdentity(flags.environment, timelock);
      this.log(`✓ Timelock deployed: ${timelock} (${delayStr} delay, wraps Safe)`);
      this.log(`  Tx: ${tlTx}`);
      this.log(`\n✓ Active identity set to: Timelock(Safe) ${timelock}`);
    } else {
      addIdentity({ type: "safe", address: safe, environment: flags.environment, threshold, owners: owners.map(String) });
      setActiveIdentity(flags.environment, safe);
      this.log(`\n✓ Active identity set to: Safe ${safe}`);
    }
  }

  private async _runTimelock(flags: any): Promise<void> {
    await validateCommonFlags(flags, { requirePrivateKey: true });

    const environmentConfig = getEnvironmentConfig(flags.environment);
    const { walletClient, publicClient, address: signerAddress } = createViemClients({
      privateKey: flags["private-key"] as string,
      rpcUrl: flags["rpc-url"],
      environment: flags.environment,
    });

    const balance = await publicClient.getBalance({ address: signerAddress });
    if (balance === BigInt(0)) {
      this.error(`Account ${signerAddress} has no ETH. Fund it before deploying.`);
    }

    // Build proposer choices: EOA + any Safes deployed by this EOA
    const knownSafes = await getSafesByDeployer(publicClient, environmentConfig, signerAddress);

    const safeInfos = await Promise.all(
      knownSafes.map(async (safe) => {
        try {
          const [threshold, owners] = await Promise.all([
            publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: "getThreshold" }) as Promise<bigint>,
            publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners" }) as Promise<Address[]>,
          ]);
          const ownerSummary = owners.length <= 3
            ? owners.map((o) => `${o.slice(0, 6)}…${o.slice(-4)}`).join(", ")
            : `${owners.slice(0, 2).map((o) => `${o.slice(0, 6)}…${o.slice(-4)}`).join(", ")} +${owners.length - 2} more`;
          return { safe, label: `Safe  ${safe}  (${threshold}/${owners.length}: ${ownerSummary})` };
        } catch {
          return { safe, label: `Safe  ${safe}` };
        }
      }),
    );

    const proposerChoices: { name: string; value: string }[] = [
      { name: `EOA  ${signerAddress}`, value: `eoa:${signerAddress}` },
      ...safeInfos.map(({ safe, label }) => ({ name: label, value: `safe:${safe}` })),
    ];

    const proposerChoice = await select({ message: "Select proposer/executor:", choices: proposerChoices });
    const proposerKind = proposerChoice.startsWith("safe:") ? "safe" : "eoa";
    const proposer = proposerChoice.split(":")[1] as Address;

    // Timelocks are indexed by msg.sender (always the signing EOA), not by proposer/executor.
    // Filter to those where the selected proposer actually holds PROPOSER_ROLE.
    const allDeployedTimelocks = await getTimelocksByDeployer(publicClient, environmentConfig, signerAddress);
    const PROPOSER_ROLE = "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1" as const;
    const proposerFlags = await Promise.all(
      allDeployedTimelocks.map((tl) =>
        publicClient.readContract({ address: tl, abi: TIMELOCK_ABI, functionName: "hasRole", args: [PROPOSER_ROLE, proposer] }) as Promise<boolean>,
      ),
    );
    const existingTimelocks = allDeployedTimelocks.filter((_, i) => proposerFlags[i]);
    if (existingTimelocks.length > 0) {
      const proposerLabel = proposerKind === "eoa" ? "EOA" : "Safe";
      const storedAddresses = new Set(getIdentities().map((id) => id.address.toLowerCase()));

      // Separate into already-stored and new
      const newTimelocks = existingTimelocks.filter((a) => !storedAddresses.has(a.toLowerCase()));
      const knownTimelocks = existingTimelocks.filter((a) => storedAddresses.has(a.toLowerCase()));

      if (newTimelocks.length === 0) {
        // All already in config — offer to switch active or deploy a new one
        this.log(`\nAll Timelocks for this ${proposerLabel} are already in your identities:`);
        const identityMap = new Map(getIdentities().map((id) => [id.address.toLowerCase(), id]));
        for (const addr of knownTimelocks) {
          const delay = identityMap.get(addr.toLowerCase())?.delay;
          this.log(`  ${addr}${delay ? `  (delay: ${delay})` : ""}`);
        }
        const action = await select({
          message: "What would you like to do?",
          choices: [
            { name: "Set one as active identity", value: "activate" },
            { name: "Deploy a new Timelock with a different delay", value: "deploy" },
            { name: "Nothing", value: "nothing" },
          ],
        });
        if (action === "activate") {
          const chosen = existingTimelocks.length === 1
            ? existingTimelocks[0]
            : (await select({
                message: "Which Timelock?",
                choices: existingTimelocks.map((a) => {
                  const delay = identityMap.get(a.toLowerCase())?.delay;
                  return { name: delay ? `${a}  (delay: ${delay})` : a, value: a };
                }),
              }));
          setActiveIdentity(flags.environment, chosen);
          this.log(`✓ Active identity set to Timelock ${chosen}`);
          return;
        } else if (action === "nothing") {
          return;
        }
        // action === "deploy": fall through to deploy flow below
      } else {
        this.log(`\nFound ${newTimelocks.length} Timelock${newTimelocks.length > 1 ? "s" : ""} deployed by this ${proposerLabel}:`);
        for (const addr of newTimelocks) this.log(`  ${addr}`);
        const addIt = await confirm({ message: "Add them to your identities?", default: true });
        if (addIt) {
          const isSafe = proposerKind === "safe";
          for (const addr of newTimelocks) {
            addIdentity({ type: "timelock", address: addr as Address, delay: "unknown", safeAddress: isSafe ? proposer : undefined, environment: flags.environment });
          }
          const chosen = newTimelocks.length === 1
            ? newTimelocks[0]
            : (await select({
                message: "Set which one as active?",
                choices: newTimelocks.map((a) => ({ name: a, value: a })),
              }));
          setActiveIdentity(flags.environment, chosen as Address);
          this.log(`✓ Timelock${newTimelocks.length > 1 ? "s" : ""} added and active set to ${chosen}`);
        }
        const deployAnother = await confirm({ message: "Deploy an additional Timelock with a different delay?", default: false });
        if (!deployAnother) return;
      }
    }

    const delayStr = await input({
      message: 'Minimum delay (e.g., "24h", "7d"):',
      default: "24h",
      validate: (v) => /^\d+(s|m|h|d)$/i.test(v.trim()) ? true : 'Invalid format. Use a number followed by a unit: s, m, h, or d (e.g., "24h", "7d").',
    });
    const minDelay = parseDelay(delayStr);
    const logger = makeLogger(this.log.bind(this), this.warn.bind(this), flags.verbose);

    this.log("\nDeploying Timelock via factory...");
    const { tx, timelock } = await deployTimelock(
      {
        walletClient,
        publicClient,
        environmentConfig,
        minDelay,
        proposers: [proposer],
        executors: [proposer],
        salt: keccak256(encodePacked(["address", "uint256"], [proposer, minDelay])),
      } as DeployTimelockOptions,
      logger,
    );

    const isSafe = proposerKind === "safe";
    addIdentity({
      type: "timelock",
      address: timelock,
      delay: delayStr,
      safeAddress: isSafe ? proposer : undefined,
      environment: flags.environment,
    });
    setActiveIdentity(flags.environment, timelock);

    this.log(`\n✓ Timelock deployed: ${timelock}`);
    this.log(`  Minimum delay:     ${delayStr}`);
    this.log(`  Proposer/Executor: ${proposer}${isSafe ? " (Safe)" : ""}`);
    this.log(`  Tx:                ${tx}`);
    this.log(`\n✓ Active identity set to: Timelock(${isSafe ? "Safe" : "EOA"}) ${timelock}`);
  }
}
