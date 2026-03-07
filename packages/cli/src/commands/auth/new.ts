// [DEMO STUB] Real implementation: taras/gov branch. Set ECLOUD_REAL_MODE=true to bypass.
/**
 * Auth New Command
 *
 * Create a new identity: EOA, Gnosis Safe, or Timelock.
 */

import { Command, Flags } from "@oclif/core";
import { confirm, input, select } from "@inquirer/prompts";
import { generateNewPrivateKey, storePrivateKey, keyExists } from "@layr-labs/ecloud-sdk";
import { showPrivateKey, displayWarning } from "../../utils/security";
import { withTelemetry } from "../../telemetry";
import { getDemoState, setDemoState } from "../../utils/demoState";
import chalk from "chalk";

export default class AuthNew extends Command {
  static description = "Create a new identity: EOA, Gnosis Safe, or Timelock";

  static aliases = ["auth:generate", "auth:gen"];

  static examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --store",
  ];

  static flags = {
    store: Flags.boolean({
      description: "Automatically store in OS keyring",
      default: false,
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthNew);

      if (process.env.ECLOUD_REAL_MODE !== "true") {
        await demoNew(this.log.bind(this));
        return;
      }

      // Generate new key
      this.log("Generating new private key...\n");
      const { privateKey, address } = generateNewPrivateKey();

      // Display key securely
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

      // Ask about storing
      let shouldStore = flags.store;

      if (!shouldStore && displayed) {
        shouldStore = await confirm({
          message: "Store this key in your OS keyring?",
          default: true,
        });
      }

      if (shouldStore) {
        // Check if key already exists
        const exists = await keyExists();

        if (exists) {
          displayWarning([
            `WARNING: A private key for ecloud already exists!`,
            "If you continue, the existing key will be PERMANENTLY REPLACED.",
            "This cannot be undone!",
            "",
            "The previous key will be lost forever if you haven't backed it up.",
          ]);

          const confirmReplace = await confirm({
            message: `Replace existing key for ecloud?`,
            default: false,
          });

          if (!confirmReplace) {
            this.log(
              "\nKey not stored. If you did not save your new key when it was displayed, it is now lost and cannot be recovered.",
            );
            return;
          }
        }

        // Store the key
        try {
          await storePrivateKey(privateKey);
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
    });
  }
}

function demoDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function demoNew(log: (msg: string) => void): Promise<void> {
  log("");

  const kind = await select({
    message: "What would you like to create?",
    choices: [
      { name: "EOA  (new private key)", value: "eoa" },
      { name: "Gnosis Safe", value: "safe" },
      { name: "Timelock  (for existing EOA or Safe)", value: "timelock" },
    ],
  });

  log("");

  if (kind === "eoa") {
    log(chalk.gray("Generating new private key..."));
    await demoDelay(600);
    const addr = "0xF00D111122223333444455556666777788889999";
    setDemoState({ ...getDemoState(), identity: { address: addr, type: "eoa", label: "your wallet" } });
    log(`\n${chalk.green("✓")} New EOA: ${chalk.bold(addr)}`);
    log(chalk.green("✓") + " Private key stored in OS keyring.");
    log(chalk.yellow("\nIMPORTANT: Back up your private key — it will not be shown again."));
    return;
  }

  if (kind === "safe") {
    const ownersRaw = await input({
      message: "Enter owner addresses (comma-separated):",
      default: "0x1111...aaaa, 0x2222...bbbb, 0x3333...cccc",
    });
    const threshold = await input({
      message: "Threshold (e.g., 2 of 3):",
      default: "2",
    });
    const owners = ownersRaw.split(",").map((s) => s.trim());

    const addTimelock = await confirm({ message: "Add timelock delay?", default: false });
    let delay = "";
    if (addTimelock) {
      delay = await input({ message: "Minimum delay (e.g., \"24h\", \"7d\"):", default: "24h" });
    }

    log("");
    if (addTimelock) {
      log(chalk.gray(`Deploying Safe (${threshold} of ${owners.length}) + Timelock via factory...`));
    } else {
      log(chalk.gray(`Deploying Safe (${threshold} of ${owners.length}) via factory...`));
    }
    await demoDelay(1200);

    const safeAddr = "0x9999aaaa9999aaaa9999aaaa9999aaaa9999aaaa";
    log(`${chalk.green("✓")} Safe deployed:     ${chalk.bold(safeAddr)} (${threshold}/${owners.length})`);

    if (addTimelock) {
      await demoDelay(600);
      const timelockAddr = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
      log(`${chalk.green("✓")} Timelock deployed: ${chalk.bold(timelockAddr)} (${delay} delay, wraps Safe)`);
      setDemoState({ ...getDemoState(), identity: {
        address: timelockAddr,
        type: "timelock",
        label: `Timelock, ${delay} delay`,
        detail: `via ${threshold}/${owners.length} Safe`,
        safeAddress: safeAddr,
        delay,
      }});
      log(`\n${chalk.green("✓")} Logged in as: ${chalk.bold(timelockAddr)} (Timelock, ${delay} delay)`);
    } else {
      setDemoState({ ...getDemoState(), identity: { address: safeAddr, type: "safe", label: `${threshold}/${owners.length} Safe` } });
      log(`\n${chalk.green("✓")} Logged in as: ${chalk.bold(safeAddr)} (${threshold}/${owners.length} Safe)`);
    }
    return;
  }

  // Timelock for existing EOA or Safe
  const proposerKind = await select({
    message: "Is the proposer/executor an EOA or a Safe?",
    choices: [
      { name: "EOA  (single private key)", value: "eoa" },
      { name: "Gnosis Safe  (multi-sig)", value: "safe" },
    ],
  });
  const proposer = await input({
    message: "Proposer/executor address:",
    default: proposerKind === "safe"
      ? "0x9999aaaa9999aaaa9999aaaa9999aaaa9999aaaa"
      : "0x1234567890abcdef1234567890abcdef12345678",
  });
  const delay = await input({
    message: "Minimum delay (e.g., \"24h\", \"7d\"):",
    default: "24h",
  });

  log("");
  log(chalk.gray("Deploying Timelock via factory..."));
  await demoDelay(1000);

  const timelockAddr = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
  const isSafe = proposerKind === "safe";
  setDemoState({ ...getDemoState(), identity: {
    address: timelockAddr,
    type: "timelock",
    label: `Timelock, ${delay} delay`,
    detail: isSafe ? `via Safe` : undefined,
    safeAddress: isSafe ? proposer : undefined,
    delay,
  }});

  log(`${chalk.green("✓")} Timelock deployed: ${chalk.bold(timelockAddr)}`);
  log(`\nMinimum delay:      ${chalk.bold(delay)}`);
  log(`Proposer/Executor:  ${chalk.bold(proposer)}${isSafe ? chalk.gray(" (Safe)") : ""}`);
  log(`\n${chalk.green("✓")} Logged in as: ${chalk.bold(timelockAddr)} (Timelock, ${delay} delay${isSafe ? ", via Safe" : ""})`);
}
