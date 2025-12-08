import { defineConfig } from "tsup";

// Get BUILD_TYPE from environment, default to 'prod'
const buildType = process.env.BUILD_TYPE?.toLowerCase() || "prod";

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
  },
  esbuildOptions(options) {
    options.outbase = "src";
    options.entryNames = "[dir]/[name]";
  },
});
