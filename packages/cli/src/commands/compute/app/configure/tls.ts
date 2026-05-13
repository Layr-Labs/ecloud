import { Command, Flags } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { input, confirm } from "@inquirer/prompts";
import {
  getCaddyfileTemplate,
  getTlsEnvBlock,
  TLS_ENV_EXAMPLE_BLOCK,
} from "../../../../templates/tls/templates.js";

function envFileHasTlsConfig(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return /^DOMAIN=/m.test(content);
}

function validateDomain(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) return "Domain is required";
  if (trimmed.toLowerCase() === "localhost") return "Domain cannot be localhost";
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/.test(trimmed))
    return "Enter a valid domain (e.g. myapp.example.com)";
  return true;
}

function validatePort(value: string): true | string {
  const num = Number(value.trim());
  if (!Number.isInteger(num) || num < 1 || num > 65535) return "Enter a valid port (1-65535)";
  return true;
}

export default class ConfigureTLS extends Command {
  static description = "Configure a custom domain for your app (optional)";

  static summary = `Configures a custom domain for your EigenCloud application.

By default, every deployed app is reachable at its platform-derived
hostname (<app-address>.<env-name>.eigencloud.xyz) with TLS already
set up. You only need this command if you also want the app reachable
at a custom domain you control.

Running this command:
- Creates a Caddyfile serving both the platform hostname and your
  custom domain
- Appends DOMAIN + Caddy settings to .env
- Appends TLS placeholders to .env.example

After running this, set a DNS A record for your custom domain
pointing at the platform's proxy IP, then deploy/upgrade. Certs for
both hostnames are obtained via Let's Encrypt at VM boot.`;

  static examples = [
    "<%= config.bin %> compute app configure tls --domain myapp.example.com",
    "<%= config.bin %> compute app configure tls --domain myapp.example.com --app-port 8080",
    "<%= config.bin %> compute app configure tls --domain myapp.example.com --no-acme-staging",
  ];

  static flags = {
    domain: Flags.string({
      description: "Custom domain name for TLS certificate (additive to the platform hostname)",
    }),
    "app-port": Flags.string({
      description: "Port your application listens on",
      default: "3000",
    }),
    "acme-staging": Flags.boolean({
      description: "Use Let's Encrypt staging environment",
      default: true,
      allowNo: true,
    }),
    "caddy-logs": Flags.boolean({
      description: "Enable Caddy debug logs",
      default: false,
      allowNo: true,
    }),
  };

  async run() {
    const { flags } = await this.parse(ConfigureTLS);
    const cwd = process.cwd();

    const envPath = path.join(cwd, ".env");
    if (envFileHasTlsConfig(envPath)) {
      this.warn("Custom domain is already configured in .env (DOMAIN is set). Skipping.");
      return;
    }

    // Write Caddyfile. The same template also serves the platform
    // hostname so the file is safe to drop in even if the user
    // later removes the DOMAIN line from .env.
    const caddyfilePath = path.join(cwd, "Caddyfile");
    if (fs.existsSync(caddyfilePath)) {
      this.log("Caddyfile already exists, keeping existing file.");
    } else {
      const caddyfileContent = getCaddyfileTemplate();
      fs.writeFileSync(caddyfilePath, caddyfileContent, { mode: 0o644 });
      this.log("Created Caddyfile");
    }

    this.log("");

    // Resolve values: use flags if provided, otherwise prompt
    let domain = flags.domain;
    if (!domain) {
      domain = await input({
        message: "Custom domain name:",
        validate: validateDomain,
      });
    } else {
      const result = validateDomain(domain);
      if (result !== true) this.error(result);
    }

    const appPort = flags["app-port"];
    const portResult = validatePort(appPort);
    if (portResult !== true) this.error(portResult);

    const acmeStaging =
      flags["acme-staging"] !== undefined
        ? flags["acme-staging"]
        : await confirm({
            message:
              "Use Let's Encrypt staging? (recommended for first deploy to avoid rate limits)",
            default: true,
          });

    const enableCaddyLogs =
      flags["caddy-logs"] !== undefined
        ? flags["caddy-logs"]
        : await confirm({
            message: "Enable Caddy debug logs?",
            default: false,
          });

    // Show summary
    this.log("");
    this.log(chalk.bold("Custom domain configuration:"));
    this.log(`  Custom domain:   ${domain.trim()}`);
    this.log(`  App port:        ${appPort.trim()}`);
    this.log(`  ACME staging:    ${acmeStaging}`);
    this.log(`  Caddy logs:      ${enableCaddyLogs}`);
    this.log("");
    this.log(
      chalk.gray(
        "Note: your app will also be reachable at its platform-derived hostname (<app-address>.<env>.eigencloud.xyz) with its own cert.",
      ),
    );
    this.log("");

    // Only ask for confirmation in interactive mode (no --domain flag)
    if (!flags.domain) {
      const confirmed = await confirm({
        message: "Write these settings to .env?",
        default: true,
      });

      if (!confirmed) {
        this.log("Cancelled.");
        return;
      }
    }

    const vars = {
      domain: domain.trim(),
      appPort: appPort.trim(),
      acmeStaging,
      enableCaddyLogs,
    };

    // Append to .env
    const envBlock = getTlsEnvBlock(vars);
    fs.appendFileSync(envPath, envBlock, { mode: 0o644 });
    this.log(`Updated .env`);

    // Append to .env.example (with placeholders, skip if already has DOMAIN)
    const envExamplePath = path.join(cwd, ".env.example");
    if (!envFileHasTlsConfig(envExamplePath)) {
      fs.appendFileSync(envExamplePath, TLS_ENV_EXAMPLE_BLOCK, { mode: 0o644 });
      this.log(`Updated .env.example`);
    }

    // Print next steps
    this.log("");
    this.log(chalk.green("Custom domain configured successfully"));
    this.log("");
    this.log("Next steps:");
    this.log("");
    this.log(`1. Set up a DNS A record for ${domain.trim()} pointing at the platform proxy IP`);
    this.log("   Run 'ecloud compute app list' to confirm the IP once the app is running");
    this.log("");
    this.log("2. Deploy or upgrade:");
    this.log("   ecloud compute app deploy    # new app");
    this.log("   ecloud compute app upgrade   # existing app");
    this.log("");

    if (acmeStaging) {
      this.log(chalk.yellow("Note: ACME_STAGING is enabled (recommended for first deploy)"));
      this.log("Once verified, switch to production certs:");
      this.log("  1. Set ACME_STAGING=false in .env");
      this.log("  2. Set ACME_FORCE_ISSUE=true in .env (one-time)");
      this.log("  3. Run: ecloud compute app upgrade");
      this.log("");
    }

    this.log("Let's Encrypt rate limit: 5 certificates/week per domain");
  }
}
