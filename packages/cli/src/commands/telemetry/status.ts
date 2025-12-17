import { Command } from "@oclif/core";
import { getGlobalTelemetryPreference } from "../../utils/globalConfig";
import { withTelemetry } from "../../telemetry";

export default class TelemetryStatus extends Command {
  static description = "Show current telemetry status";

  async run() {
    return withTelemetry(this, async () => {
      const globalPreference = getGlobalTelemetryPreference();
      if (globalPreference === undefined) {
        this.log("Telemetry: Enabled (default)");
      } else if (globalPreference) {
        this.log("Telemetry: Enabled");
      } else {
        this.log("Telemetry: Disabled");
      }
    });
  }
}
