/**
 * Transcodes CLI — manages the ai-action-tracker member MCP token.
 *
 * The plugins (Claude Code / Codex / Cursor / Antigravity) and their hooks
 * read the token via `resolveToken()` (env → ~/.transcodes/config.json).
 * This CLI is the safe way to populate that file: the token is pasted into
 * the terminal, never into the agent chat (which would leak it into the
 * transcript). All token logic lives in `@ai-action-tracker/stepup-core`;
 * this file is just an argv front-end.
 *
 * Commands:
 *   transcodes                 Open the local web UI dashboard (default, no args).
 *   transcodes set <token> -l <label> Validate and save the token (0600); label required.
 *   transcodes reset           Delete all saved tokens.
 *   transcodes status          Show the active token source + expiry.
 *   transcodes tokens          List all saved tokens (active marked with *).
 *   transcodes help            Usage.
 */
import { runDashboard } from "./dashboard.js";
import {
  clearTokenFile,
  parseMemberAccessToken,
  readTokenFromFile,
  readTokenRecords,
  resolveToken,
  transcodesConfigFile,
  writeTokenToFile,
} from "@ai-action-tracker/stepup-core";

const USAGE = `transcodes — ai-action-tracker token manager

Usage:
  transcodes                      Open the dashboard at http://127.0.0.1:3847/ (add --port N or --no-open)
  transcodes set <token> -l <label>  Save your Transcodes member token (label required) to ${transcodesConfigFile()}
  transcodes reset                Remove all saved tokens
  transcodes status               Show where the active token comes from
  transcodes tokens               List all saved tokens (active one marked with *)
  transcodes help                 Show this message

The token is read by the ai-action-tracker plugins/hooks with precedence:
  1. TRANSCODES_TOKEN environment variable (overrides everything)
  2. ${transcodesConfigFile()}
`;

function fail(message: string): never {
  process.stderr.write(`transcodes: ${message}\n`);
  process.exit(1);
}

function expiryLine(token: string): string {
  try {
    const parsed = parseMemberAccessToken(token);
    const exp = new Date(parsed.claims.exp * 1000).toISOString();
    const warn =
      parsed.warnings.length > 0 ? `  (warnings: ${parsed.warnings.join("; ")})` : "";
    return `member=${parsed.claims.memberId} project=${parsed.claims.projectId} expires=${exp}${warn}`;
  } catch (err) {
    return `unable to decode token: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function cmdSet(args: string[]): void {
  let token: string | undefined;
  let label: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-l" || arg === "--label") {
      label = args[++i];
    } else if (token === undefined) {
      token = arg;
    } else {
      fail(`unexpected argument "${arg}". Usage: transcodes set <token> -l <label>`);
    }
  }

  if (!token || !token.trim()) {
    fail("missing token. Usage: transcodes set <token> -l <label>");
  }
  if (!label || !label.trim()) {
    fail("missing label. Usage: transcodes set <token> -l <label>");
  }
  const trimmed = (token as string).trim();
  const trimmedLabel = (label as string).trim();

  // Validate before persisting so the user gets immediate feedback on an
  // expired or malformed token instead of a confusing 401 later.
  try {
    parseMemberAccessToken(trimmed);
  } catch (err) {
    fail(
      `token rejected: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    writeTokenToFile(trimmed, trimmedLabel);
  } catch (err) {
    fail(
      `could not write token file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  process.stdout.write(
    `Saved to ${transcodesConfigFile()}\n  label=${trimmedLabel} ${expiryLine(trimmed)}\n`,
  );
}

function cmdReset(): void {
  clearTokenFile();
  process.stdout.write(`Removed all saved tokens (${transcodesConfigFile()})\n`);
}

function cmdStatus(): void {
  const { token, source } = resolveToken();
  if (source === "none" || !token) {
    process.stdout.write(
      "No token configured. Run `transcodes set <token> -l <label>` or `transcodes` to set one.\n",
    );
    return;
  }
  const where =
    source === "env"
      ? "TRANSCODES_TOKEN environment variable"
      : transcodesConfigFile();
  process.stdout.write(`Active token source: ${where}\n  ${expiryLine(token)}\n`);
}

function cmdTokens(): void {
  const records = readTokenRecords();
  if (records.length === 0) {
    process.stdout.write(
      "No tokens saved. Run `transcodes set <token> -l <label>` or `transcodes` to add one.\n",
    );
    return;
  }
  const active = readTokenFromFile();
  process.stdout.write(`Saved tokens (${transcodesConfigFile()}):\n`);
  for (const { token, label } of records) {
    const marker = token === active ? "*" : " ";
    process.stdout.write(`  ${marker} ${label ?? "(no label)"}\n`);
    process.stdout.write(`      ${expiryLine(token)}\n`);
  }
  const envToken = process.env.TRANSCODES_TOKEN?.trim();
  if (envToken) {
    process.stdout.write(
      "\nNote: TRANSCODES_TOKEN is set and overrides the active selection above.\n",
    );
  } else {
    process.stdout.write("\n* = active token used by the plugins/hooks.\n");
  }
}

async function cmdDashboard(args: string[]): Promise<void> {
  let port: number | undefined;
  let open = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = Number(args[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail("--port must be an integer between 1 and 65535");
      }
    } else if (args[i] === "--no-open") {
      open = false;
    } else {
      fail(`unknown flag "${args[i]}". Usage: transcodes [--port N] [--no-open]`);
    }
  }
  try {
    await runDashboard({ port, open });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "set":
      cmdSet(rest);
      break;
    case "reset":
      cmdReset();
      break;
    case "status":
      cmdStatus();
      break;
    case "tokens":
      cmdTokens();
      break;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      break;
    case undefined:
      void cmdDashboard([]);
      break;
    default:
      // No subcommand: bare flags (e.g. `transcodes --port 4000`) open the
      // dashboard. Anything else is an unknown command.
      if (command.startsWith("-")) {
        void cmdDashboard([command, ...rest]);
        break;
      }
      fail(`unknown command "${command}". Run \`transcodes help\`.`);
  }
}

main();
