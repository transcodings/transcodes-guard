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
 *   transcodes login <token>   Validate and save the token (0600).
 *   transcodes logout          Delete the saved token.
 *   transcodes status          Show the active token source + expiry.
 *   transcodes help            Usage.
 */
import {
  clearTokenFile,
  parseMemberAccessToken,
  resolveToken,
  transcodesConfigFile,
  writeTokenToFile,
} from "@ai-action-tracker/stepup-core";

const USAGE = `transcodes — ai-action-tracker token manager

Usage:
  transcodes login <token>   Save your Transcodes member token to ${transcodesConfigFile()}
  transcodes logout          Remove the saved token
  transcodes status          Show where the active token comes from
  transcodes help            Show this message

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

function cmdLogin(token: string | undefined): void {
  if (!token || !token.trim()) {
    fail("missing token. Usage: transcodes login <token>");
  }
  const trimmed = (token as string).trim();

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
    writeTokenToFile(trimmed);
  } catch (err) {
    fail(
      `could not write token file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  process.stdout.write(
    `Saved to ${transcodesConfigFile()}\n  ${expiryLine(trimmed)}\n`,
  );
}

function cmdLogout(): void {
  clearTokenFile();
  process.stdout.write(`Removed ${transcodesConfigFile()}\n`);
}

function cmdStatus(): void {
  const { token, source } = resolveToken();
  if (source === "none" || !token) {
    process.stdout.write(
      "No token configured. Run `transcodes login <token>` to set one.\n",
    );
    return;
  }
  const where =
    source === "env"
      ? "TRANSCODES_TOKEN environment variable"
      : transcodesConfigFile();
  process.stdout.write(`Active token source: ${where}\n  ${expiryLine(token)}\n`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "login":
      cmdLogin(rest[0]);
      break;
    case "logout":
      cmdLogout();
      break;
    case "status":
      cmdStatus();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      break;
    default:
      fail(`unknown command "${command}". Run \`transcodes help\`.`);
  }
}

main();
