#!/usr/bin/env node
// Entry point: runs the TypeScript sources directly (Node >= 22.18 strips types).
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`loom needs Node >= 22.18 (found ${process.versions.node})`);
  process.exit(2);
}

const { main } = await import("../src/node/cli.ts");
process.exitCode = await main(process.argv.slice(2));
