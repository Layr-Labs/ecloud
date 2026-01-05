import { Command } from "@oclif/core";
import {
  setGlobalTelemetryPreference,
  getGlobalTelemetryPreference,
} from "../../utils/globalConfig";
import { withTelemetry } from "../../telemetry";

export default class TelemetryDisable extends Command {
  static description = "Disable telemetry collection";

  async run() {
    return withTelemetry(this, async () => {
      const currentPreference = getGlobalTelemetryPreference();
      if (currentPreference === false) {
        this.log("\nTelemetry is already disabled");
        return;
      }

      setGlobalTelemetryPreference(false);
      this.log("\nTelemetry disabled");
    });
  }
}
