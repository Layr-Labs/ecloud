/**
 * Auth Generate Command
 *
 * Create a new identity: EOA private key, Gnosis Safe, or Timelock (wrapping EOA or Safe).
 */

import { Command, Flags } from "@oclif/core";
import { confirm, select, input } from "@inquirer/prompts";
import {
  generateNewPrivateKey,
  storePrivateKey,
  keyExists,
  getEnvironmentConfig,
  deploySafe,
  deployTimelock,
  discoverTimelockForEOA,
  type DeploySafeOptions,
  type DeployTimelockOptions,
} from "@layr-labs/ecloud-sdk";
import { showPrivateKey, displayWarning } from "../../utils/security";
import { withTelemetry } from "../../telemetry";
import { commonFlags, validateCommonFlags } from "../../flags";
import { createViemClients } from "../../utils/viemClients";
import { addIdentity, setActiveIdentity, replaceAllIdentities, getIdentities } from "../../utils/globalConfig";
import type { Address } from "viem";

/** Parse human delay strings like "24h", "7d", "30m" into seconds */
function parseDelay(s: string): bigint {
  const match = s.trim().match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid delay format: "${s}". Use e.g. "24h", "7d", "3600s".`);
  const n = parseInt(match[1], 10);
  const unit = (match[2] || "s").toLowerCase();
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

export default class AuthGenerate extends Command {
  static description = "Create a new identity: EOA private key, Gnosis Safe, or Timelock";

  static aliases = ["auth:gen", "auth:new"];

  static examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --store",
  ];

  static flags = {
    ...commonFlags,
    store: Flags.boolean({
      description: "Automatically store EOA key in OS keyring",
      default: false,
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthGenerate);

      const kind = await select({
        message: "What would you like to create?",
        choices: [
          { name: "EOA  (new private key)", value: "eoa" },
          { name: "Gnosis Safe", value: "safe" },
          { name: "Timelock  (for existing EOA or Safe)", value: "timelock" },
        ],
      });

      this.log("");

      if (kind === "eoa") {
        await this._runEOA(flags);
      } else if (kind === "safe") {
        await this._runSafe(flags);
      } else {
        await this._runTimelock(flags);
      }
    });
  }

  private async _runEOA(flags: any): Promise<void> {
    const { privateKey, address } = generateNewPrivateKey();

    const content = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A new private key was generated for you.

IMPORTANT: You MUST backup this key now.
           It will never be shown again.

Address:     ${address}
Private key: ${privateKey}

⚠️  SECURITY WARNING:
   • Anyone with this key can control your account
   • Never share it or commit it to version control
   • Store it in a secure password manager
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Press 'q' to exit and continue...
`;

    const displayed = await showPrivateKey(content);
    if (!displayed) {
      this.log("Key generation cancelled.");
      return;
    }

    let shouldStore = flags.store;
    if (!shouldStore) {
      shouldStore = await confirm({ message: "Store this key in your OS keyring?", default: true });
    }

    if (shouldStore) {
      const exists = await keyExists();
      if (exists) {
        displayWarning([
          `WARNING: A private key for ecloud already exists!`,
          "If you continue, the existing key will be PERMANENTLY REPLACED.",
          "This cannot be undone!",
          "",
          "The previous key will be lost forever if you haven't backed it up.",
        ]);
        const confirmReplace = await confirm({ message: `Replace existing key for ecloud?`, default: false });
        if (!confirmReplace) {
          this.log("\nKey not stored. If you did not save your new key when it was displayed, it is now lost and cannot be recovered.");
          return;
        }
      }
      try {
        await storePrivateKey(privateKey);
        // New signing key — wipe all identities (they belonged to the previous EOA)
        replaceAllIdentities([{ type: "eoa", address }]);
        for (const env of ["sepolia", "sepolia-dev", "mainnet-alpha"]) {
          setActiveIdentity(env, address);
        }
        this.log(`\n✓ Private key stored in OS keyring`);
        this.log(`✓ Address: ${address}`);
        this.log("\nYou can now use ecloud commands without --private-key flag.");
      } catch (err: any) {
        this.error(`Failed to store key: ${err.message}`);
      }
    } else {
      this.log("\nKey not stored in keyring.");
      this.log("Remember to save the key shown above in a secure location.");
    }
  }

  private async _runSafe(flags: any): Promise<void> {
    await validateCommonFlags(flags, { requirePrivateKey: true });

    const ownersRaw = await input({
      message: "Enter owner addresses (comma-separated):",
      validate: (v) => (v.trim().length > 0 ? true : "At least one owner is required"),
    });
    const owners = ownersRaw.split(",").map((a) => a.trim() as Address);

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
      delayStr = await input({ message: 'Minimum delay (e.g., "24h", "7d"):', default: "24h" });
    }

    const environmentConfig = getEnvironmentConfig(flags.environment);
    const { walletClient, publicClient } = createViemClients({
      privateKey: flags["private-key"] as string,
      rpcUrl: flags["rpc-url"],
      environment: flags.environment,
    });
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
      addIdentity({ type: "safe", address: safe, environment: flags.environment });
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
    if (balance === 0n) {
      this.error(`Account ${signerAddress} has no ETH. Fund it before deploying.`);
    }

    const proposerKind = await select({
      message: "Is the proposer/executor an EOA or a Safe?",
      choices: [
        { name: "EOA  (signing key)", value: "eoa" },
        { name: "Gnosis Safe  (multi-sig)", value: "safe" },
      ],
    });

    const proposer: Address = proposerKind === "eoa"
      ? signerAddress
      : await input({
          message: "Safe address:",
          validate: (v) => (v.trim().startsWith("0x") ? true : "Must be a 0x address"),
        }) as Address;

    // Check if a canonical Timelock already exists for this EOA
    if (proposerKind === "eoa") {
      const existing = await discoverTimelockForEOA(publicClient, environmentConfig, proposer);
      if (existing) {
        const delayHours = Number(existing.minDelay) / 3600;
        const delayLabel = delayHours >= 24 ? `${delayHours / 24}d` : `${delayHours}h`;
        const alreadyInConfig = getIdentities().some(
          (id) => id.address.toLowerCase() === existing.address.toLowerCase(),
        );
        if (alreadyInConfig) {
          this.log(`\nTimelock ${existing.address} is already in your identities.`);
          const activate = await confirm({ message: "Set it as active identity?", default: true });
          if (activate) {
            setActiveIdentity(flags.environment, existing.address);
            this.log(`✓ Active identity set to Timelock ${existing.address}`);
          }
        } else {
          this.log(`\nA Timelock already exists for this EOA: ${existing.address}  (${delayLabel} delay)`);
          const addIt = await confirm({ message: "Add it to your identities?", default: true });
          if (addIt) {
            addIdentity({ type: "timelock", address: existing.address, delay: delayLabel, environment: flags.environment });
            setActiveIdentity(flags.environment, existing.address);
            this.log(`✓ Timelock added and set as active identity`);
          }
        }
        return;
      }
    }

    const delayStr = await input({
      message: 'Minimum delay (e.g., "24h", "7d"):',
      default: "24h",
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
