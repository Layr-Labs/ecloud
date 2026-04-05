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
  static description = "Configure TLS for your application";

  static summary = `Configures TLS for your EigenCloud application.

Prompts for domain and TLS settings (or accepts them via flags), then:
- Creates a Caddyfile for automatic HTTPS via Caddy reverse proxy
- Appends TLS variables to .env with your values
- Appends TLS placeholders to .env.example

TLS certificates are automatically obtained via Let's Encrypt using the tls-keygen tool.`;

  static examples = [
    "<%= config.bin %> compute app configure tls",
    "<%= config.bin %> compute app configure tls --domain myapp.example.com",
    "<%= config.bin %> compute app configure tls --domain myapp.example.com --app-port 8080",
    "<%= config.bin %> compute app configure tls --domain myapp.example.com --no-acme-staging",
  ];

  static flags = {
    domain: Flags.string({
      description: "Domain name for TLS certificate",
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

    // Check if TLS is already configured in .env
    const envPath = path.join(cwd, ".env");
    if (envFileHasTlsConfig(envPath)) {
      this.warn("TLS is already configured in .env (DOMAIN is set). Skipping.");
      return;
    }

    // Write Caddyfile
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
        message: "Domain name:",
        validate: validateDomain,
      });
    } else {
      const result = validateDomain(domain);
      if (result !== true) this.error(result);
    }

    let appPort = flags["app-port"];
    // Only prompt if the user didn't pass --app-port at all (default is "3000")
    // Since oclif always provides the default, we use the default directly
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
    this.log(chalk.bold("TLS Configuration:"));
    this.log(`  Domain:          ${domain.trim()}`);
    this.log(`  App port:        ${appPort.trim()}`);
    this.log(`  ACME staging:    ${acmeStaging}`);
    this.log(`  Caddy logs:      ${enableCaddyLogs}`);
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
    this.log(chalk.green("TLS configured successfully"));
    this.log("");
    this.log("Next steps:");
    this.log("");
    this.log("1. Set up DNS A record pointing to your instance IP");
    this.log("   Run 'ecloud compute app list' to get IP address");
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
