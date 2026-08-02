/**
 * CLI command list SSOT — terminal help (`index.ts`) and the dashboard
 * CLI Commands tab (`dashboard.ts`) both read from here.
 */

export {
  formatCliUsage,
  formatCliUsageFooter,
  renderCliCommandsHtml,
} from './format.js';
export { CLI_COMMAND_SPECS } from './specs.js';
export type { CliCommandSpec } from './types.js';
