import { runAgentChat } from './agent.js';

export async function cmdAgent(args: string[]): Promise<void> {
  const [operation, ...rest] = args;
  if (operation !== 'chat') {
    throw new Error(
      'Usage: transcodes agent chat "<message>" [--locale ko|en] [--json|--jsonl]',
    );
  }
  let locale: 'ko' | 'en' = 'ko';
  let jsonl = false;
  const parts: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === '--locale' && rest[index + 1]) {
      locale = rest[index + 1] === 'en' ? 'en' : 'ko';
      index += 1;
      continue;
    }
    if (arg === '--jsonl') {
      jsonl = true;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    parts.push(arg);
  }
  const message = parts.join(' ').replace(/^['"]|['"]$/g, '');
  const result = await runAgentChat({ message, locale });
  if (jsonl) {
    process.stdout.write(
      `${JSON.stringify({ sessionId: result.sessionId })}\n`,
    );
    for (const event of result.events) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
