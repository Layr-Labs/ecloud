#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

const MIN_NODE_MAJOR = 18;
const currentVersion = process.versions.node;
const currentMajor = parseInt(currentVersion.split(".")[0], 10);

if (currentMajor < MIN_NODE_MAJOR) {
  console.error(
    `\nError: ecloud requires Node.js v${MIN_NODE_MAJOR} or later, but you are running v${currentVersion}.\n` +
      `Please upgrade Node.js: https://nodejs.org/\n`,
  );
  process.exit(1);
}

const { execute } = await import("@oclif/core");

await execute({ development: true, dir: import.meta.url });
