import { createHash, randomUUID } from 'node:crypto';
import {
  createPersona,
  createSkillFolder,
  deletePersona,
  deletePersonaFile,
  deleteSkillPath,
  deployPersona,
  listPersona,
  listPersonaIds,
  type PersonaKind,
  readPersonaFile,
  renamePersona,
  renamePersonaEntry,
  savePersonaFile,
} from './persona.js';
import { type GeneratedPersona, generatePersona } from './persona-generate.js';
import {
  deletePersonaRemote,
  pullPersonaSync,
  pushPersonaSync,
} from './persona-sync.js';
import {
  findPersonaTemplate,
  type PersonaTemplate,
} from './persona-templates.js';

export type PendingAction = {
  actionId: string;
  hash: string;
  kind: 'deploy' | 'delete' | 'rename' | 'batch' | 'push' | 'pull';
  summary: string;
  details: Record<string, string>;
  deploy?: {
    persona: string;
    project?: string;
    global?: boolean;
    targets?: string[];
  };
  deleteName?: string;
  rename?: {
    current: string;
    next: string;
  };
  operations?: PersonaOperation[];
};

export type PersonaOperation =
  | { op: 'createPersona'; persona: string }
  | { op: 'deletePersona'; persona: string }
  | { op: 'renamePersona'; persona: string; next: string }
  | {
      op: 'deploy';
      persona: string;
      root?: string;
      global?: boolean;
      targets?: string[];
    }
  | {
      op: 'save';
      persona: string;
      kind: PersonaKind;
      name?: string;
      file?: string;
      content: string;
    }
  | {
      op: 'deleteFile';
      persona: string;
      kind: PersonaKind;
      name?: string;
    }
  | {
      op: 'createSkillFolder';
      persona: string;
      name: string;
      dir: string;
    }
  | {
      op: 'deleteSkillPath';
      persona: string;
      name: string;
      path: string;
    }
  | {
      op: 'renameEntry';
      persona: string;
      kind: 'rule' | 'skill' | 'knowledge';
      current: string;
      next: string;
    }
  | { op: 'push'; persona: string; tag?: string }
  | { op: 'pull'; persona: string }
  | { op: 'removeRemote'; persona: string };

const pending = new Map<string, PendingAction>();

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function actionHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function listPendingAction(actionId: string): PendingAction | undefined {
  return pending.get(actionId);
}

export function rememberAction(
  action: Omit<PendingAction, 'actionId' | 'hash'>,
): PendingAction {
  const body = {
    kind: action.kind,
    deploy: action.deploy,
    deleteName: action.deleteName,
    rename: action.rename,
    operations: action.operations,
  };
  const stored: PendingAction = {
    ...action,
    actionId: randomUUID(),
    hash: actionHash(body),
  };
  pending.set(stored.actionId, stored);
  return stored;
}

const DEPLOY_TARGET_ALIASES: Record<string, string> = {
  claude: 'claudecode',
  claudecode: 'claudecode',
  cursor: 'cursor',
  chatgpt: 'codexcli',
  codex: 'codexcli',
  codexcli: 'codexcli',
  antigravity: 'antigravity-ide',
  'antigravity-ide': 'antigravity-ide',
};

export function resolveDeployTargets(targets?: string[]): string[] | undefined {
  if (!targets?.length) return targets;
  return [
    ...new Set(
      targets.map((target) => DEPLOY_TARGET_ALIASES[target] ?? target),
    ),
  ];
}

export async function approveAction(
  actionId: string,
  hash?: string,
): Promise<unknown> {
  const action = pending.get(actionId);
  if (!action) throw new Error('This approval expired. Ask again.');
  const body = {
    kind: action.kind,
    deploy: action.deploy,
    deleteName: action.deleteName,
    rename: action.rename,
    operations: action.operations,
  };
  if (actionHash(body) !== action.hash) {
    throw new Error('This approval no longer matches the planned change.');
  }
  if (hash && hash !== action.hash) {
    throw new Error('This approval no longer matches the planned change.');
  }
  pending.delete(actionId);
  if (action.kind === 'deploy' && action.deploy) {
    return deployPersona({
      persona: action.deploy.persona,
      root: action.deploy.global ? undefined : action.deploy.project,
      targets: resolveDeployTargets(action.deploy.targets),
      global: action.deploy.global === true,
    });
  }
  if (action.kind === 'delete' && action.deleteName) {
    return { persona: await deletePersona(action.deleteName), deleted: true };
  }
  if (action.kind === 'rename' && action.rename) {
    return {
      persona: await renamePersona(action.rename.current, action.rename.next),
      previousPersona: action.rename.current,
      renamed: true,
    };
  }
  if (action.kind === 'batch' && action.operations?.length) {
    const results: unknown[] = [];
    for (const operation of action.operations) {
      if (operation.op === 'createPersona') {
        results.push(await createPersona(operation.persona));
      } else if (operation.op === 'deletePersona') {
        results.push(await deletePersona(operation.persona));
      } else if (operation.op === 'renamePersona') {
        results.push(await renamePersona(operation.persona, operation.next));
      } else if (operation.op === 'deploy') {
        results.push(
          await deployPersona({
            persona: operation.persona,
            root: operation.global ? undefined : operation.root,
            global: operation.global === true,
            targets: resolveDeployTargets(operation.targets),
          }),
        );
      } else if (operation.op === 'save') {
        results.push(await savePersonaFile(operation));
      } else if (operation.op === 'deleteFile') {
        results.push(await deletePersonaFile(operation));
      } else if (operation.op === 'createSkillFolder') {
        results.push(await createSkillFolder(operation));
      } else if (operation.op === 'deleteSkillPath') {
        results.push(await deleteSkillPath(operation));
      } else if (operation.op === 'renameEntry') {
        results.push(await renamePersonaEntry(operation));
      } else if (operation.op === 'push') {
        results.push(await pushPersonaSync(operation.persona, operation.tag));
      } else if (operation.op === 'pull') {
        results.push(await pullPersonaSync(operation.persona));
      } else if (operation.op === 'removeRemote') {
        results.push(await deletePersonaRemote(operation.persona));
      }
    }
    return {
      persona: action.operations[0]?.persona,
      updated: true,
      results,
    };
  }
  throw new Error(`Unsupported action "${action.kind}".`);
}

