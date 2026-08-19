/**
 * Transcodes CLI — manages the local member credential for transcodes-guard.
 *
 * Plugins/hooks read the credential via `resolveToken()` (~/.transcodes/config.json).
 * The only supported way to obtain it is `transcodes login` (browser sign-in).
 *
 * Commands:
 *   transcodes                 Open the local web UI dashboard in the background.
 *   transcodes stop            Stop the background dashboard daemon.
 *   transcodes login           Sign in in a browser and save the issued MAT.
 *   transcodes logout          Remove the local credential.
 *   transcodes status          Show the active credential source + expiry.
 *   transcodes console         Open auth settings for the signed-in member.
 *   transcodes install         Guided plugin setup, then open the dashboard.
 *   transcodes update          Update installed plugins and this CLI.
 *   transcodes uninstall       Remove plugins and local settings.
 *   transcodes persona …       Create, edit, and deploy local Personas.
 *   transcodes sync …          Sync .transcodes rules/skills to AI tool configs.
 *   transcodes version         Print the installed CLI npm package version.
 *   transcodes help            Usage.
 *
 * Command list SSOT: ./commands/ (help + dashboard).
 * Command implementations: ./commands/transcodes/
 */

import {
  clearTokenFile,
  openConsoleSession,
  parseMemberAccessToken,
  resolveToken,
  transcodesConfigFile,
} from '@transcodes-guard/core/stepup';
import { formatCliUsage } from './commands/index.js';
import {
  ensureDashboard,
  serveDashboard,
  stopDashboard,
} from './commands/transcodes/dashboard-lifecycle.js';
import { cmdInstall, cmdUpdate } from './commands/transcodes/install.js';
import { writeLauncher } from './commands/transcodes/launcher.js';
import { cmdLogin } from './commands/transcodes/login.js';
import { cmdPersona } from './commands/transcodes/persona-cli.js';
import { cmdSync } from './commands/transcodes/sync.js';
import { cmdUninstall } from './commands/transcodes/uninstall.js';
import {
  CLI_PACKAGE_NAME,
  CLI_VERSION,
} from './commands/transcodes/version.js';

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

function cmdLogout(): void {
  clearTokenFile();
  process.stdout.write(`Signed out (${transcodesConfigFile()})\n`);
}

function cmdStatus(): void {
  const { token, source } = resolveToken();
  if (source === 'none' || !token) {
    process.stdout.write(
      'Not signed in. Run `transcodes login` to authenticate.\n',
    );
    return;
  }
  process.stdout.write(
    `Signed in (${transcodesConfigFile()})\n  ${expiryLine(token)}\n`,
  );
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
        ? 'Not signed in. Run `transcodes login` first.'
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

function parseDashboardFlags(
  args: string[],
  usage: string,
): { port?: number; open: boolean; daemon: boolean } {
  let port: number | undefined;
  let open = true;
  let daemon = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail('--port must be an integer between 1 and 65535');
      }
    } else if (args[i] === '--no-open') {
      open = false;
    } else if (args[i] === '--daemon') {
      daemon = true;
    } else {
      fail(`unknown flag "${args[i]}". Usage: ${usage}`);
    }
  }
  return { port, open, daemon };
}

async function cmdDashboard(args: string[]): Promise<void> {
  const { port, open, daemon } = parseDashboardFlags(
    args,
    'transcodes [--port N] [--no-open]',
  );
  if (daemon) {
    fail('use `transcodes dashboard --daemon` to run the server process');
  }
  try {
    await ensureDashboard({ port, open });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
}

/** Internal / advanced: `transcodes dashboard --daemon` or ensure+open. */
async function cmdDashboardSub(args: string[]): Promise<void> {
  const { port, open, daemon } = parseDashboardFlags(
    args,
    'transcodes dashboard [--daemon] [--port N] [--no-open]',
  );
  try {
    if (daemon) {
      await serveDashboard({ port });
      process.exit(0);
      return;
    }
    await ensureDashboard({ port, open });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
}

async function cmdStop(): Promise<void> {
  try {
    await stopDashboard();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  // Keep the Dock-visible launcher fresh. Skip uninstall — it deletes
  // ~/.transcodes and must not recreate the file on the way out.
  if (command !== 'uninstall') writeLauncher();

  switch (command) {
    case 'install':
      void cmdInstall(rest);
      break;
    case 'update':
      void cmdUpdate(rest);
      break;
    case 'uninstall':
      void cmdUninstall(rest).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
      break;
    case 'login':
      void cmdLogin(rest).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
      break;
    case 'logout':
    case 'reset':
      // `reset` kept as an alias for older muscle memory.
      cmdLogout();
      break;
    case 'status':
      cmdStatus();
      break;
    case 'set':
    case 'tokens':
      fail(
        `"${command}" was removed. Sign in with \`transcodes login\` (sign out with \`transcodes logout\`).`,
      );
      break;
    case 'console':
      void cmdConsole(rest);
      break;
    case 'dashboard':
      void cmdDashboardSub(rest);
      break;
    case 'stop':
      void cmdStop();
      break;
    case 'persona':
      void cmdPersona(rest).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
      break;
    case 'sync':
      void cmdSync(rest).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
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
