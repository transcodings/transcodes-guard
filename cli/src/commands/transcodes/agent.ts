import { randomUUID } from 'node:crypto';
import { isPersonaName, listPersonaIds } from './persona.js';
import {
  createFromInterview,
  type PersonaOperation,
  personaSnapshot,
  rememberAction,
} from './persona-actions.js';
import { listPersonaRemoteStatus } from './persona-sync.js';
import type {
  AgentChatParams,
  AgentChatResult,
  AgentEvent,
} from './rpc-protocol.js';

export type AgentIntent =
  | 'list'
  | 'remotes'
  | 'create'
  | 'apply'
  | 'delete'
  | 'rename'
  | 'read'
  | 'menu';

type Draft = {
  personaName?: string;
  role?: string;
  work?: string;
  rules?: string;
  projectPath?: string;
  global?: boolean;
  later?: boolean;
  targets?: string[];
};

type Session = {
  id: string;
  locale: 'ko' | 'en';
  intent: AgentIntent | null;
  draft: Draft;
  pendingField?: string;
  createdPersona?: string;
};

const sessions = new Map<string, Session>();

const TARGETS = [
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'antigravity', label: 'Antigravity' },
] as const;

export function classifyIntent(text: string): AgentIntent {
  const value = text.trim().toLowerCase();
  if (!value) return 'menu';
  if (
    /(remote|원격|팀|organization|조직)/.test(value) &&
    /(목록|list|상태|status|보여)/.test(value)
  ) {
    return 'remotes';
  }
  if (/목록|list|뭐 있|어떤 페르소나|show personas/.test(value)) return 'list';
  if (
    /만들|생성|create|set up|구성해/.test(value) &&
    /적용|apply|deploy/.test(value)
  ) {
    return 'create';
  }
  if (/적용|apply|deploy/.test(value)) return 'apply';
  if (/삭제|지워|delete|remove persona/.test(value)) return 'delete';
  if (/이름.*(?:바꿔|변경|고쳐)|rename/.test(value)) return 'rename';
  if (/만들|생성|create|set up|구성해|페르소나에/.test(value)) return 'create';
  if (/읽어|보여|review|열어|read/.test(value)) return 'read';
  return 'menu';
}

function inferRole(text: string): string | undefined {
  const value = text.toLowerCase();
  if (/research|리서처|리서치|조사|시장/.test(value)) return 'researcher';
  if (/market|마케팅|캠페인/.test(value)) return 'marketer';
  if (/design|디자인|ui|ux/.test(value)) return 'ui-ux-designer';
  if (/fullstack|풀스택|개발|developer|engineer/.test(value)) {
    return 'fullstack-developer';
  }
  if (/landing|랜딩|퍼블리시/.test(value)) return 'landing-page-publisher';
  return undefined;
}

function inferTargets(text: string): string[] {
  const value = text.toLowerCase();
  const targets: string[] = [];
  if (/claude|클로드/.test(value)) targets.push('claude');
  if (/cursor|커서/.test(value)) targets.push('cursor');
  if (/chatgpt|codex|챗gpt/.test(value)) targets.push('chatgpt');
  if (/antigravity|안티그래비티|gemini/.test(value))
    targets.push('antigravity');
  return targets;
}