export function rejectAction(actionId: string): { rejected: true } {
  pending.delete(actionId);
  return { rejected: true };
}

export async function availablePersonaId(requested: string): Promise<string> {
  const existing = new Set(await listPersonaIds());
  if (!existing.has(requested)) return requested;
  let suffix = 2;
  while (existing.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
}

export async function writeGeneratedPersona(
  generated: GeneratedPersona,
): Promise<string> {
  const persona = await availablePersonaId(generated.persona_name);
  await createPersona(persona);
  await savePersonaFile({
    persona,
    kind: 'agent',
    content: generated.instruction,
  });
  for (const rule of generated.rules) {
    await savePersonaFile({
      persona,
      kind: 'rule',
      name: rule.name,
      content: rule.content,
    });
  }
  for (const skill of generated.skills) {
    if (skill.name === 'knowledge-base') continue;
    await savePersonaFile({
      persona,
      kind: 'skill',
      name: skill.name,
      content: skill.content,
    });
  }
  for (const knowledge of generated.knowledge_bases) {
    if (knowledge.name === 'what-belongs-here') continue;
    await savePersonaFile({
      persona,
      kind: 'skill',
      name: 'knowledge-base',
      file: `references/${knowledge.name}.md`,
      content: knowledge.content,
    });
  }
  return persona;
}

export function templateToGenerated(
  template: PersonaTemplate,
  personaName: string,
): GeneratedPersona {
  return {
    persona_name: personaName,
    instruction: template.instruction,
    rules: template.rules.map((entry) => ({
      name: entry.name,
      description: entry.name,
      content: entry.content,
    })),
    skills: template.skills.map((entry) => ({
      name: entry.name,
      description: entry.name,
      content: entry.content,
    })),
    knowledge_bases: template.knowledge.map((entry) => ({
      name: entry.name,
      description: entry.name,
      content: entry.content,
    })),
  };
}

export function pickTemplateId(role: string): string {
  const text = role.toLowerCase();
  if (/research|리서치|조사|시장/.test(text)) return 'researcher';
  if (/market|마케팅|캠페인/.test(text)) return 'marketer';
  if (/design|디자인|ui|ux/.test(text)) return 'ui-ux-designer';
  if (/fullstack|풀스택|개발|developer|engineer/.test(text)) {
    return 'fullstack-developer';
  }
  if (/landing|랜딩|퍼블리시/.test(text)) return 'landing-page-publisher';
  return 'minimum';
}

export async function createFromInterview(input: {
  role: string;
  work: string;
  rules: string;
  locale: 'ko' | 'en';
  personaName?: string;
}): Promise<{ persona: string; source: 'generate' | 'template' }> {
  try {
    const generated = await generatePersona({
      role: input.role,
      work: input.work,
      rules: input.rules,
      locale: input.locale,
    });
    if (input.personaName) generated.persona_name = input.personaName;
    return {
      persona: await writeGeneratedPersona(generated),
      source: 'generate',
    };
  } catch {
    const template =
      findPersonaTemplate(pickTemplateId(input.role)) ??
      findPersonaTemplate('minimum');
    if (!template) throw new Error('No Persona template is available.');
    const name =
      input.personaName?.trim() ||
      template.suggestedName ||
      pickTemplateId(input.role);
    return {
      persona: await writeGeneratedPersona(templateToGenerated(template, name)),
      source: 'template',
    };
  }
}

export async function personaSnapshot(persona?: string) {
  const ids = await listPersonaIds();
  if (!persona) return { personas: ids };
  return listPersona(undefined, persona);
}

export async function readPersona(
  persona: string,
  kind: PersonaKind,
  name?: string,
) {
  return readPersonaFile({ persona, kind, name });
}
