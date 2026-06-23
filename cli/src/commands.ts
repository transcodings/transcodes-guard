/**
 * SSOT for transcodes CLI commands — terminal help (`index.ts`) and the
 * dashboard CLI Commands tab (`dashboard.ts`) both read from here.
 */

import { transcodesConfigFile } from '@transcodes-guard/stepup-core';

export type CliCommandSpec = {
  /** Invocation as shown to users (includes the `transcodes` prefix). */
  usage: string;
  description: string;
  /** When false, omit from the dashboard CLI tab. */
  showInDashboard?: boolean;
};

export const CLI_COMMAND_SPECS: readonly CliCommandSpec[] = [
  {
    usage: 'transcodes',
    description:
      'Open the local dashboard (URL printed in terminal; default port 3847; --port N / --no-open)',
  },
  {
    usage: 'transcodes set <token> -l <label>',
    description:
      'Validate and save a member token with a required label, then make it active',
  },
  {
    usage: 'transcodes reset',
    description: 'Remove all saved tokens',
  },
  {
    usage: 'transcodes status',
    description: 'Show the active token source and expiry',
  },
  {
    usage: 'transcodes tokens',
    description: 'List all saved tokens (active one marked with *)',
  },
  {
    usage: 'transcodes console',
    description:
      'Open auth settings (passkeys, TOTP) for the active token in your browser',
  },
  {
    usage: 'transcodes policy refresh',
    description: 'Force-refresh the org policy bundle cache now',
  },
  {
    usage: 'transcodes help',
    description: 'Show the full command list and how to use each one',
  },
];

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function formatCliUsageFooter(
  configPath = transcodesConfigFile(),
): string {
  return `The token is read by the transcodes-guard plugins/hooks with precedence:
  1. ${configPath} (written by this CLI, the source of truth)
  2. TRANSCODES_TOKEN environment variable (fallback for config-less envs)
`;
}

/** Terminal output for `transcodes help`. */
export function formatCliUsage(configPath = transcodesConfigFile()): string {
  const usageLines = CLI_COMMAND_SPECS.map(
    (cmd) => `  ${cmd.usage.padEnd(34)}${cmd.description}`,
  ).join('\n');

  return `transcodes — transcodes-guard token manager

Usage:
${usageLines}

${formatCliUsageFooter(configPath)}`;
}

/** HTML fragment for the dashboard "CLI Commands" tab. */
export function renderCliCommandsHtml(): string {
  return CLI_COMMAND_SPECS.filter((cmd) => cmd.showInDashboard !== false)
    .map(
      (cmd) =>
        `<div class="cmd"><code>${escapeHtml(cmd.usage)}</code><span class="cmd-desc">${escapeHtml(cmd.description)}</span></div>`,
    )
    .join('\n        ');
}
