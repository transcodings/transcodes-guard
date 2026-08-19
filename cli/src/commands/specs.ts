/**
 * SSOT for transcodes CLI command list — terminal help and the dashboard
 * CLI Commands tab both read from here.
 */

import type { CliCommandSpec } from './types.js';

export const CLI_COMMAND_SPECS: readonly CliCommandSpec[] = [
  {
    usage: 'transcodes install',
    description:
      'Guided setup: install for your AI apps, then open this panel and sign in there (--all / <platforms>)',
  },
  {
    usage: 'transcodes update',
    description:
      'Update Transcodes for your AI apps and this tool from npm (--cli-only / --plugins-only / --all)',
  },
  {
    usage: 'transcodes uninstall',
    description:
      'Remove Transcodes plugins and local settings from this computer (--dry-run / -y)',
  },
  {
    usage: 'transcodes',
    description:
      'Open this control panel in the background (reuses a running server; default port 3847; --port N / --no-open)',
  },
  {
    usage: 'transcodes stop',
    description: 'Stop the background control panel',
  },
  {
    usage: 'transcodes login',
    description:
      'Sign in with Google in your browser, choose an organization, and connect this computer (-l <label> / --no-open)',
  },
  {
    usage: 'transcodes logout',
    description: 'Sign out on this computer',
  },
  {
    usage: 'transcodes status',
    description:
      'Show whether you are signed in on this computer and when it expires',
  },
  {
    usage: 'transcodes console',
    description:
      'Open security settings (passkeys, authenticator apps) in your browser',
  },
  {
    usage: 'transcodes persona',
    description:
      'Create, inspect, edit, and apply Persona Instruction, Rule, and Skill files (push / pull to share them with your organization)',
  },
  {
    usage: 'transcodes version',
    description:
      'Show the installed Transcodes CLI version (also: --version, -V)',
  },
  {
    usage: 'transcodes sync init',
    description:
      'Create .transcodes/ SoT (rules + skills) in the current project',
  },
  {
    usage: 'transcodes sync generate',
    description:
      'Generate rules/skills from .transcodes/ (auto-detect installed AI apps; or -t to pin targets)',
  },
  {
    usage: 'transcodes sync add',
    description:
      'Scaffold a rule or skill under .transcodes/ (rule|skill --name; skills: SKILL.md required, --folder scripts,references,assets or --full for optional dirs, --lang python|node|bash for a starter script)',
  },
  {
    usage: 'transcodes help',
    description: 'Show the full command list and how to use each one',
  },
];
