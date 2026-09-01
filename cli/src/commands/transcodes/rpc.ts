import { createInterface } from 'node:readline';
import { runAgentChat } from './agent.js';
import {
  createPersona,
  createSkillFolder,
  deletePersona,
  deletePersonaFile,
  deleteSkillPath,
  deployPersona,
  type PersonaKind,
  readPersonaFile,
  renamePersona,
  savePersonaFile,
} from './persona.js';
import {
  approveAction,
  personaSnapshot,
  rejectAction,
  resolveDeployTargets,
  writeGeneratedPersona,
} from './persona-actions.js';
import { PersonaApiError } from './persona-api.js';
import { type GeneratedPersona, generatePersona } from './persona-generate.js';
import {
  clearPersonaSyncRevision,
  deletePersonaRemote,
  listPersonaRemoteStatus,
  pullPersonaSync,
  pushPersonaSync,
} from './persona-sync.js';
import type { RpcFailure, RpcRequest, RpcSuccess } from './rpc-protocol.js';

function write(value: RpcSuccess | RpcFailure): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && Boolean(item.trim()),
      )
    : [];
}

function personaKind(value: unknown): PersonaKind {
  const kind = text(value);
  if (kind !== 'agent' && kind !== 'rule' && kind !== 'skill') {
    throw new Error('--kind must be agent, rule, or skill.');
  }
  return kind;
}

function generatedEntries(value: unknown): GeneratedPersona['rules'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const name = text(record.name);
    const content = typeof record.content === 'string' ? record.content : '';
    if (!name || !content) return [];
    return [
      {
        name,
        description: text(record.description) || name,
        content,
      },
    ];
  });
}

function generatedPersona(value: unknown): GeneratedPersona {
  const record = asRecord(value);
  const personaName = text(record.persona_name || record.personaName);
  const instruction =
    typeof record.instruction === 'string' ? record.instruction : '';
  if (!personaName || !instruction.trim()) {
    throw new Error('Generated Persona name and instruction are required.');
  }
  return {
    persona_name: personaName,
    instruction,
    rules: generatedEntries(record.rules),
    skills: generatedEntries(record.skills),
    knowledge_bases: generatedEntries(
      record.knowledge_bases ?? record.knowledgeBases,
    ),
  };
}

async function deployFromParams(params: Record<string, unknown>) {
  const persona = text(params.persona || params.personaId);
  const global = params.global === true;
  const root = text(params.root || params.projectRoot);
  const targets = resolveDeployTargets(strings(params.targets));
  const result = await deployPersona({
    persona: persona || undefined,
    root: global ? undefined : root || undefined,
    targets,
    global,
    dryRun: params.dryRun === true,
  });
  if (!result.ok) {
    throw new Error(result.output || 'Persona apply failed.');
  }
  return {
    persona,
    projectRoot: root,
    targets: targets ?? [],
    global,
    written: [] as string[],
    output: result.output,
  };
}

export async function dispatchRpc(request: RpcRequest): Promise<unknown> {
  const params = asRecord(request.params);
  switch (request.method) {
    case 'ping':
      return { ok: true };
    case 'persona.list':
      return personaSnapshot(text(params.persona) || undefined);
    case 'persona.read':
      return readPersonaFile({
        persona: text(params.persona),
        kind: personaKind(params.kind),
        name: text(params.name) || undefined,
        file: text(params.file) || undefined,
      });
    case 'persona.create':
      return {
        persona: await createPersona(text(params.persona || params.name)),
      };
    case 'persona.save':
      return savePersonaFile({
        persona: text(params.persona),
        kind: personaKind(params.kind),
        name: text(params.name) || undefined,
        file: text(params.file) || undefined,
        content: typeof params.content === 'string' ? params.content : '',
      });
    case 'persona.delete': {
      const persona = await deletePersona(text(params.persona || params.name));
      await clearPersonaSyncRevision(persona).catch(() => undefined);
      return { persona, deleted: true };
    }
    case 'persona.rename': {
      const current = text(params.persona || params.current || params.name);
      const next = text(params.next || params.newName);
      return {
        persona: await renamePersona(current, next),
        previousPersona: current,
        renamed: true,
      };
    }
    case 'persona.deleteFile':
      return deletePersonaFile({
        persona: text(params.persona),
        kind: personaKind(params.kind),
        name: text(params.name) || undefined,
      });
    case 'persona.createSkillFolder':
      return createSkillFolder({
        persona: text(params.persona),
        name: text(params.name) || undefined,
        dir: text(params.dir || params.path),
      });
    case 'persona.deleteSkillPath':
      return deleteSkillPath({
        persona: text(params.persona),
        name: text(params.name || params.skillName) || undefined,
        path: text(params.path || params.relativePath),
      });
    case 'persona.deploy':
      return deployFromParams(params);
    case 'persona.push':
      return pushPersonaSync(
        text(params.persona),
        text(params.tag) || undefined,
      );
    case 'persona.pull':
      return pullPersonaSync(text(params.persona));
    case 'persona.remotes':
      return listPersonaRemoteStatus();
    case 'persona.removeRemote':
      await deletePersonaRemote(text(params.persona));
      return { removed: true };
    case 'persona.generate':
      return generatePersona({
        role: text(params.role),
        work: typeof params.work === 'string' ? params.work : '',
        rules: typeof params.rules === 'string' ? params.rules : '',
        locale: params.locale === 'en' ? 'en' : 'ko',
      });
    case 'persona.writeGenerated':
      return {
        persona: await writeGeneratedPersona(generatedPersona(params)),
      };
    case 'agent.chat':
      return runAgentChat({
        sessionId: text(params.sessionId) || undefined,
        message: text(params.message),
        locale: params.locale === 'en' ? 'en' : 'ko',
        projectPath: text(params.projectPath) || undefined,
        personaId: text(params.personaId) || undefined,
      });
    case 'action.approve':
      return approveAction(
        text(params.actionId),
        text(params.hash) || undefined,
      );
    case 'action.reject':
      return rejectAction(text(params.actionId));
    default:
      throw new Error(`Unknown method "${request.method}".`);
  }
}

function failure(id: RpcRequest['id'], error: unknown): RpcFailure {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode =
    error instanceof PersonaApiError ? error.errorCode : undefined;
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32000,
      message,
      ...(errorCode ? { data: { errorCode } } : {}),
    },
  };
}

export async function cmdRpc(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('transcodes rpc --stdio\n');
    return;
  }
  if (!args.includes('--stdio')) {
    throw new Error('Use `transcodes rpc --stdio`.');
  }

  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let request: RpcRequest;
    try {
      request = JSON.parse(trimmed) as RpcRequest;
    } catch {
      write({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Invalid JSON.' },
      });
      continue;
    }
    if (!request.method) {
      write({
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: { code: -32600, message: 'Method is required.' },
      });
      continue;
    }
    try {
      const result = await dispatchRpc(request);
      write({ jsonrpc: '2.0', id: request.id ?? null, result });
    } catch (error) {
      write(failure(request.id, error));
    }
  }
}
