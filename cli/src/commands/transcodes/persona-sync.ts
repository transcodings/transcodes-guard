/**
 * Persona push/pull sync domain — hashing, manifest compare, transfer, state.
 *
 * Hashes are computed over raw disk bytes (contract §2): readPersonaFile()
 * normalizes content and must never be used here. Backend calls ride
 * persona-api; presigned PUT/GET use plain fetch — request() would attach
 * x-transcodes-token and break the SigV4 signature.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '@transcodes-guard/core/paths';
import {
  assertPersonaId,
  collectPersonaFiles,
  writePersonaBundleFile,
} from './persona.js';
import {
  commitPersona,
  fetchPersonaDetail,
  loadPersonaConfig,
  PersonaApiError,
  type PersonaErrorCode,
  type PersonaPushFile,
  type PushPersonaResponse,
  pushPersona,
} from './persona-api.js';

/**
 * Last-synced revision per Persona. Lives under dataDir() next to
 * dashboard-persona.json — never under ~/.transcodes/personas/, where it
 * would be mistaken for user content and swept into the sync itself.
 */
const SYNC_STATE_FILE = 'persona-sync.json';

type SyncState = {
  personas: Record<string, { revision: number; synced_at: string }>;
};

export type PushSyncResult = {
  persona: string;
  revision: number;
  files: number;
  uploaded: number;
  skipped: number;
};

export type PullSyncResult = {
  persona: string;
  revision: number;
  downloaded: string[];
  unchanged: string[];
  /** Present locally but absent from the manifest — reported, never deleted. */
  local_only: string[];
};

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Decide per manifest path what pull must do. Pure so it is unit-testable:
 * digests equal → unchanged, differing or missing locally → download, and
 * local files outside the manifest are reported as localOnly (user decision:
 * pull never deletes).
 */
export function planPull(
  manifest: Array<{ path: string; sha256: string }>,
  local: Array<{ path: string; sha256: string }>,
): { download: string[]; unchanged: string[]; localOnly: string[] } {
  const localByPath = new Map(local.map((file) => [file.path, file.sha256]));
  const manifestPaths = new Set(manifest.map((file) => file.path));
  const download: string[] = [];
  const unchanged: string[] = [];
  for (const file of manifest) {
    if (localByPath.get(file.path) === file.sha256) unchanged.push(file.path);
    else download.push(file.path);
  }
  const localOnly = local
    .filter((file) => !manifestPaths.has(file.path))
    .map((file) => file.path);
  return { download, unchanged, localOnly };
}

/**
 * Translate a backend errorCode into the next command to run (contract §7-a).
 * Three conflicts share HTTP 409, so the branch axis is the code.
 */
export function personaSyncGuidance(
  persona: string,
  errorCode: PersonaErrorCode | undefined,
): string | undefined {
  switch (errorCode) {
    case 'PERSONA_REVISION_MISMATCH':
    case 'PERSONA_MANIFEST_CONFLICT':
      return (
        `Persona "${persona}" changed on the server. ` +
        `Run \`transcodes persona pull --persona ${persona}\` first; local files were not modified.`
      );
    case 'PERSONA_COMMIT_TOKEN_INVALID':
      return (
        'The push approval expired or was already used. ' +
        `Run \`transcodes persona push --persona ${persona}\` again.`
      );
    case 'PERSONA_BLOB_NOT_UPLOADED':
      return (
        'Some files were never uploaded to storage. ' +
        `Run \`transcodes persona push --persona ${persona}\` again and let every upload finish.`
      );
    default:
      return undefined;
  }
}

