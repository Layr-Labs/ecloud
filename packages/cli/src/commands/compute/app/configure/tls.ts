import { Command } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { getCaddyfileTemplate, ENV_EXAMPLE_TLS } from "../../../../templates/tls/templates.js";

export default class ConfigureTLS extends Command {
  static description = "Configure TLS for your application";

  static summary = `Adds TLS configuration to your EigenCloud application.

This command creates:
- Caddyfile: Reverse proxy configuration for automatic HTTPS
- .env.example.tls: Example environment variables for TLS

TLS certificates are automatically obtained via Let's Encrypt using the tls-keygen tool.`;

  async run() {
    const cwd = process.cwd();

    // Write Caddyfile
    const caddyfilePath = path.join(cwd, "Caddyfile");
    if (fs.existsSync(caddyfilePath)) {
      this.warn("Caddyfile already exists. Skipping...");
    } else {
      const caddyfileContent = getCaddyfileTemplate();
      fs.writeFileSync(caddyfilePath, caddyfileContent, { mode: 0o644 });
      this.log("Created Caddyfile");
    }

    // Write .env.example.tls
    const envTLSPath = path.join(cwd, ".env.example.tls");
    if (fs.existsSync(envTLSPath)) {
      this.warn(".env.example.tls already exists. Skipping...");
    } else {
      fs.writeFileSync(envTLSPath, ENV_EXAMPLE_TLS, { mode: 0o644 });
      this.log("Created .env.example.tls");
    }

    // Print success message and instructions
    this.log("");
    this.log(chalk.green("TLS configuration added successfully"));
    this.log("");
    this.log("Created:");
    this.log("  - Caddyfile");
    this.log("  - .env.example.tls");
    this.log("");

    this.log("To enable TLS:");
    this.log("");
    this.log("1. Add TLS variables to .env:");
    this.log("   cat .env.example.tls >> .env");
    this.log("");

    this.log("2. Configure required variables:");
    this.log("   DOMAIN=yourdomain.com");
    this.log("");
    this.log("   For first deployment (recommended):");
    this.log("   ENABLE_CADDY_LOGS=true");
    this.log("   ACME_STAGING=true");
    this.log("");

    this.log("3. Set up DNS A record pointing to instance IP");
    this.log("   Run 'ecloud compute app list' to get IP address");
    this.log("");

    this.log("4. Upgrade:");
    this.log("   ecloud compute app upgrade");
    this.log("");

    this.log("Note: Let's Encrypt rate limit is 5 certificates/week per domain");
    this.log("      To switch staging -> production: set ACME_STAGING=false");
    this.log("      If cert exists, use ACME_FORCE_ISSUE=true once to replace");
  }
}
