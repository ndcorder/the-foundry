#!/usr/bin/env node

import { loadConfig } from "./context/config.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  console.log(`The Foundry v${config.foundry.version} — Phase 0 scaffold`);
  console.log("Iteration loop not yet implemented (Phase 1).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
