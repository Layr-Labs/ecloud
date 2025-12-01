import { defineConfig } from "tsup";

// Get BUILD_TYPE from environment, default to 'prod'
const buildType = process.env.BUILD_TYPE?.toLowerCase() || "prod";
// Determine SDK package name based on build type for import rewriting
const sdkPackageName = buildType === "dev" 
  ? "@layr-labs/ecloud-sdk-dev" 
  : "@layr-labs/ecloud-sdk";

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
    "BUILD_TYPE_BUILD_TIME": JSON.stringify(buildType),
  },
  esbuildOptions(options) {
    options.outbase = "src";
    options.entryNames = "[dir]/[name]";
    // Rewrite @layr-labs/ecloud-sdk imports to the correct package name based on build type
    // This ensures dev builds import from @layr-labs/ecloud-sdk-dev and prod from @layr-labs/ecloud-sdk
    options.alias = {
      "@layr-labs/ecloud-sdk": sdkPackageName,
    };
  },
});
