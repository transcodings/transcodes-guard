/**
 * Persona push/pull sync domain — hashing, manifest compare, transfer, state.
 *
 * Hashes are computed over raw disk bytes (contract §2): readPersonaFile()
 * normalizes content and must never be used here. Backend calls ride
 * persona-api; presigned PUT/GET use plain fetch — request() would attach
 * x-transcodes-token and break the SigV4 signature.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '@transcodes-guard/core/paths';
import {
  assertKnowledgeBaseBundleFiles,
  assertPersonaId,
  collectPersonaFiles,
  replacePersonaBundleFiles,
} from './persona.js';
import {
  commitPersona,
  fetchPersonaDetail,
  fetchPersonaRevisionDetail,
  fetchPersonaRevisions,
  loadPersonaConfig,
  PersonaApiError,
  type PersonaErrorCode,
  type PersonaPushFile,
  type PushPersonaResponse,
  pushPersona,
  updatePersonaTag,
} from './persona-api.js';
import {
  assertSkillsBundleSize,
  packSkillsBundle,
  unpackSkillsBundle,
} from './persona-skill-bundle.js';

/**
 * Last-synced revision per Persona. Lives under dataDir() next to
 * dashboard-persona.json — never under ~/.transcodes/personas/, where it
 * would be mistaken for user content and swept into the sync itself.
 */
const SYNC_STATE_FILE = 'persona-sync.json';
const SYNC_STATE_LOCK_FILE = `${SYNC_STATE_FILE}.lock`;
const SYNC_STATE_LOCK_STALE_MS = 30_000;
const SYNC_STATE_LOCK_RETRIES = 100;

export type PersonaSyncEntry = {
  revision: number;
  synced_at: string;
  /**
   * Bundle content hash at the moment of the last push/pull. Comparing it to
   * the current hash tells local edits apart from a bundle that merely sits
   * on an older revision — the axis the revision number alone cannot see.
   */
  content_hash?: string;
};

type SyncState = {
  personas: Record<string, PersonaSyncEntry>;
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
  /** Where overwritten local files were copied, or null when nothing differed. */
  backup_dir: string | null;
};

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * One digest over the whole bundle: sorted `path\nsha256\n` lines. Order
 * independence matters because collectPersonaFiles gives directory order,
 * which can differ across machines for identical content.
 */
export function bundleContentHash(
  files: Array<{ path: string; sha256: string }>,
): string {
  const lines = files
    .map((file) => `${file.path}\n${file.sha256}\n`)
    .sort()
    .join('');
  return sha256Hex(Buffer.from(lines));
}

async function collectLocalDigests(
  persona: string,
): Promise<Array<{ path: string; sha256: string }>> {
  const collected = await collectPersonaFiles(persona);
  const local: Array<{ path: string; sha256: string }> = [];
  for (const file of collected) {
    local.push({
      path: file.bundlePath,
      sha256: sha256Hex(await readFile(file.absolutePath)),
    });
  }
  return local;
}

/**
 * Current bundle hash per local Persona. The dashboard combines this with the
 * stored sync entries to classify each Persona (behind / edited / conflict /
 * current) without any network round trip.
 */
export async function computePersonaContentHash(
  personaInput: string,
): Promise<string | null> {
  const persona = assertPersonaId(personaInput);
  const local = await collectLocalDigests(persona);
  if (local.length === 0) return null;
  return bundleContentHash(local);
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
    case 'PERSONA_REVISION_NOT_FOUND':
      return (
        'No revision matches that number. ' +
        `Run \`transcodes persona log --persona ${persona}\` to list available revisions.`
      );
    default:
      return undefined;
  }
}

