import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient } from "@layr-labs/ecloud-sdk";
import { commonFlags } from "../../../../flags";
import {
  getOrPromptAppID,
  getAppProfileInteractive,
  getPrivateKeyInteractive,
  validateAppProfile,
} from "../../../../utils/prompts";
import { createAppResolver } from "../../../../utils/appResolver";
import { invalidateProfileCache } from "../../../../utils/globalConfig";
import { getClientId } from "../../../../utils/version";
import chalk from "chalk";
import { withTelemetry } from "../../../../telemetry";

export default class ProfileSet extends Command {
  static description = "Set public profile information for an app";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to set profile for",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    name: Flags.string({
      description: "Profile name for the app",
      required: false,
    }),
    website: Flags.string({
      description: "Website URL",
      required: false,
    }),
    description: Flags.string({
      description: "App description",
      required: false,
    }),
    "x-url": Flags.string({
      description: "X (Twitter) URL",
      required: false,
    }),
    image: Flags.string({
      description: "Path to profile image (JPG/PNG, max 4MB)",
      required: false,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(ProfileSet);

      // Get environment config
      const environment = flags.environment || "sepolia";
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

      // Get private key interactively if not provided
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      // Create app resolver for name resolution
      const resolver = createAppResolver(environment, environmentConfig, privateKey, rpcUrl);

      // Get app ID (resolve name if needed)
      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "set profile for",
      });

      this.log(`\nSetting profile for app: ${chalk.cyan(appId)}`);

      // Collect profile fields
      // If flags provided, use them; otherwise prompt interactively
      let profile;
      if (flags.name) {
        // Non-interactive mode - use flags
        profile = {
          name: flags.name,
          website: flags.website,
          description: flags.description,
          xURL: flags["x-url"],
          imagePath: flags.image,
        };

        // Validate profile fields
        const validationError = validateAppProfile(profile);
        if (validationError) {
          this.error(validationError);
        }

        // Show profile summary
        this.log("\n📋 Profile Summary:");
        this.log(`  Name:        ${profile.name}`);
        if (profile.website) this.log(`  Website:     ${profile.website}`);
        if (profile.description) this.log(`  Description: ${profile.description}`);
        if (profile.xURL) this.log(`  X URL:       ${profile.xURL}`);
        if (profile.imagePath) this.log(`  Image:       ${profile.imagePath}`);
      } else {
        // Interactive mode - prompt for all fields
        this.log("\nEnter profile information:");
        profile = await getAppProfileInteractive("", true);

        if (!profile) {
          this.log(`\n${chalk.gray("Profile setup cancelled")}`);
          return;
        }
      }

      // Upload profile via API
      this.log("\nUploading app profile...");

      const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl);

      try {
        const response = await userApiClient.uploadAppProfile(
          appId,
          profile.name,
          profile.website,
          profile.description,
          profile.xURL,
          profile.imagePath,
        );

        // Update profile cache with new name
        resolver.updateCacheEntry(appId, response.name);

        // Also invalidate full cache to ensure fresh data
        invalidateProfileCache(environment);

        // Display success message with returned data
        this.log(`\n✅ ${chalk.green(`Profile updated successfully for app '${response.name}'`)}`);

        // Show uploaded profile data
        this.log("\nUploaded Profile:");
        this.log(`  Name:        ${response.name}`);
        if (response.website) this.log(`  Website:     ${response.website}`);
        if (response.description) this.log(`  Description: ${response.description}`);
        if (response.xURL) this.log(`  X URL:       ${response.xURL}`);
        if (response.imageURL) this.log(`  Image URL:   ${response.imageURL}`);
      } catch (error: any) {
        this.error(`Failed to upload profile: ${error.message}`);
      }
    });
  }
}
