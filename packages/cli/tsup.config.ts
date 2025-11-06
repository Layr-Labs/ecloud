import { defineConfig } from "tsup";

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
  esbuildOptions(options) {
    options.outbase = "src";
    options.entryNames = "[dir]/[name]";
  },
});
