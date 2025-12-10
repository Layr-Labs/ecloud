import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Get BUILD_TYPE from environment, default to 'prod'
const buildType = process.env.BUILD_TYPE?.toLowerCase() || "prod";

// Get version: prefer PACKAGE_VERSION env var (set by CI from git tag), fallback to package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const sdkVersion = process.env.PACKAGE_VERSION || packageJson.version || "0.0.0";

// Get PostHog API key from environment (for build-time injection)
const posthogApiKey = process.env.POSTHOG_API_KEY_BUILD_TIME;

export default defineConfig({
  entry: ["src/index.ts", "src/compute.ts", "src/billing.ts"],
  dts: true,
  format: ["esm", "cjs"],
  clean: true,
  sourcemap: true,
  define: {
    BUILD_TYPE_BUILD_TIME: JSON.stringify(buildType),
    SDK_VERSION_BUILD_TIME: JSON.stringify(sdkVersion),
    ...(posthogApiKey ? { POSTHOG_API_KEY_BUILD_TIME: JSON.stringify(posthogApiKey) } : {}),
  },
  loader: {
    ".tmpl": "text",
    ".pem": "text",
  },
});
