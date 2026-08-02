#!/usr/bin/env node
import "../chunk-25Z2NLFB.js";

// hooks/stop.ts
async function main() {
  try {
    for await (const _chunk of process.stdin) {
    }
  } catch {
  }
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard stop hook error: ${err}
`);
  process.exit(0);
});
