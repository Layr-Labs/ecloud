import { Command, Flags } from "@oclif/core";
import { createApp } from "@layr-labs/ecloud-sdk";
import {
  promptProjectName,
  promptLanguage,
  selectTemplateInteractive,
} from "../../../utils/prompts";
import { withTelemetry } from "../../../telemetry";

export default class AppCreate extends Command {
  static description = "Create a new app from a template";

  static flags = {
    name: Flags.string({
      description: "Project name",
    }),
    language: Flags.string({
      description: "Programming language (typescript, golang, rust, python)",
      options: ["typescript", "golang", "rust", "python"],
    }),
    "template-repo": Flags.string({
      description: "Template name or custom template URL",
    }),
    "template-version": Flags.string({
      description: "Template version/ref",
    }),
    verbose: Flags.boolean({
      description: "Verbose output",
      default: false,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AppCreate);

      const logger = {
        info: (msg: string, ...args: any[]) => console.log(msg, ...args),
        warn: (msg: string, ...args: any[]) => console.warn(msg, ...args),
        error: (msg: string, ...args: any[]) => console.error(msg, ...args),
        debug: (msg: string, ...args: any[]) => flags.verbose && console.debug(msg, ...args),
      };

      // 1. Get project name interactively if not provided
      const name = flags.name || (await promptProjectName());

      // 2. Get language interactively if not provided
      const language = flags.language || (await promptLanguage());

      // 3. Get template interactively if not provided
      const template = flags["template-repo"] || (await selectTemplateInteractive(language));

      // 4. Call SDK with all gathered parameters
      return createApp(
        {
          name,
          language,
          template: template || undefined,
          templateVersion: flags["template-version"],
          verbose: flags.verbose,
        },
        logger,
      );
    });
  }
}
