/**
 * Transcodes CLI — manages the transcodes-guard member MCP token.
 *
 * The plugins (Claude Code / Codex / Cursor / Antigravity) and their hooks
 * read the token via `resolveToken()` (~/.transcodes/config.json → env).
 * This CLI is the safe way to populate that file: the token is pasted into
 * the terminal, never into the agent chat (which would leak it into the
 * transcript). All token logic lives in `@transcodes-guard/stepup-core`;
 * this file is just an argv front-end.
 *
 * Commands:
 *   transcodes                 Open the local web UI dashboard (default, no args).
 *   transcodes set <token> -l <label> Validate and save the token (0600); label required.
 *   transcodes reset           Delete all saved tokens.
 *   transcodes status          Show the active token source + expiry.
 *   transcodes tokens          List all saved tokens (active marked with *).
 *   transcodes console         Open auth settings for the active token.
 *   transcodes version         Print the installed CLI npm package version.
 *   transcodes help            Usage.
 *
 * Command list SSOT: ./commands.ts (dashboard reads the same source).
 */

import {
  clearTokenFile,
  openConsoleSession,
  parseMemberAccessToken,
  readTokenFromFile,
  readTokenRecords,
  resolveToken,
  transcodesConfigFile,
  writeTokenToFile,
} from '@transcodes-guard/stepup-core';
import { formatCliUsage } from './commands.js';
import { runDashboard } from './dashboard.js';
import { CLI_PACKAGE_NAME, CLI_VERSION } from './version.js';

function fail(message: string): never {
  process.stderr.write(`transcodes: ${message}\n`);
  process.exit(1);
}

function cmdVersion(): void {
  process.stdout.write(`${CLI_PACKAGE_NAME} ${CLI_VERSION}\n`);
}

function expiryLine(token: string): string {
  try {
    const parsed = parseMemberAccessToken(token);
    const exp = new Date(parsed.claims.exp * 1000).toISOString();
    const warn =
      parsed.warnings.length > 0
        ? `  (warnings: ${parsed.warnings.join('; ')})`
        : '';
    return `member=${parsed.claims.memberId} project=${parsed.claims.projectId} expires=${exp}${warn}`;
  } catch (err) {
    return `unable to decode token: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

function cmdSet(args: string[]): void {
  let token: string | undefined;
  let label: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-l' || arg === '--label') {
      label = args[++i];
    } else if (token === undefined) {
      token = arg;
    } else {
      fail(
        `unexpected argument "${arg}". Usage: transcodes set <token> -l <label>`,
      );
    }
  }

  if (!token?.trim()) {
    fail('missing token. Usage: transcodes set <token> -l <label>');
  }
  if (!label?.trim()) {
    fail('missing label. Usage: transcodes set <token> -l <label>');
  }
  const trimmed = (token as string).trim();
  const trimmedLabel = (label as string).trim();

  // Validate before persisting so the user gets immediate feedback on an
  // expired or malformed token instead of a confusing 401 later.
  try {
    parseMemberAccessToken(trimmed);
  } catch (err) {
    fail(`token rejected: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    writeTokenToFile(trimmed, trimmedLabel);
  } catch (err) {
    fail(
      `could not write token file: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  process.stdout.write(
    `Saved to ${transcodesConfigFile()}\n  label=${trimmedLabel} ${expiryLine(
      trimmed,
    )}\n`,
  );
}

function cmdReset(): void {
  clearTokenFile();
  process.stdout.write(
    `Removed all saved tokens (${transcodesConfigFile()})\n`,
  );
}

function cmdStatus(): void {
  const { token, source } = resolveToken();
  if (source === 'none' || !token) {
    process.stdout.write(
      'No token configured. Run `transcodes set <token> -l <label>` or `transcodes` to set one.\n',
    );
    return;
  }
  process.stdout.write(
    `Active token source: ${transcodesConfigFile()}\n  ${expiryLine(token)}\n`,
  );
}

function cmdTokens(): void {
  const records = readTokenRecords();
  if (records.length === 0) {
    process.stdout.write(
      'No tokens saved. Run `transcodes set <token> -l <label>` or `transcodes` to add one.\n',
    );
    return;
  }
  const active = readTokenFromFile();
  process.stdout.write(`Saved tokens (${transcodesConfigFile()}):\n`);
  for (const { token, label } of records) {
    const marker = token === active ? '*' : ' ';
    process.stdout.write(`  ${marker} ${label ?? '(no label)'}\n`);
    process.stdout.write(`      ${expiryLine(token)}\n`);
  }
  process.stdout.write('\n* = active token used by the plugins/hooks.\n');
}

async function cmdConsole(args: string[]): Promise<void> {
  let open = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-open') {
      open = false;
    } else {
      fail(`unknown flag "${args[i]}". Usage: transcodes console [--no-open]`);
    }
  }

  const result = await openConsoleSession({ openBrowser: open });
  if (!result.ok) {
    const msg =
      result.reason === 'no-token'
        ? 'No token configured. Run `transcodes set <token> -l <label>` or open the dashboard first.'
        : (result.detail ?? result.reason);
    fail(msg);
  }

  process.stdout.write(`Console session created (sid=${result.sid})\n`);
  if (result.launched) {
    process.stdout.write(`Opened in browser: ${result.browserUrl}\n`);
  } else {
    process.stdout.write(`Visit: ${result.browserUrl}\n`);
  }
  process.exit(0);
}

async function cmdDashboard(args: string[]): Promise<void> {
  let port: number | undefined;
  let open = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail('--port must be an integer between 1 and 65535');
      }
    } else if (args[i] === '--no-open') {
      open = false;
    } else {
      fail(
        `unknown flag "${args[i]}". Usage: transcodes [--port N] [--no-open]`,
      );
    }
  }
  try {
    await runDashboard({ port, open });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'set':
      cmdSet(rest);
      break;
    case 'reset':
      cmdReset();
      break;
    case 'status':
      cmdStatus();
      break;
    case 'tokens':
      cmdTokens();
      break;
    case 'console':
      void cmdConsole(rest);
      break;
    case 'version':
    case '--version':
    case '-V':
    case '-v':
      cmdVersion();
      break;
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(formatCliUsage());
      break;
    case undefined:
      void cmdDashboard([]);
      break;
    default:
      // No subcommand: bare flags (e.g. `transcodes --port 4000`) open the
      // dashboard. Anything else is an unknown command.
      if (command.startsWith('-')) {
        void cmdDashboard([command, ...rest]);
        break;
      }
      fail(`unknown command "${command}". Run \`transcodes help\`.`);
  }
}

main();