function withGuidance(persona: string, error: unknown): Error {
  if (error instanceof PersonaApiError) {
    const guidance = personaSyncGuidance(persona, error.errorCode);
    if (guidance) {
      return new PersonaApiError(
        `${guidance} (backend: ${error.message})`,
        error.status,
        error.errorCode,
      );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

function syncStateFile(): string {
  return path.join(dataDir(), SYNC_STATE_FILE);
}

function syncStateLockFile(): string {
  return path.join(dataDir(), SYNC_STATE_LOCK_FILE);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSyncStateLock<T>(work: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(syncStateFile()), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  for (let attempt = 0; attempt < SYNC_STATE_LOCK_RETRIES; attempt += 1) {
    try {
      handle = await open(syncStateLockFile(), 'wx');
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(syncStateLockFile());
        if (Date.now() - lockStat.mtimeMs > SYNC_STATE_LOCK_STALE_MS) {
          await rm(syncStateLockFile(), { force: true });
          continue;
        }
      } catch {
        continue;
      }
      await wait(20);
    }
  }

  if (!handle) {
    throw new Error('Timed out waiting to update Persona sync state.');
  }

  try {
    return await work();
  } finally {
    await handle.close().catch(() => {});
    await rm(syncStateLockFile(), { force: true }).catch(() => {});
  }
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

/**
 * Which revision this machine last synced, per Persona. Push and pull already
 * keep it; exposing it lets the dashboard put the organization's revision next
 * to this device's without running a pull to find out.
 */
export async function readPersonaSyncRevisions(): Promise<
  SyncState['personas']
> {
  return (await readSyncState()).personas;
}

async function writeSyncRevision(
  persona: string,
  revision: number,
  contentHash: string,
): Promise<void> {
  await withSyncStateLock(async () => {
    const state = await readSyncState();
    state.personas[persona] = {
      revision,
      synced_at: new Date().toISOString(),
      content_hash: contentHash,
    };
    const temporary = `${syncStateFile()}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, syncStateFile());
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  });
}

export async function clearPersonaSyncRevision(
  personaInput: string,
): Promise<void> {
  const persona = assertPersonaId(personaInput);
  await withSyncStateLock(async () => {
    const state = await readSyncState();
    if (!(persona in state.personas)) return;
    delete state.personas[persona];
    const temporary = `${syncStateFile()}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, syncStateFile());
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  });
}

/**
 * Copy the whole local bundle to a timestamped folder under dataDir() before
 * pull overwrites anything. Lives outside ~/.transcodes/personas/ so Apply
 * and push never see it as user content.
 */
async function backupPersonaBundle(persona: string): Promise<string | null> {
  const collected = await collectPersonaFiles(persona);
  if (collected.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir(), 'persona-backups', persona, stamp);
  for (const file of collected) {
    const target = path.join(backupDir, file.bundlePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file.absolutePath, target);
  }
  return backupDir;
}

/** S3/WAF bodies are XML or HTML — surface Code/Message when present. */
function formatHttpErrorBody(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const code = text.match(/<Code>([^<]+)<\/Code>/i)?.[1];
  const message = text.match(/<Message>([^<]+)<\/Message>/i)?.[1];
  if (code || message) {
    return ` ${[code, message].filter(Boolean).join(' — ')}`;
  }
  return ` ${text.slice(0, 180)}`;
}

/**
 * Push the whole bundle: declare digests, upload only what the server does
 * not already have, then commit. The revision sent is the last one this
 * machine synced (default 0) — asking the server for its current revision
 * instead would defeat the lost-update check.
 */

export function normalizeOptionalPersonaTag(
  tagInput: string | undefined,
): string | undefined {
  const tag = tagInput?.trim() ?? '';
  if (!tag) return undefined;
  if (tag.length > 100) {
    throw new Error('Tag must be 100 characters or fewer.');
  }
  return tag;
}

export async function pushPersonaSync(
  personaInput: string,
  tagInput?: string,
): Promise<PushSyncResult> {
  const persona = assertPersonaId(personaInput);
  const tag = normalizeOptionalPersonaTag(tagInput);
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
  const skillEntries: Array<{ bundlePath: string; bytes: Buffer }> = [];
  for (const file of collected) {
    const bytes = await readFile(file.absolutePath);
    const sha256 = sha256Hex(bytes);
    if (file.kind !== 'skill') {
      bytesByDigest.set(sha256, bytes);
    } else {
      skillEntries.push({ bundlePath: file.bundlePath, bytes });
    }
    files.push({
      kind: file.kind,
      name: file.name,
      path: file.bundlePath,
      sha256,
      size: bytes.byteLength,
    });
  }

  assertKnowledgeBaseBundleFiles(files);
  assertSkillsBundleSize(
    files
      .filter((file) => file.kind === 'skill')
      .map((file) => ({ path: file.path, size: file.size })),
  );

  let skillsArchive: { sha256: string; size: number } | undefined;
  if (skillEntries.length > 0) {
    const archive = packSkillsBundle(skillEntries);
    const sha256 = sha256Hex(archive);
    bytesByDigest.set(sha256, archive);
    skillsArchive = { sha256, size: archive.byteLength };
  }

  const state = await readSyncState();
  const revision = state.personas[persona]?.revision ?? 0;

  let approved: PushPersonaResponse;
  try {
    approved = await pushPersona(config, persona, {
      revision,
      files,
      ...(skillsArchive ? { skills_archive: skillsArchive } : {}),
    });
  } catch (error) {
    throw withGuidance(persona, error);
  }

  let uploaded = 0;
  let skipped = 0;
  for (const upload of approved.uploads) {
    if (upload.skip) {
      skipped += 1;
      continue;
    }
    if (!upload.url) {
      // skip:false without a URL is a contract violation — silently counting it
      // as skipped would loop push→PERSONA_BLOB_NOT_UPLOADED forever.
      throw new Error(
        `Push approval for digest ${upload.sha256} has no upload URL; nothing was committed.`,
      );
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
      const body = await response.text().catch(() => '');
      throw new Error(
        `Upload failed (HTTP ${response.status}) for digest ${upload.sha256}; nothing was committed.${formatHttpErrorBody(body)}`,
      );
    }
    uploaded += 1;
  }

  let committed: { revision: number };
  try {
    committed = await commitPersona(
      config,
      persona,
      approved.commit_token,
      tag,
    );
  } catch (error) {
    throw withGuidance(persona, error);
  }
  // What just went up is exactly what is on disk, so the stored hash equals
  // the current hash and the Persona reads as "up to date".
  try {
    await writeSyncRevision(
      persona,
      committed.revision,
      bundleContentHash(
        files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      ),
    );
  } catch (error) {
    throw new Error(
      `Shared Persona "${persona}" as v${committed.revision}, but could not save the local sync state. Get latest before sharing again. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

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
  ref?: string,
): Promise<PullSyncResult> {
  const persona = assertPersonaId(personaInput);
  const config = loadPersonaConfig();

  const detail = ref
    ? await fetchPersonaRevisionDetail(config, persona, ref)
    : await fetchPersonaDetail(config, persona);

  const local = await collectLocalDigests(persona);

  const plan = planPull(detail.files, local);
  const download = new Set(plan.download);
  const replacements: Array<{ bundlePath: string; bytes: Buffer }> = [];
  const archive = detail.skills_archive;
  const skillPaths = new Set(
    detail.files
      .filter(
        (file) => file.kind === 'skill' || file.path.startsWith('skills/'),
      )
      .map((file) => file.path),
  );
  const needSkillsArchive =
    !!archive?.url && [...download].some((path) => skillPaths.has(path));

  if (needSkillsArchive && archive?.url) {
    const response = await fetch(archive.url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Download failed (HTTP ${response.status}) for skills/bundle.tar.gz. No local files were changed.${formatHttpErrorBody(body)}`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256Hex(bytes);
    if (digest !== archive.sha256) {
      throw new Error(
        `Digest mismatch for skills/bundle.tar.gz: expected ${archive.sha256}, got ${digest}. No local files were changed.`,
      );
    }
    const extracted = unpackSkillsBundle(bytes);
    const expected = new Map(
      detail.files
        .filter((file) => skillPaths.has(file.path))
        .map((file) => [file.path, file.sha256]),
    );
    for (const file of extracted) {
      const want = expected.get(file.bundlePath);
      if (!want) {
        throw new Error(
          `Unexpected file ${file.bundlePath} inside skills/bundle.tar.gz. No local files were changed.`,
        );
      }
      if (sha256Hex(file.bytes) !== want) {
        throw new Error(
          `Digest mismatch for ${file.bundlePath} inside skills/bundle.tar.gz. No local files were changed.`,
        );
      }
      expected.delete(file.bundlePath);
      replacements.push(file);
    }
    if (expected.size > 0) {
      throw new Error(
        `Missing file ${expected.keys().next().value} inside skills/bundle.tar.gz. No local files were changed.`,
      );
    }
  }

  for (const file of detail.files) {
    if (!download.has(file.path)) continue;
    if (needSkillsArchive && skillPaths.has(file.path)) continue;
    const response = await fetch(file.url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Download failed (HTTP ${response.status}) for ${file.path}. No local files were changed.${formatHttpErrorBody(body)}`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256Hex(bytes);
    if (digest !== file.sha256) {
      throw new Error(
        `Digest mismatch for ${file.path}: expected ${file.sha256}, got ${digest}. No local files were changed.`,
      );
    }
    replacements.push({ bundlePath: file.path, bytes });
  }

  // Pull never merges, so a local file about to be replaced is the only copy
  // of whatever was edited here. Back the bundle up first — the user can
  // re-apply from the backup instead of losing the work silently.
  const localPaths = new Set(local.map((file) => file.path));
  const overwrites = plan.download.some((file) => localPaths.has(file));
  const backupDir = overwrites ? await backupPersonaBundle(persona) : null;

  if (replacements.length > 0) {
    await replacePersonaBundleFiles(persona, replacements);
  }

  // The baseline is the remote manifest, not the post-pull directory. Files
  // kept only on this device must continue to classify as local edits so the
  // dashboard offers Share instead of incorrectly claiming "Up to date".
  try {
    await writeSyncRevision(
      persona,
      detail.revision,
      bundleContentHash(detail.files),
    );
  } catch (error) {
    throw new Error(
      `Downloaded Persona "${persona}" v${detail.revision}, but could not save the local sync state. Refresh and Get latest again before sharing. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    persona,
    revision: detail.revision,
    downloaded: plan.download,
    unchanged: plan.unchanged,
    local_only: plan.localOnly,
    backup_dir: backupDir,
  };
}
