#!/usr/bin/env node

import path from "node:path";

const command = process.argv[2];

async function run(): Promise<void> {
  switch (command) {
    case "start": {
      const { startFoundry } = await import("./index.js");
      await startFoundry();
      break;
    }

    case "stop": {
      const { stopFoundry } = await import("./index.js");
      await stopFoundry();
      console.log("STOP file created. The Foundry will halt after the current iteration.");
      break;
    }

    case "status": {
      const { getStatus } = await import("./index.js");
      const s = await getStatus();
      console.log(`The Foundry — ${s.running ? "running" : "stopped"}`);
      console.log(`  Iteration:  ${s.iteration}`);
      console.log(`  Shipped:    ${s.shipped}`);
      console.log(`  Killed:     ${s.killed}`);
      console.log(`  Skipped:    ${s.skipped}`);
      if (s.lastArtifact) console.log(`  Last ship:  ${s.lastArtifact}`);
      if (s.savedAt) console.log(`  Checkpoint: ${s.savedAt}`);
      if (s.recentOutcomes.length > 0) {
        console.log(`\n  Recent:`);
        for (const o of s.recentOutcomes.slice(-5)) {
          console.log(`    #${o.iteration} ${o.outcome}${o.domain ? " (" + o.domain + ")" : ""}`);
        }
      }
      break;
    }

    case "dashboard": {
      const { resolve: foundryResolve } = await import("./root.js");
      const serverPath = foundryResolve("dashboard", "server.ts");
      const { execSync } = await import("node:child_process");
      execSync(`npx tsx ${serverPath}`, { stdio: "inherit" });
      break;
    }

    default:
      console.log(`Usage: foundry <command>\n`);
      console.log(`Commands:`);
      console.log(`  start       Run the iteration loop`);
      console.log(`  stop        Create STOP file to halt after current iteration`);
      console.log(`  status      Show current state (iteration, stats, checkpoint)`);
      console.log(`  dashboard   Start the dashboard server`);
      process.exit(command ? 1 : 0);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
