/**
 * Persona org-sync backend calls (`/v1/persona`, contract §6). The backend
 * authorizes and hands out presigned URLs; markdown bodies never transit it.
 * Presigned PUT/GET go through plain fetch in persona-sync.ts — request()
 * would attach x-transcodes-token and break the SigV4 signature.
 */
import {
  type Envelope,
  loadStepupConfig,
  request,
  type StepupConfig,
} from '@transcodes-guard/core/stepup';
import type { PersonaKind } from './persona.js';
import { apiError, payloadArray } from './rbac-api.js';

/** One row of `GET /persona` — metadata only, no file list and no bodies. */
export type PersonaListItem = {
  persona_id: string;
  name?: string;
  revision: number;
  file_count: number;
  updated_at: string;
  updated_by_name?: string;
  updated_by_email?: string;
};

export type PersonaDetailFile = {
  kind: PersonaKind;
  name: string;
  path: string;
  sha256: string;
  size: number;
  /** Presigned GET pinned to a versionId — the pull trust anchor is `sha256`, not S3. */
  url: string;
};

export type PersonaDetail = {
  persona_id: string;
  name?: string;
  revision: number;
  updated_at: string;
  updated_by_name?: string;
  updated_by_email?: string;
  files: PersonaDetailFile[];
};

export type PersonaPushFile = {
  kind: PersonaKind;
  name: string;
  path: string;
  sha256: string;
  size: number;
};

export type PersonaPushUpload = {
  sha256: string;
  url: string | null;
  headers: Record<string, string>;
  skip: boolean;
};

export type PushPersonaResponse = {
  uploads: PersonaPushUpload[];
  commit_token: string;
};

/** Mirrors the backend's PERSONA_ERROR_CODES — the branch axis is this, not the HTTP status (three different 409s). */
export type PersonaErrorCode =
  | 'PERSONA_REVISION_MISMATCH'
  | 'PERSONA_COMMIT_TOKEN_INVALID'
  | 'PERSONA_MANIFEST_CONFLICT'
  | 'PERSONA_BLOB_NOT_UPLOADED'
  | 'PERSONA_TAG_ALREADY_EXISTS'
  | 'PERSONA_REVISION_NOT_FOUND';

export type PersonaRevisionItem = {
  revision: number;
  tag?: string | null;
  created_at: string;
  created_by_name?: string;
  created_by_email?: string;
};

export class PersonaApiError extends Error {
  readonly status: number;
  readonly errorCode: PersonaErrorCode | undefined;

  constructor(message: string, status: number, errorCode?: PersonaErrorCode) {
    super(message);
    this.name = 'PersonaApiError';
    this.status = status;
    this.errorCode = errorCode;
  }
}

function readErrorCode(envelope: Envelope): PersonaErrorCode | undefined {
  const data = envelope.data;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return undefined;
  const code = (data as Record<string, unknown>).errorCode;
  return typeof code === 'string' ? (code as PersonaErrorCode) : undefined;
}

function assertOk(envelope: Envelope): void {
  if (envelope.ok) return;
  throw new PersonaApiError(
    apiError(envelope),
    envelope.status,
    readErrorCode(envelope),
  );
}

function payloadObject<T>(envelope: Envelope): T {
  assertOk(envelope);
  const [first] = payloadArray<T>(envelope);
  if (first === undefined) {
    throw new Error('Backend response payload was empty.');
  }
  return first;
}

export function loadPersonaConfig(): StepupConfig {
  return loadStepupConfig();
}

/**
 * The organization's Personas. Authorization is the token's `oid` alone, so
 * this takes no project scope — unlike the RBAC calls, which pass project_id.
 */
export async function fetchPersonaList(
  config: StepupConfig,
): Promise<PersonaListItem[]> {
  const envelope = await request(config, { method: 'GET', path: '/persona' });
  assertOk(envelope);
  return payloadArray<PersonaListItem>(envelope);
}

export async function fetchPersonaDetail(
  config: StepupConfig,
  personaId: string,
): Promise<PersonaDetail> {
  const envelope = await request(config, {
    method: 'GET',
    path: `/persona/${encodeURIComponent(personaId)}`,
  });
  if (envelope.status === 404) {
    // Contract §8: cross-org lookups answer 404 too, so a typo and someone
    // else's Persona are indistinguishable by design.
    throw new PersonaApiError(
      `Persona "${personaId}" does not exist in your organization.`,
      404,
    );
  }
  return payloadObject<PersonaDetail>(envelope);
}

export async function pushPersona(
  config: StepupConfig,
  personaId: string,
  body: { revision: number; files: PersonaPushFile[] },
): Promise<PushPersonaResponse> {
  const envelope = await request(config, {
    method: 'POST',
    path: `/persona/${encodeURIComponent(personaId)}/push`,
    body,
  });
  return payloadObject<PushPersonaResponse>(envelope);
}

export async function commitPersona(
  config: StepupConfig,
  personaId: string,
  commitToken: string,
  tag?: string,
): Promise<{ revision: number }> {
  const envelope = await request(config, {
    method: 'POST',
    path: `/persona/${encodeURIComponent(personaId)}/commit`,
    body: { commit_token: commitToken, tag },
  });
  return payloadObject<{ revision: number }>(envelope);
}

export async function fetchPersonaRevisions(
  config: StepupConfig,
  personaId: string,
): Promise<PersonaRevisionItem[]> {
  const envelope = await request(config, {
    method: 'GET',
    path: `/persona/${encodeURIComponent(personaId)}/revisions`,
  });
  if (envelope.status === 404) {
    throw new PersonaApiError(
      `Persona "${personaId}" does not exist in your organization.`,
      404,
    );
  }
  assertOk(envelope);
  return payloadArray<PersonaRevisionItem>(envelope);
}

export async function fetchPersonaRevisionDetail(
  config: StepupConfig,
  personaId: string,
  ref: string,
): Promise<PersonaDetail> {
  const envelope = await request(config, {
    method: 'GET',
    path: `/persona/${encodeURIComponent(personaId)}/revisions/${encodeURIComponent(ref)}`,
  });
  if (envelope.status === 404) {
    throw new PersonaApiError(
      `Revision or tag "${ref}" not found for Persona "${personaId}".`,
      404,
    );
  }
  return payloadObject<PersonaDetail>(envelope);
}

export async function updatePersonaTag(
  config: StepupConfig,
  personaId: string,
  revision: number,
  tag: string | null,
): Promise<{ revision: number; tag?: string | null }> {
  const envelope = await request(config, {
    method: 'PATCH',
    path: `/persona/${encodeURIComponent(personaId)}/revisions/${revision}/tag`,
    body: { tag },
  });
  return payloadObject<{ revision: number; tag?: string | null }>(envelope);
}
