import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Get BUILD_TYPE from environment, default to 'prod'
const buildType = process.env.BUILD_TYPE?.toLowerCase() || "prod";

// Get version: prefer PACKAGE_VERSION env var (set by CI from git tag), fallback to package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const cliVersion = process.env.PACKAGE_VERSION || packageJson.version || "0.0.0";

// Get PostHog API key from environment (for build-time injection)
const posthogApiKey = process.env.POSTHOG_API_KEY_BUILD_TIME;

export default defineConfig({
  entry: ["src/commands/**/*.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  splitting: false,
  clean: true,
  sourcemap: true,
  skipNodeModulesBundle: true,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    BUILD_TYPE_BUILD_TIME: JSON.stringify(buildType),
    CLI_VERSION_BUILD_TIME: JSON.stringify(cliVersion),
    ...(posthogApiKey ? { POSTHOG_API_KEY_BUILD_TIME: JSON.stringify(posthogApiKey) } : {}),
  },
  loader: {
    ".tmpl": "text",
  },
  esbuildOptions(options) {
    options.outbase = "src";
    options.entryNames = "[dir]/[name]";
  },
});
