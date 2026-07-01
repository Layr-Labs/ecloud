import type { WalletClient, PublicClient, Address } from "viem";
import { BillingApiClient } from "../../common/utils/billingapi";
import { getBillingEnvironmentConfig, getBuildType } from "../../common/config/environment";
import type {
  CreateCouponResponse,
  ListCouponsResponse,
  GetCouponResponse,
  AddAdminResponse,
  ListAdminsResponse,
} from "../../common/types";

export interface AdminModule {
  address: Address;
  createCoupon: (amountCents: number) => Promise<CreateCouponResponse>;
  listCoupons: (opts?: { offset?: number; limit?: number; active?: boolean; redeemed?: boolean }) => Promise<ListCouponsResponse>;
  getCoupon: (id: string) => Promise<GetCouponResponse>;
  deactivateCoupon: (id: string) => Promise<void>;
  redeemCouponForUser: (id: string, address: string) => Promise<void>;
  addAdmin: (address: string) => Promise<AddAdminResponse>;
  removeAdmin: (address: string) => Promise<void>;
  listAdmins: () => Promise<ListAdminsResponse>;
}

export interface AdminModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  publicClient: PublicClient;
  environment: string;
}

export function createAdminModule(config: AdminModuleConfig): AdminModule {
  const { verbose = false, walletClient } = config;

  if (!walletClient.account) {
    throw new Error("WalletClient must have an account attached");
  }
  const address = walletClient.account.address as Address;

  const billingEnvConfig = getBillingEnvironmentConfig(getBuildType());
  const billingApi = new BillingApiClient(billingEnvConfig, walletClient, { verbose });

  return {
    address,

    async createCoupon(amountCents: number) {
      return billingApi.createCoupon(amountCents);
    },

    async listCoupons(opts?) {
      return billingApi.listCoupons(opts);
    },

    async getCoupon(id: string) {
      return billingApi.getCoupon(id);
    },

    async deactivateCoupon(id: string) {
      return billingApi.deactivateCoupon(id);
    },

    async redeemCouponForUser(id: string, userAddress: string) {
      return billingApi.redeemCouponForUser(id, userAddress);
    },

    async addAdmin(adminAddress: string) {
      return billingApi.addAdmin(adminAddress);
    },

    async removeAdmin(adminAddress: string) {
      return billingApi.removeAdmin(adminAddress);
    },

    async listAdmins() {
      return billingApi.listAdmins();
    },
  };
}
