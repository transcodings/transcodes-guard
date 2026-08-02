import { transcodesConfigFile } from '@transcodes-guard/core/stepup';
import { CLI_COMMAND_SPECS } from './specs.js';

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
  return `Your sign-in is saved by \`transcodes login\` and used by AI app plugins from:
  ${configPath}
`;
}

/** Terminal output for `transcodes help`. */
export function formatCliUsage(configPath = transcodesConfigFile()): string {
  const usageLines = CLI_COMMAND_SPECS.map(
    (cmd) => `  ${cmd.usage.padEnd(34)}${cmd.description}`,
  ).join('\n');

  return `transcodes — Transcodes control panel & sign-in

Usage:
${usageLines}

${formatCliUsageFooter(configPath)}`;
}

/** HTML fragment for the dashboard Commands tab. */
export function renderCliCommandsHtml(): string {
  return CLI_COMMAND_SPECS.filter((cmd) => cmd.showInDashboard !== false)
    .map(
      (cmd) =>
        `<div class="cmd"><code>${escapeHtml(cmd.usage)}</code><span class="cmd-desc">${escapeHtml(cmd.description)}</span></div>`,
    )
    .join('\n        ');
}