function copy(locale: 'ko' | 'en') {
  if (locale === 'ko') {
    return {
      menu: 'Persona를 조회·생성·적용할 수 있습니다. 무엇을 할까요?',
      listEmpty: '저장된 Persona가 없습니다. 하나 만들어 드릴까요?',
      listPrefix: '저장된 Persona:',
      askRole: '어떤 역할의 Persona를 만들까요?',
      askName: '이 이름으로 저장할까요? 글자나 숫자로 시작하는 이름만 됩니다.',
      badName:
        '그 이름은 쓸 수 없습니다. 글자나 숫자로 시작하고, 점·밑줄·하이픈만 쓰세요. 예: ai-growth-marketer',
      failed: '지금은 그 작업을 끝내지 못했습니다. 이름을 다시 알려주세요.',
      askWork: '주로 어떤 일을 하면 될까요?',
      creating: 'Persona를 만들고 있습니다…',
      created: (name: string) =>
        `“${name}” Persona를 만들었습니다. 지금 적용할까요?`,
      askDest: '어디에 적용할까요?',
      project: '현재 프로젝트 폴더',
      global: '이 기기 전체',
      later: '나중에',
      askPath: '적용할 프로젝트 폴더의 절대 경로를 알려주세요.',
      askTargets: '어떤 앱에 적용할까요?',
      needPersona: '어떤 Persona를 적용할까요?',
      confirmApply: '이 변경을 적용할까요? 선택한 앱의 생성 파일을 덮어씁니다.',
      laterOk: '저장만 해 두었습니다. 나중에 Apply에서 적용할 수 있습니다.',
      unknownPersona: (name: string) => `Persona “${name}”을 찾지 못했습니다.`,
    };
  }
  return {
    menu: 'I can list, create, or apply a Persona. What should I do?',
    listEmpty: 'No Personas are saved yet. Create one?',
    listPrefix: 'Saved Personas:',
    askRole: 'What role should this Persona have?',
    askName: 'Save it under this name? It must start with a letter or number.',
    badName:
      'That name is not allowed. Start with a letter or number. Use only letters, numbers, dots, underscores, or hyphens. Example: ai-growth-marketer',
    failed: 'I could not finish that. Tell me the Persona name again.',
    askWork: 'What work should it handle?',
    creating: 'Creating the Persona…',
    created: (name: string) => `Created Persona “${name}”. Apply it now?`,
    askDest: 'Where should I apply it?',
    project: 'Current project folder',
    global: 'This entire device',
    later: 'Later',
    askPath: 'Send the absolute project folder path.',
    askTargets: 'Which apps should receive it?',
    needPersona: 'Which Persona should I apply?',
    confirmApply:
      'Apply these changes? Generated files for the selected apps may be replaced.',
    laterOk: 'Saved only. You can apply it later.',
    unknownPersona: (name: string) => `Persona “${name}” was not found.`,
  };
}

export function suggestPersonaName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^(아니요?|nope|no|n|대신|말고)[,:\s-]+/i, '')
    .trim();
  const token = cleaned.match(/[a-zA-Z][a-zA-Z0-9._-]*/)?.[0];
  if (token) return token.replace(/[-._]+$/g, '');
  const slug = cleaned
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[-._]+|[-._]+$/g, '');
  return slug;
}

function acceptedPersonaName(input: string): string | undefined {
  const name = suggestPersonaName(input);
  return name && isPersonaName(name) ? name : undefined;
}

function isAffirmative(text: string): boolean {
  return /^(네|예|응|좋아|yes|y|ok|okay)$/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(아니|아니요|no|n)$/i.test(text.trim());
}

function askPersonaName(session: Session, invalid?: boolean): AgentEvent[] {
  const t = copy(session.locale);
  const current = session.draft.personaName;
  const suggestion =
    current && isPersonaName(current)
      ? [{ id: current, label: current }]
      : undefined;
  return [
    ...(invalid ? [{ type: 'text' as const, text: t.badName }] : []),
    ask(session, 'name', t.askName, suggestion),
  ];
}

