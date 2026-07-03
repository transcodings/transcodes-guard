#!/usr/bin/env node
import {
  getGateBackend
} from "../chunk-7BO7MLBP.js";

// hooks/stop.ts
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  getGateBackend().sweepLatches();
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}
`);
  process.exit(0);
});
