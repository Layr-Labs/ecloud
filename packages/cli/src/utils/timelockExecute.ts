import {
  getPendingTimelockOps,
  executeTimelockOp,
  proposeSafeTransaction,
  getEnvironmentConfig,
} from "@layr-labs/ecloud-sdk";
import { encodeFunctionData } from "viem";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { createViemClients } from "./viemClients";
import { getActiveIdentityOrEOA } from "./identityTransaction";
import { TIMELOCK_ABI } from "./contractAbis";
import { formatCountdown } from "./format";
import chalk from "chalk";

export interface TimelockExecuteOptions {
  opId: string;
  environment: string;
  privateKey: string;
  rpcUrl: string;
  log: (msg: string) => void;
  error: (msg: string) => never;
}

export async function handleTimelockExecute(options: TimelockExecuteOptions): Promise<void> {
  const { opId, environment, privateKey, rpcUrl, log, error } = options;
  const environmentConfig = getEnvironmentConfig(environment);
  const { publicClient, walletClient, address } = createViemClients({ privateKey, rpcUrl, environment });
  const identity = getActiveIdentityOrEOA(environment, address);

  if (identity.type !== "timelock") {
    error("--execute requires a Timelock identity to be active. Run 'ecloud auth identity select'.");
  }

  const timelockAddress = identity.address as Address;
  const ops = await getPendingTimelockOps(publicClient, timelockAddress);
  const op = ops.find((o) => o.id.toLowerCase() === opId.toLowerCase());

  if (!op) {
    error(`No pending operation found with ID ${opId} on Timelock ${timelockAddress}`);
  }
  if (!op.ready) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const remaining = op.executableAt - now;
    error(`Operation is not yet ready. Executable in ${formatCountdown(remaining)}.`);
  }

  log(chalk.gray(`Executing Timelock op: ${op.description}`));
  log(chalk.gray(`Timelock: ${timelockAddress}`));
  log("");

  const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
  const executeData = encodeFunctionData({
    abi: TIMELOCK_ABI,
    functionName: "execute",
    args: [
      environmentConfig.appControllerAddress as Address,
      0n,
      op.calldata,
      ZERO_BYTES32,
      ZERO_BYTES32,
    ],
  });

  if (identity.safeAddress) {
    const proposal = await proposeSafeTransaction({
      walletClient,
      publicClient,
      safeAddress: identity.safeAddress as Address,
      to: timelockAddress,
      data: executeData,
      environment,
    });
    log(`✓ Proposed execute to Safe ${identity.safeAddress}`);
    log(`  Safe tx hash: ${proposal.safeTxHash}`);
    log(`\n  Approve at: ${proposal.safeUrl}`);
  } else {
    const txHash = await executeTimelockOp(
      { walletClient, publicClient, environmentConfig, timelockAddress, calldata: op.calldata },
    );
    log(`\n✅ ${chalk.green(`Timelock operation executed`)}  tx: ${txHash}`);
  }
}

export async function handleTimelockCancel(options: TimelockExecuteOptions): Promise<void> {
  const { opId, environment, privateKey, rpcUrl, log, error } = options;
  const environmentConfig = getEnvironmentConfig(environment);
  const { publicClient, walletClient, address } = createViemClients({ privateKey, rpcUrl, environment });
  const identity = getActiveIdentityOrEOA(environment, address);

  if (identity.type !== "timelock") {
    error("--cancel requires a Timelock identity to be active. Run 'ecloud auth identity select'.");
  }

  const timelockAddress = identity.address as Address;
  const ops = await getPendingTimelockOps(publicClient, timelockAddress);
  const op = ops.find((o) => o.id.toLowerCase() === opId.toLowerCase());

  if (!op) {
    error(`No pending operation found with ID ${opId} on Timelock ${timelockAddress}`);
  }

  log(chalk.gray(`Cancelling Timelock op: ${op.description}`));
  log(chalk.gray(`Timelock: ${timelockAddress}`));
  log("");

  const cancelData = encodeFunctionData({
    abi: TIMELOCK_ABI,
    functionName: "cancel",
    args: [opId as Hex],
  });

  if (identity.safeAddress) {
    const proposal = await proposeSafeTransaction({
      walletClient,
      publicClient,
      safeAddress: identity.safeAddress as Address,
      to: timelockAddress,
      data: cancelData,
      environment,
    });
    log(`✓ Proposed cancel to Safe ${identity.safeAddress}`);
    log(`  Safe tx hash: ${proposal.safeTxHash}`);
    log(`\n  Approve at: ${proposal.safeUrl}`);
  } else {
    const txHash = await walletClient.sendTransaction({
      to: timelockAddress,
      data: cancelData,
      chain: walletClient.chain,
      account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    log(`\n✅ ${chalk.green(`Timelock operation cancelled`)}  tx: ${txHash}`);
  }
}
