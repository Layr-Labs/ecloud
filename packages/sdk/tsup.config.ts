import { defineConfig } from "tsup";

// Get BUILD_TYPE from environment, default to 'prod'
const buildType = process.env.BUILD_TYPE?.toLowerCase() || "prod";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  format: ["esm", "cjs"],
  clean: true,
  sourcemap: true,
  define: {
    BUILD_TYPE_BUILD_TIME: JSON.stringify(buildType),
  },
  loader: {
    ".tmpl": "text",
    ".pem": "text",
  },
});