export function extractName(text: string): string | undefined {
  const named = text.match(
    /(?:persona|페르소나)\s+(?:named|name|이름(?:은|을|으로)?)\s*[“"'`]?([a-zA-Z0-9][a-zA-Z0-9._-]*)/i,
  );
  if (named) return named[1];
  const before = text.match(
    /[“"'`]?([a-zA-Z0-9][a-zA-Z0-9._-]*)[”"'`]?\s*(?:라는|이란)?\s*페르소나/i,
  );
  if (before) return before[1];
  const after = text.match(
    /(?:persona|페르소나)\s*[“"'`]?([a-zA-Z0-9][a-zA-Z0-9._-]*)/i,
  );
  return after?.[1];
}

function extractRename(text: string): {
  current?: string;
  next?: string;
} {
  const english = text.match(
    /rename\s+(?:persona\s+)?([a-zA-Z0-9][a-zA-Z0-9._-]*)\s+(?:to|as)\s+([a-zA-Z0-9][a-zA-Z0-9._-]*)/i,
  );
  if (english) return { current: english[1], next: english[2] };
  const korean = text.match(
    /([a-zA-Z0-9][a-zA-Z0-9._-]*)\s*(?:라는|이란)?\s*페르소나(?:의)?(?:\s*이름을)?\s*([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:로|라고)\s*(?:이름\s*)?(?:바꿔|변경|고쳐)/i,
  );
  return korean ? { current: korean[1], next: korean[2] } : {};
}

function sessionOf(params: AgentChatParams): Session {
  const id = params.sessionId?.trim() || randomUUID();
  const existing = sessions.get(id);
  if (existing) {
    if (params.projectPath?.trim()) {
      existing.draft.projectPath = params.projectPath.trim();
    }
    if (params.personaId?.trim() && !existing.draft.personaName) {
      existing.draft.personaName = params.personaId.trim();
    }
    return existing;
  }
  const created: Session = {
    id,
    locale: params.locale === 'en' ? 'en' : 'ko',
    intent: null,
    draft: {
      projectPath: params.projectPath?.trim(),
      personaName: params.personaId?.trim(),
    },
  };
  sessions.set(id, created);
  return created;
}

function ask(
  session: Session,
  field: string,
  prompt: string,
  choices?: Array<{ id: string; label: string }>,
  allowOther = true,
): AgentEvent {
  session.pendingField = field;
  return { type: 'ask', field, prompt, choices, allowOther };
}

function parseChoice(message: string): string {
  return message.replace(/^choice:/, '').trim();
}

function parseOperations(message: string): PersonaOperation[] | undefined {
  if (!message.trim().startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const values = (parsed as { operations?: unknown }).operations;
  if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
    return undefined;
  }
  const operations: PersonaOperation[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const item = value as Record<string, unknown>;
    const op = typeof item.op === 'string' ? item.op : '';
    const persona = typeof item.persona === 'string' ? item.persona.trim() : '';
    if (!isPersonaName(persona)) return undefined;
    if (op === 'createPersona' || op === 'deletePersona') {
      operations.push({ op, persona });
    } else if (op === 'renamePersona') {
      if (typeof item.next !== 'string' || !isPersonaName(item.next)) {
        return undefined;
      }
      operations.push({ op, persona, next: item.next });
    } else if (op === 'deploy') {
      operations.push({
        op,
        persona,
        root: typeof item.root === 'string' ? item.root : undefined,
        global: item.global === true,
        targets: Array.isArray(item.targets)
          ? item.targets.filter(
              (target): target is string => typeof target === 'string',
            )
          : undefined,
      });
    } else if (op === 'save') {
      const kind = item.kind;
      const content = typeof item.content === 'string' ? item.content : '';
      if (
        (kind !== 'agent' && kind !== 'rule' && kind !== 'skill') ||
        !content.trim()
      ) {
        return undefined;
      }
      operations.push({
        op,
        persona,
        kind,
        name: typeof item.name === 'string' ? item.name : undefined,
        file: typeof item.file === 'string' ? item.file : undefined,
        content,
      });
    } else if (op === 'deleteFile') {
      const kind = item.kind;
      if (kind !== 'agent' && kind !== 'rule' && kind !== 'skill') {
        return undefined;
      }
      operations.push({
        op,
        persona,
        kind,
        name: typeof item.name === 'string' ? item.name : undefined,
      });
    } else if (op === 'createSkillFolder') {
      if (typeof item.name !== 'string' || typeof item.dir !== 'string') {
        return undefined;
      }
      operations.push({ op, persona, name: item.name, dir: item.dir });
    } else if (op === 'deleteSkillPath') {
      if (typeof item.name !== 'string' || typeof item.path !== 'string') {
        return undefined;
      }
      operations.push({ op, persona, name: item.name, path: item.path });
    } else if (op === 'renameEntry') {
      if (
        (item.kind !== 'rule' &&
          item.kind !== 'skill' &&
          item.kind !== 'knowledge') ||
        typeof item.current !== 'string' ||
        typeof item.next !== 'string'
      ) {
        return undefined;
      }
      operations.push({
        op,
        persona,
        kind: item.kind,
        current: item.current,
        next: item.next,
      });
    } else if (op === 'push') {
      operations.push({
        op,
        persona,
        tag: typeof item.tag === 'string' ? item.tag : undefined,
      });
    } else if (op === 'pull' || op === 'removeRemote') {
      operations.push({ op, persona });
    } else {
      return undefined;
    }
  }
  return operations;
}

async function handleList(session: Session): Promise<AgentEvent[]> {
  const t = copy(session.locale);
  const ids = await listPersonaIds();
  if (ids.length === 0) {
    return [
      { type: 'text', text: t.listEmpty },
      ask(session, 'createInstead', t.askRole, [
        { id: 'researcher', label: 'Researcher' },
        { id: 'marketer', label: 'Marketer' },
        { id: 'fullstack-developer', label: 'Fullstack Developer' },
      ]),
    ];
  }
  return [
    {
      type: 'text',
      text: `${t.listPrefix}\n${ids.map((id) => `- ${id}`).join('\n')}`,
    },
  ];
}

async function continueCreate(
  session: Session,
  message: string,
): Promise<AgentEvent[]> {
  const t = copy(session.locale);
  const answer = parseChoice(message);
  if (
    session.pendingField === 'role' ||
    session.pendingField === 'createInstead'
  ) {
    session.draft.role = answer;
    session.pendingField = undefined;
    if (
      !session.draft.personaName ||
      !isPersonaName(session.draft.personaName)
    ) {
      session.draft.personaName = acceptedPersonaName(answer);
    }
    return askPersonaName(session);
  }
  if (session.pendingField === 'name') {
    if (isNegative(answer)) {
      session.draft.personaName = undefined;
      return askPersonaName(session);
    }
    if (!isAffirmative(answer)) {
      const name = acceptedPersonaName(answer);
      if (!name) return askPersonaName(session, true);
      session.draft.personaName = name;
    } else if (
      !session.draft.personaName ||
      !isPersonaName(session.draft.personaName)
    ) {
      return askPersonaName(session, true);
    }
    session.pendingField = undefined;
    session.draft.work = session.draft.work ?? '';
    return createNow(session);
  }
  if (session.pendingField === 'work') {
    session.draft.work = answer === 'none' ? '' : answer;
    session.pendingField = undefined;
    return createNow(session);
  }
  if (!session.draft.role) {
    session.intent = 'create';
    const inferredName = extractName(message);
    const inferredRole = inferRole(message);
    const inferredTargets = inferTargets(message);
    if (inferredName) session.draft.personaName = inferredName;
    if (inferredTargets.length > 0) session.draft.targets = inferredTargets;
    if (inferredRole) {
      session.draft.role = inferredRole;
      if (
        !session.draft.personaName ||
        !isPersonaName(session.draft.personaName)
      ) {
        session.draft.personaName = acceptedPersonaName(inferredRole);
      }
      session.draft.work = session.draft.work ?? '';
      return createNow(session);
    }
    return [
      ask(session, 'role', t.askRole, [
        { id: 'researcher', label: 'Researcher' },
        { id: 'marketer', label: 'Marketer' },
        { id: 'fullstack-developer', label: 'Fullstack Developer' },
        { id: 'ui-ux-designer', label: 'UI/UX Designer' },
      ]),
    ];
  }
  return createNow(session);
}

async function createNow(session: Session): Promise<AgentEvent[]> {
  const t = copy(session.locale);
  const role = session.draft.role?.trim();
  if (!role) return [ask(session, 'role', t.askRole)];
  const name = session.draft.personaName?.trim();
  if (!name || !isPersonaName(name)) {
    session.draft.personaName = undefined;
    return askPersonaName(session, true);
  }
  try {
    const created = await createFromInterview({
      role,
      work: session.draft.work ?? '',
      rules: session.draft.rules ?? '',
      locale: session.locale,
      personaName: name,
    });
    session.createdPersona = created.persona;
    session.draft.personaName = created.persona;
    session.intent = 'apply';
    return [
      { type: 'text', text: t.creating },
      {
        type: 'receipt',
        persona: created.persona,
        message: t.created(created.persona),
      },
      askDestination(session),
    ];
  } catch {
    session.draft.personaName = undefined;
    return [{ type: 'text', text: t.failed }, ...askPersonaName(session)];
  }
}

function askDestination(session: Session): AgentEvent {
  const t = copy(session.locale);
  const project = session.draft.projectPath;
  return ask(
    session,
    'dest',
    t.askDest,
    [
      ...(project
        ? [{ id: 'project', label: `${t.project}: ${project}` }]
        : []),
      { id: 'global', label: t.global },
      { id: 'later', label: t.later },
    ],
    Boolean(!project),
  );
}

async function continueApply(
  session: Session,
  message: string,
): Promise<AgentEvent[]> {
  const t = copy(session.locale);
  const answer = parseChoice(message);
  if (session.pendingField === 'dest') {
    session.pendingField = undefined;
    if (answer === 'later') {
      session.draft.later = true;
      return [{ type: 'text', text: t.laterOk }];
    }
    if (answer === 'global') {
      session.draft.global = true;
      session.draft.targets = ['claude', 'chatgpt', 'antigravity'];
      return [confirmApply(session)];
    }
    if (
      answer === 'project' ||
      answer.startsWith('/') ||
      /^[A-Za-z]:\\/.test(answer)
    ) {
      if (answer !== 'project') session.draft.projectPath = answer;
      if (!session.draft.projectPath)
        return [ask(session, 'path', t.askPath, undefined, true)];
      if (session.draft.targets && session.draft.targets.length > 0) {
        return [confirmApply(session)];
      }
      return [ask(session, 'targets', t.askTargets, [...TARGETS], false)];
    }
    session.draft.projectPath = answer;
    if (!session.draft.projectPath)
      return [ask(session, 'path', t.askPath, undefined, true)];
    return [ask(session, 'targets', t.askTargets, [...TARGETS], false)];
  }
  if (session.pendingField === 'path') {
    session.draft.projectPath = answer;
    session.pendingField = undefined;
    return [ask(session, 'targets', t.askTargets, [...TARGETS], false)];
  }
  if (session.pendingField === 'targets') {
    const ids = answer
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => TARGETS.some((target) => target.id === item));
    session.draft.targets = ids.length > 0 ? ids : ['claude', 'cursor'];
    session.pendingField = undefined;
    return [confirmApply(session)];
  }
  if (session.pendingField === 'persona') {
    session.draft.personaName = answer;
    session.pendingField = undefined;
    return [askDestination(session)];
  }

  const ids = await listPersonaIds();
  const mentioned = extractName(message);
  if (mentioned && ids.includes(mentioned))
    session.draft.personaName = mentioned;
  if (!session.draft.personaName && session.createdPersona) {
    session.draft.personaName = session.createdPersona;
  }
  if (!session.draft.personaName) {
    if (ids.length === 0) return handleList(session);
    if (ids.length === 1) session.draft.personaName = ids[0];
    else {
      return [
        ask(
          session,
          'persona',
          t.needPersona,
          ids.map((id) => ({ id, label: id })),
          false,
        ),
      ];
    }
  }
  if (session.draft.personaName && !ids.includes(session.draft.personaName)) {
    return [
      { type: 'text', text: t.unknownPersona(session.draft.personaName) },
    ];
  }
  return [askDestination(session)];
}

function confirmApply(session: Session): AgentEvent {
  const t = copy(session.locale);
  const persona = session.draft.personaName ?? '';
  const global = session.draft.global === true;
  const targets =
    session.draft.targets ??
    (global ? ['claude', 'chatgpt', 'antigravity'] : ['claude']);
  const dest = global ? 'global' : (session.draft.projectPath ?? '');
  const action = rememberAction({
    kind: 'deploy',
    summary: t.confirmApply,
    details: {
      persona,
      destination: dest,
      targets: targets.join(', '),
    },
    deploy: {
      persona,
      project: global ? undefined : session.draft.projectPath,
      global,
      targets,
    },
  });
  return {
    type: 'confirm',
    actionId: action.actionId,
    hash: action.hash,
    title: t.confirmApply,
    summary: action.summary,
    details: action.details,
  };
}

async function handleRead(
  session: Session,
  message: string,
): Promise<AgentEvent[]> {
  const ids = await listPersonaIds();
  const name = extractName(message) ?? session.draft.personaName ?? ids[0];
  if (!name) return handleList(session);
  const listing = await personaSnapshot(name);
  return [
    {
      type: 'text',
      text: JSON.stringify(listing, null, 2),
    },
  ];
}

export async function runAgentChat(
  params: AgentChatParams,
): Promise<AgentChatResult> {
  try {
    return await runAgentChatInner(params);
  } catch {
    const session = sessionOf(params);
    const t = copy(session.locale);
    return {
      sessionId: session.id,
      events: [{ type: 'text', text: t.failed }],
    };
  }
}

async function runAgentChatInner(
  params: AgentChatParams,
): Promise<AgentChatResult> {
  const session = sessionOf(params);
  const message = params.message.trim();
  const t = copy(session.locale);
  const events: AgentEvent[] = [];

  if (!message) {
    return { sessionId: session.id, events: [{ type: 'text', text: t.menu }] };
  }

  const operations = parseOperations(message);
  if (operations) {
    const personas = [
      ...new Set(operations.map((operation) => operation.persona)),
    ];
    const summary =
      session.locale === 'ko'
        ? `${personas.join(', ')} Persona에 ${operations.length}개 변경을 적용합니다.`
        : `Apply ${operations.length} change(s) to Persona ${personas.join(', ')}.`;
    const action = rememberAction({
      kind: 'batch',
      summary,
      details: {
        persona: personas.join(', '),
        changes: String(operations.length),
      },
      operations,
    });
    return {
      sessionId: session.id,
      events: [
        {
          type: 'confirm',
          actionId: action.actionId,
          hash: action.hash,
          title: summary,
          summary,
          details: action.details,
        },
      ],
    };
  }

  if (session.pendingField) {
    if (session.pendingField === 'deletePersona') {
      const name = parseChoice(message);
      session.pendingField = undefined;
      session.draft.personaName = name;
      const action = rememberAction({
        kind: 'delete',
        summary:
          session.locale === 'ko'
            ? `Persona “${name}”을 삭제합니다.`
            : `Delete Persona “${name}”.`,
        details: { persona: name },
        deleteName: name,
      });
      return {
        sessionId: session.id,
        events: [
          {
            type: 'confirm',
            actionId: action.actionId,
            hash: action.hash,
            title: action.summary,
            summary: action.summary,
            details: action.details,
          },
        ],
      };
    }
    if (
      session.intent === 'create' ||
      session.pendingField === 'createInstead'
    ) {
      if (session.pendingField === 'createInstead') session.intent = 'create';
      return {
        sessionId: session.id,
        events: await continueCreate(session, message),
      };
    }
    if (session.intent === 'apply') {
      return {
        sessionId: session.id,
        events: await continueApply(session, message),
      };
    }
  }

  session.intent = classifyIntent(message);
  if (session.intent === 'list') {
    return { sessionId: session.id, events: await handleList(session) };
  }
  if (session.intent === 'remotes') {
    const status = await listPersonaRemoteStatus();
    const text =
      status.personas.length === 0
        ? session.locale === 'ko'
          ? '원격 Persona가 없습니다.'
          : 'No remote Personas are available.'
        : status.personas
            .map(
              (persona) =>
                `- ${persona.persona_id} · revision ${persona.revision}${
                  persona.tag ? ` · ${persona.tag}` : ''
                }`,
            )
            .join('\n');
    return {
      sessionId: session.id,
      events: [{ type: 'text', text }],
    };
  }
  if (session.intent === 'create') {
    return {
      sessionId: session.id,
      events: await continueCreate(session, message),
    };
  }
  if (session.intent === 'apply') {
    return {
      sessionId: session.id,
      events: await continueApply(session, message),
    };
  }
  if (session.intent === 'read') {
    return {
      sessionId: session.id,
      events: await handleRead(session, message),
    };
  }
  if (session.intent === 'delete') {
    const ids = await listPersonaIds();
    const mentioned = extractName(message);
    const name = mentioned && ids.includes(mentioned) ? mentioned : '';
    if (!name) {
      events.push({
        type: 'text',
        text:
          session.locale === 'ko'
            ? '삭제는 확인이 필요합니다. 삭제할 Persona 이름을 알려주세요.'
            : 'Deletion needs confirmation. Name the Persona to delete.',
      });
      if (ids.length > 0) {
        events.push(
          ask(
            session,
            'deletePersona',
            session.locale === 'ko' ? '삭제할 Persona' : 'Persona to delete',
            ids.map((id) => ({ id, label: id })),
            false,
          ),
        );
      }
      return { sessionId: session.id, events };
    }
    const action = rememberAction({
      kind: 'delete',
      summary:
        session.locale === 'ko'
          ? `Persona “${name}”을 삭제합니다.`
          : `Delete Persona “${name}”.`,
      details: { persona: name },
      deleteName: name,
    });
    events.push({
      type: 'confirm',
      actionId: action.actionId,
      hash: action.hash,
      title: action.summary,
      summary: action.summary,
      details: action.details,
    });
    return { sessionId: session.id, events };
  }
  if (session.intent === 'rename') {
    const names = extractRename(message);
    const current = names.current ?? session.draft.personaName;
    const next = names.next;
    if (!current || !next || !isPersonaName(current) || !isPersonaName(next)) {
      return {
        sessionId: session.id,
        events: [
          {
            type: 'text',
            text:
              session.locale === 'ko'
                ? '현재 이름과 새 이름을 알려주세요.'
                : 'Tell me the current name and the new name.',
          },
        ],
      };
    }
    const summary =
      session.locale === 'ko'
        ? `Persona 이름을 “${current}”에서 “${next}”로 변경합니다.`
        : `Rename Persona “${current}” to “${next}”.`;
    const action = rememberAction({
      kind: 'rename',
      summary,
      details: { current, next },
      rename: { current, next },
    });
    return {
      sessionId: session.id,
      events: [
        {
          type: 'confirm',
          actionId: action.actionId,
          hash: action.hash,
          title: summary,
          summary,
          details: action.details,
        },
      ],
    };
  }
  return { sessionId: session.id, events: [{ type: 'text', text: t.menu }] };
}
