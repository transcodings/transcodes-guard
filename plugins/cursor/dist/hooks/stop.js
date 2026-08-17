#!/usr/bin/env node
import "../chunk-YH2RJ2XK.js";

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
