import { Command, Flags } from "@oclif/core";
import {
  setGlobalTelemetryPreference,
  getGlobalTelemetryPreference,
} from "../utils/globalConfig";
import { withTelemetry } from "../telemetry";

export default class Telemetry extends Command {
  static description = "Manage telemetry settings";

  static flags = {
    enable: Flags.boolean({
      description: "Enable telemetry collection",
    }),
    disable: Flags.boolean({
      description: "Disable telemetry collection",
    }),
    status: Flags.boolean({
      description: "Show current telemetry status",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(Telemetry);

      const enable = flags.enable;
      const disable = flags.disable;
      const status = flags.status;

      // Validate flags - exactly one must be specified
      if ((enable && disable) || (!enable && !disable && !status)) {
        throw new Error("specify exactly one of --enable, --disable, or --status");
      }

      if (status) {
        return this.showTelemetryStatus();
      }

      if (enable) {
        return this.enableTelemetry();
      }

      if (disable) {
        return this.disableTelemetry();
      }

      return undefined;
    });
  }

  private showTelemetryStatus(): void {
    const globalPreference = getGlobalTelemetryPreference();

    if (globalPreference === undefined) {
      this.log("Telemetry: Not set (defaults to disabled)");
    } else if (globalPreference) {
      this.log("Telemetry: Enabled");
    } else {
      this.log("Telemetry: Disabled");
    }
  }

  private enableTelemetry(): void {
    const currentPreference = getGlobalTelemetryPreference();

    if (currentPreference === true) {
      this.log("\n✅ Telemetry is already enabled");
      return;
    }

    setGlobalTelemetryPreference(true);
    this.log("\n✅ Telemetry enabled");
  }

  private disableTelemetry(): void {
    const currentPreference = getGlobalTelemetryPreference();

    if (currentPreference === false) {
      this.log("\n✅ Telemetry is already disabled");
      return;
    }

    setGlobalTelemetryPreference(false);
    this.log("\n❌ Telemetry disabled");
  }
}

