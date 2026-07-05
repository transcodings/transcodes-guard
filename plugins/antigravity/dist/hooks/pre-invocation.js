#!/usr/bin/env node
import {
  antigravityAdapter
} from "../chunk-HBLMEC7F.js";
import {
  formatNoTokenSessionNotice,
  formatStepupProtocolPrimer,
  getGateBackend
} from "../chunk-ZFSHR6SZ.js";

// hooks/pre-invocation.ts
import { readFileSync } from "fs";
function primerMessage() {
  return formatStepupProtocolPrimer();
}
async function main() {
  if (!antigravityAdapter.parsePreInvocationStdin || !antigravityAdapter.emitPreInvocation) {
    process.exit(0);
  }
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = antigravityAdapter.parsePreInvocationStdin(raw);
  } catch {
    process.exit(0);
  }
  const backend = getGateBackend();
  const injectSteps = [];
  if (input.invocationNum <= 1) {
    injectSteps.push({ ephemeralMessage: primerMessage() });
    if (!backend.hasToken()) {
      injectSteps.push({ ephemeralMessage: formatNoTokenSessionNotice() });
    }
  }
  process.stdout.write(antigravityAdapter.emitPreInvocation(injectSteps));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`transcodes-guard pre-invocation hook error: ${err}
`);
  process.exit(0);
});
