import { spawn } from 'node:child_process';
import path from 'node:path';

export const DEPLOY_VERIFY_PROMPT =
  'What is your persona role in this project folder, and what are you supposed to do?';

export function buildAskDesktopUrl(input: {
  prompt: string;
  cwd?: string;
  submit?: boolean;
}): string {
  const url = new URL('transcodes://ask');
  url.searchParams.set('prompt', input.prompt);
  if (input.cwd) url.searchParams.set('cwd', input.cwd);
  if (input.submit !== false) url.searchParams.set('submit', '1');
  return url.toString();
}

export function openDesktopAsk(input: {
  prompt: string;
  cwd?: string;
  submit?: boolean;
}): string {
  const url = buildAskDesktopUrl(input);
  const child =
    process.platform === 'darwin'
      ? spawn('open', [url], { detached: true, stdio: 'ignore' })
      : process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], {
            detached: true,
            stdio: 'ignore',
          })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
  return url;
}

export function resolveAskCwd(input?: string): string {
  return path.resolve(input?.trim() || process.cwd());
}
