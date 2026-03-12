import {
  createECloudClient,
  createViemClients,
  getEnvironmentConfig,
  calculateAppID,
  USDCCreditsABI,
  ERC20ABI,
  type ECloudClient,
  type GasEstimate,
  type PreparedDeploy,
} from "@layr-labs/ecloud-sdk";
import { type Hex, type Address, formatUnits, WalletClient, PublicClient } from "viem";
import { randomBytes } from "crypto";

const ENVIRONMENT = "sepolia-dev";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
const FUND_AMOUNT_USDC = 1;
const CREDIT_POLL_INTERVAL_MS = 5_000;
const CREDIT_POLL_TIMEOUT_MS = 3 * 60 * 1000;

async function predictAppId(
  salt: Uint8Array,
  publicClient: PublicClient,
  environmentConfig: any,
  ownerAddress: Address,
) {
  const appId = await calculateAppID({
    publicClient,
    environmentConfig,
    ownerAddress,
    salt,
  });
  console.log("Predicted app address:", appId);
  return appId;
}

async function prepareDeploy(client: ECloudClient, salt: Uint8Array) {
  console.log("Preparing deploy...");
  const { prepared, gasEstimate } = await client.compute.app.prepareDeploy({
    name: "isolated-test-app",
    imageRef: "cavaneigen/test:latest",
    instanceType: "g1-small-1v",
    logVisibility: "public",
    billTo: "app",
    salt,
  });

  const appId = prepared.data.appId;
  console.log("App ID:", appId);
  console.log("Estimated cost:", gasEstimate.maxCostEth, "ETH");

  return { prepared, gasEstimate, appId };
}

async function fundApp(
  appId: Address,
  walletClient: WalletClient,
  publicClient: PublicClient,
  usdcCreditsAddress: Address,
) {
  const walletAddress = walletClient.account!.address;
  const amountRaw = BigInt(FUND_AMOUNT_USDC * 1e6);

  const usdcBalance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20ABI,
    functionName: "balanceOf",
    args: [walletAddress],
  })) as bigint;

  console.log(`Wallet USDC balance: ${formatUnits(usdcBalance, 6)} USDC`);
  if (usdcBalance < amountRaw) {
    throw new Error(
      `Insufficient USDC. Need ${FUND_AMOUNT_USDC} but have ${formatUnits(usdcBalance, 6)}`
    );
  }

  // Approve if needed
  const currentAllowance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20ABI,
    functionName: "allowance",
    args: [walletAddress, usdcCreditsAddress],
  })) as bigint;

  if (currentAllowance < amountRaw) {
    console.log("Approving USDC spend...");
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20ABI,
      functionName: "approve",
      args: [usdcCreditsAddress, amountRaw],
      chain: walletClient.chain,
      account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log("Approved");
  }

  // Purchase credits for the app
  console.log(`Funding app ${appId} with ${FUND_AMOUNT_USDC} USDC...`);
  const purchaseTx = await walletClient.writeContract({
    address: usdcCreditsAddress,
    abi: USDCCreditsABI,
    functionName: "purchaseCreditsFor",
    args: [amountRaw, appId],
    chain: walletClient.chain,
    account: walletClient.account!,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTx });
  console.log("Credits purchased, tx:", receipt.transactionHash);
}

async function waitForCredits(
  appId: Address,
  publicClient: PublicClient,
  appControllerAddress: Address,
) {
  console.log("Waiting for app quota to appear on-chain...");
  const start = Date.now();
  while (Date.now() - start < CREDIT_POLL_TIMEOUT_MS) {
    try {
      const quota = await publicClient.readContract({
        address: appControllerAddress,
        abi: [{ type: "function", name: "getMaxActiveAppsPerUser", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" }],
        functionName: "getMaxActiveAppsPerUser",
        args: [appId],
      });
      if (Number(quota) > 0) {
        console.log(`Quota confirmed: ${Number(quota)}`);
        return;
      }
    } catch {
      // May not be indexed yet
    }
    console.log("  Polling...");
    await new Promise((r) => setTimeout(r, CREDIT_POLL_INTERVAL_MS));
  }
  console.log("Warning: timed out waiting for quota, proceeding anyway");
}

async function deploy(
  client: ECloudClient,
  prepared: PreparedDeploy,
  gasEstimate: GasEstimate,
) {
  console.log("Executing deploy...");
  const result = await client.compute.app.executeDeploy(prepared, gasEstimate);
  console.log("Deploy tx:", result.txHash);
  console.log("App ID:", result.appId);

  console.log("Watching deployment...");
  const ipAddress = await client.compute.app.watchDeployment(result.appId);
  console.log("App is running at:", ipAddress);
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY as Hex;
  if (!privateKey) {
    console.error("PRIVATE_KEY env var is required");
    process.exit(1);
  }

  const client = createECloudClient({
    verbose: true,
    privateKey,
    environment: ENVIRONMENT,
  });

  const environmentConfig = getEnvironmentConfig(ENVIRONMENT);
  const { walletClient, publicClient } = createViemClients({
    privateKey,
    rpcUrl: environmentConfig.defaultRPCURL,
    chainId: environmentConfig.chainID,
  });

  const usdcCreditsAddress = environmentConfig.usdcCreditsAddress;
  if (!usdcCreditsAddress) {
    throw new Error("USDCCredits contract not configured for this environment");
  }

  const ownerAddress = walletClient.account!.address;

  // Generate salt once — used for both prediction and deploy
  const salt = randomBytes(32);

  // 1. Predict app address
  const appId = await predictAppId(salt, publicClient as PublicClient, environmentConfig, ownerAddress);

  // 2. Fund the app with USDC credits
  await fundApp(appId, walletClient as WalletClient, publicClient as PublicClient, usdcCreditsAddress);

  // 3. Wait for credits to land
  await waitForCredits(appId, publicClient as PublicClient, environmentConfig.appControllerAddress as Address);

  // 4. Prepare deploy (using same salt so app ID matches)
  const { prepared, gasEstimate } = await prepareDeploy(client, salt);

  // 5. Deploy
  await deploy(client, prepared, gasEstimate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
