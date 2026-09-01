const DEFAULT_BACKEND_URL = 'https://api.transcodesapis.com';

export type GeneratePersonaInput = {
  role: string;
  work: string;
  rules: string;
  locale: 'ko' | 'en';
};

export type GeneratedPersonaEntry = {
  name: string;
  description: string;
  content: string;
};

export type GeneratedPersona = {
  persona_name: string;
  instruction: string;
  rules: GeneratedPersonaEntry[];
  skills: GeneratedPersonaEntry[];
  knowledge_bases: GeneratedPersonaEntry[];
};

type Envelope = {
  payload?: unknown;
  error?: unknown;
  message?: unknown;
};

function errorText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return errorText(record.message) || errorText(record.error);
  }
  return '';
}

function isEntry(value: unknown): value is GeneratedPersonaEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    typeof record.content === 'string'
  );
}

function parseGeneratedPersona(value: unknown): GeneratedPersona {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The Persona generator returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.persona_name !== 'string' ||
    typeof record.instruction !== 'string' ||
    !Array.isArray(record.rules) ||
    !record.rules.every(isEntry) ||
    !Array.isArray(record.skills) ||
    !record.skills.every(isEntry)
  ) {
    throw new Error('The Persona generator returned an invalid response.');
  }
  const knowledgeBases = Array.isArray(record.knowledge_bases)
    ? record.knowledge_bases
    : [];
  if (!knowledgeBases.every(isEntry)) {
    throw new Error('The Persona generator returned an invalid response.');
  }
  return {
    persona_name: record.persona_name,
    instruction: record.instruction,
    rules: record.rules,
    skills: record.skills,
    knowledge_bases: knowledgeBases,
  };
}

export async function generatePersona(
  input: GeneratePersonaInput,
): Promise<GeneratedPersona> {
  const backendUrl = (
    process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL
  ).replace(/\/$/, '');
  const response = await fetch(`${backendUrl}/v1/persona/generate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  let envelope: Envelope;
  try {
    envelope = text ? (JSON.parse(text) as Envelope) : {};
  } catch {
    throw new Error('The Persona generator returned an unreadable response.');
  }
  if (!response.ok) {
    throw new Error(
      errorText(envelope) || 'Could not generate this Persona. Try again.',
    );
  }
  const payload = Array.isArray(envelope.payload) ? envelope.payload[0] : null;
  return parseGeneratedPersona(payload);
}
