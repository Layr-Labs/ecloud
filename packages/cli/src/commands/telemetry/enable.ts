import { Command } from "@oclif/core";
import {
  setGlobalTelemetryPreference,
  getGlobalTelemetryPreference,
} from "../../utils/globalConfig";
import { withTelemetry } from "../../telemetry";

export default class TelemetryEnable extends Command {
  static description = "Enable telemetry collection";

  async run() {
    return withTelemetry(this, async () => {
      const currentPreference = getGlobalTelemetryPreference();
      if (currentPreference === true) {
        this.log("\nTelemetry is already enabled");
        return;
      }

      setGlobalTelemetryPreference(true);
      this.log("\nTelemetry enabled");
    });
  }
}