function withGuidance(persona: string, error: unknown): Error {
  if (error instanceof PersonaApiError) {
    const guidance = personaSyncGuidance(persona, error.errorCode);
    if (guidance) return new Error(`${guidance} (backend: ${error.message})`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function syncStateFile(): string {
  return path.join(dataDir(), SYNC_STATE_FILE);
}

async function readSyncState(): Promise<SyncState> {
  try {
    const raw = await readFile(syncStateFile(), 'utf-8');
    const parsed = JSON.parse(raw) as SyncState;
    if (parsed && typeof parsed.personas === 'object' && parsed.personas) {
      return parsed;
    }
  } catch {
    // fall through — missing or corrupt state means "never synced"
  }
  return { personas: {} };
}

async function writeSyncRevision(
  persona: string,
  revision: number,
): Promise<void> {
  const state = await readSyncState();
  state.personas[persona] = {
    revision,
    synced_at: new Date().toISOString(),
  };
  await mkdir(path.dirname(syncStateFile()), { recursive: true });
  await writeFile(syncStateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Push the whole bundle: declare digests, upload only what the server does
 * not already have, then commit. The revision sent is the last one this
 * machine synced (default 0) — asking the server for its current revision
 * instead would defeat the lost-update check.
 */
export async function pushPersonaSync(
  personaInput: string,
): Promise<PushSyncResult> {
  const persona = assertPersonaId(personaInput);
  const config = loadPersonaConfig();

  const collected = await collectPersonaFiles(persona);
  if (collected.length === 0) {
    throw new Error(
      `Persona "${persona}" has no files to push. ` +
        `Create it with \`transcodes persona create ${persona}\` first.`,
    );
  }

  const files: PersonaPushFile[] = [];
  const bytesByDigest = new Map<string, Buffer>();
  for (const file of collected) {
    const bytes = await readFile(file.absolutePath);
    const sha256 = sha256Hex(bytes);
    bytesByDigest.set(sha256, bytes);
    files.push({
      kind: file.kind,
      name: file.name,
      path: file.bundlePath,
      sha256,
      size: bytes.byteLength,
    });
  }

  const state = await readSyncState();
  const revision = state.personas[persona]?.revision ?? 0;

  let approved: PushPersonaResponse;
  try {
    approved = await pushPersona(config, persona, { revision, files });
  } catch (error) {
    throw withGuidance(persona, error);
  }

  let uploaded = 0;
  let skipped = 0;
  for (const upload of approved.uploads) {
    if (upload.skip || !upload.url) {
      skipped += 1;
      continue;
    }
    const bytes = bytesByDigest.get(upload.sha256);
    if (!bytes) {
      throw new Error(
        `Push approval references an unknown digest ${upload.sha256}; nothing was committed.`,
      );
    }
    const response = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: bytes,
    });
    if (response.status === 412) {
      // If-None-Match hit: the content-addressed blob already exists — success.
      skipped += 1;
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Upload failed (HTTP ${response.status}) for digest ${upload.sha256}; nothing was committed.`,
      );
    }
    uploaded += 1;
  }

  let committed: { revision: number };
  try {
    committed = await commitPersona(config, persona, approved.commit_token);
  } catch (error) {
    throw withGuidance(persona, error);
  }
  await writeSyncRevision(persona, committed.revision);

  return {
    persona,
    revision: committed.revision,
    files: files.length,
    uploaded,
    skipped,
  };
}

/**
 * Pull one consistent snapshot: the detail response pins every presigned GET
 * to a versionId, and each downloaded file is re-hashed against the
 * manifest digest before it is written (trust anchor is Mongo, not S3).
 * Bytes are written verbatim — normalizing would break the digest contract.
 */
export async function pullPersonaSync(
  personaInput: string,
): Promise<PullSyncResult> {
  const persona = assertPersonaId(personaInput);
  const config = loadPersonaConfig();

  const detail = await fetchPersonaDetail(config, persona);

  const collected = await collectPersonaFiles(persona);
  const local: Array<{ path: string; sha256: string }> = [];
  for (const file of collected) {
    local.push({
      path: file.bundlePath,
      sha256: sha256Hex(await readFile(file.absolutePath)),
    });
  }

  const plan = planPull(detail.files, local);
  const download = new Set(plan.download);
  for (const file of detail.files) {
    if (!download.has(file.path)) continue;
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(
        `Download failed (HTTP ${response.status}) for ${file.path}.`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256Hex(bytes);
    if (digest !== file.sha256) {
      throw new Error(
        `Digest mismatch for ${file.path}: expected ${file.sha256}, got ${digest}. The file was not written.`,
      );
    }
    await writePersonaBundleFile(persona, file.path, bytes);
  }
  await writeSyncRevision(persona, detail.revision);

  return {
    persona,
    revision: detail.revision,
    downloaded: plan.download,
    unchanged: plan.unchanged,
    local_only: plan.localOnly,
  };
}
