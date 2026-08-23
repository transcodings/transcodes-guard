/**
 * Skills leave the machine as one gzipped tar (`bundle.tar.gz` locally;
 * S3 stores it at org/{oid}/skills/{persona}/{revision}/bundle.tar.gz).
 *
 * Agent and Rule files stay content-addressed blobs. Skills are a folder
 * tree that Electron will unpack in one shot — pack and extract must stay
 * dependency-free so the same code runs in the CLI and later in Electron.
 */
import { gunzipSync, gzipSync } from 'node:zlib';

export const SKILLS_BUNDLE_MAX_BYTES = 20 * 1024 * 1024;
export const SKILLS_BUNDLE_FILE_NAME = 'bundle.tar.gz';

const BLOCK = 512;
const MAX_SKILL_FILES = 2000;
const MAX_TAR_BYTES =
  SKILLS_BUNDLE_MAX_BYTES + MAX_SKILL_FILES * (BLOCK - 1) + BLOCK * 2;
const USTAR_MAGIC = Buffer.from('ustar\0');
const USTAR_VERSION = Buffer.from('00');

export type SkillBundleEntry = {
  bundlePath: string;
  bytes: Buffer;
};

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function assertSkillsBundleSize(
  files: ReadonlyArray<{ path: string; size: number }>,
): void {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= SKILLS_BUNDLE_MAX_BYTES) return;
  const largest = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((file) => `  - ${file.path} (${formatMegabytes(file.size)})`)
    .join('\n');
  throw new Error(
    `Skills total ${formatMegabytes(total)} (limit ${formatMegabytes(SKILLS_BUNDLE_MAX_BYTES)}). Delete the largest files before publishing:\n${largest}`,
  );
}

function assertSafeSkillPath(bundlePath: string): string {
  if (!bundlePath || bundlePath.includes('\\') || bundlePath.includes('\0')) {
    throw new Error(`Invalid skill path in bundle: "${bundlePath}".`);
  }
  const parts = bundlePath.split('/');
  if (
    parts[0] !== 'skills' ||
    parts.length < 3 ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(
      `Skill archive entries must stay under skills/<name>/: "${bundlePath}".`,
    );
  }
  return bundlePath;
}

function writeOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8).padStart(length - 1, '0');
  target.write(text, offset, length - 1, 'latin1');
  target[offset + length - 1] = 0;
}

function splitUstarName(bundlePath: string): { name: string; prefix: string } {
  if (Buffer.byteLength(bundlePath, 'utf8') <= 100) {
    return { name: bundlePath, prefix: '' };
  }
  const slash = bundlePath.lastIndexOf('/', 155);
  if (slash <= 0) {
    throw new Error(
      `Skill path is too long for bundle.tar.gz: "${bundlePath}".`,
    );
  }
  const prefix = bundlePath.slice(0, slash);
  const name = bundlePath.slice(slash + 1);
  if (
    Buffer.byteLength(prefix, 'utf8') > 155 ||
    Buffer.byteLength(name, 'utf8') > 100
  ) {
    throw new Error(
      `Skill path is too long for bundle.tar.gz: "${bundlePath}".`,
    );
  }
  return { name, prefix };
}

function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += header[i];
  return sum;
}

function fileHeader(bundlePath: string, size: number): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  const { name, prefix } = splitUstarName(bundlePath);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30; // regular file
  USTAR_MAGIC.copy(header, 257);
  USTAR_VERSION.copy(header, 263);
  if (prefix) header.write(prefix, 345, 155, 'utf8');
  const checksum = headerChecksum(header).toString(8).padStart(6, '0');
  header.write(checksum, 148, 6, 'latin1');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function paddedSize(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

/** Pack skill files into the gzipped tar that S3 stores per revision. */
export function packSkillsBundle(files: readonly SkillBundleEntry[]): Buffer {
  if (files.length === 0) {
    throw new Error('Skills bundle is empty.');
  }
  const chunks: Buffer[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const bundlePath = assertSafeSkillPath(file.bundlePath);
    if (seen.has(bundlePath)) {
      throw new Error(`Duplicate skill path in bundle: "${bundlePath}".`);
    }
    seen.add(bundlePath);
    chunks.push(fileHeader(bundlePath, file.bytes.byteLength));
    chunks.push(file.bytes);
    const pad = paddedSize(file.bytes.byteLength) - file.bytes.byteLength;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(chunks), { level: 6 });
}

function readCString(block: Buffer, offset: number, length: number): string {
  const end = block.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return block.toString('utf8', offset, stop).replace(/\0+$/g, '');
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const raw = readCString(block, offset, length).trim();
  if (!raw) return 0;
  return Number.parseInt(raw, 8);
}

/** Unpack a revision archive into skill files. Rejects zip-slip paths. */
export function unpackSkillsBundle(archive: Buffer): SkillBundleEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_TAR_BYTES });
  } catch {
    throw new Error(
      'Skills archive is invalid or expands beyond the 20 MB skills limit.',
    );
  }
  if (tar.byteLength < BLOCK * 2 || tar.byteLength % BLOCK !== 0) {
    throw new Error('Skills archive is not a valid tar.');
  }

  const files: SkillBundleEntry[] = [];
  const seen = new Set<string>();
  let totalFileBytes = 0;
  let offset = 0;
  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (header.every((byte) => byte === 0)) break;

    const storedChecksum = readOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (
      !Number.isSafeInteger(storedChecksum) ||
      headerChecksum(checksumHeader) !== storedChecksum
    ) {
      throw new Error('Skills archive contains an invalid tar header.');
    }
    const type = header[156];
    const size = readOctal(header, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Skills archive contains an invalid file size.');
    }
    const prefix = readCString(header, 345, 155);
    const name = readCString(header, 0, 100);
    const bundlePath = prefix ? `${prefix}/${name}` : name;
    const dataEnd = offset + paddedSize(size);
    if (dataEnd > tar.byteLength) {
      throw new Error(`Skills archive truncated at "${bundlePath}".`);
    }
    const bytes = Buffer.from(tar.subarray(offset, offset + size));
    offset = dataEnd;

    if (type === 0x35) {
      // directory — ignore, files recreate parents
      continue;
    }
    if (type !== 0 && type !== 0x30) {
      throw new Error(
        `Skills archive contains an unsupported entry "${bundlePath}".`,
      );
    }
    const safePath = assertSafeSkillPath(bundlePath);
    if (seen.has(safePath)) {
      throw new Error(`Skills archive contains duplicate path "${safePath}".`);
    }
    seen.add(safePath);
    totalFileBytes += bytes.byteLength;
    if (totalFileBytes > SKILLS_BUNDLE_MAX_BYTES) {
      throw new Error('Skills archive expands beyond the 20 MB skills limit.');
    }
    files.push({ bundlePath: safePath, bytes });
  }
  if (files.length === 0) {
    throw new Error('Skills archive did not contain any skill files.');
  }
  return files;
}
