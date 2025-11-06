export interface CreateClientConfig {
  privateKey: `0x${string}`;
  environment: "sepolia" | "mainnet-alpha";
  rpcUrl?: string;
}
