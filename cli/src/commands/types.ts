/**
 * Shared shape for CLI command entries shown in terminal help and the
 * dashboard Commands tab.
 */

export type CliCommandSpec = {
  /** Invocation as shown to users (includes the `transcodes` prefix). */
  usage: string;
  description: string;
  /** When false, omit from the dashboard CLI tab. */
  showInDashboard?: boolean;
};
