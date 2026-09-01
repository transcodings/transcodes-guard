import {
  DEPLOY_VERIFY_PROMPT,
  openDesktopAsk,
  resolveAskCwd,
} from './ask-desktop.js';

function fail(message: string): never {
  throw new Error(message);
}

export async function cmdAsk(args: string[]): Promise<void> {
  let prompt = DEPLOY_VERIFY_PROMPT;
  let cwd: string | undefined;
  let submit = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--prompt' && args[i + 1]) {
      prompt = args[++i] ?? prompt;
    } else if (arg === '--cwd' || arg === '--project') {
      if (!args[i + 1]) fail(`${arg} needs a folder path.`);
      cwd = args[++i];
    } else if (arg === '--no-submit') {
      submit = false;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: transcodes ask [--prompt TEXT] [--cwd FOLDER] [--no-submit]\n',
      );
      return;
    } else {
      fail(
        `unknown flag "${arg}". Usage: transcodes ask [--prompt TEXT] [--cwd FOLDER]`,
      );
    }
  }
  const folder = resolveAskCwd(cwd);
  openDesktopAsk({
    prompt: prompt.trim() || DEPLOY_VERIFY_PROMPT,
    cwd: folder,
    submit,
  });
  process.stdout.write(
    submit
      ? `Opened Transcodes Ask AI in ${folder}. Waiting for the agent in the app.\n`
      : `Opened Transcodes Ask AI in ${folder}.\n`,
  );
}
