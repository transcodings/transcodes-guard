import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function loadCliPackage(): { name: string; version: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundled `dist/index.js` sits next to `../package.json`. Source lives three
  // levels deeper (`src/commands/transcodes/`).
  const candidates = [
    join(here, '..', 'package.json'),
    join(here, '..', '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate) as { name?: string; version?: string };
      if (
        loaded.name === '@bigstrider/transcodes-cli' &&
        typeof loaded.version === 'string'
      ) {
        return { name: loaded.name, version: loaded.version };
      }
    } catch {
      // try the next path
    }
  }
  throw new Error('cli package.json not found');
}

const pkg = loadCliPackage();

/** npm package name (@bigstrider/transcodes-cli). */
export const CLI_PACKAGE_NAME = pkg.name;

/** Semver published to npm — read from cli/package.json at runtime. */
export const CLI_VERSION = pkg.version;

const NPM_LATEST_URL = `https://registry.npmjs.org/${encodeURIComponent(CLI_PACKAGE_NAME)}/latest`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type VersionCache = { expiresAt: number; latest: string | null };

let versionCache: VersionCache | null = null;

export type CliVersionStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
};

/** Test hook — production never needs to clear the in-process cache. */
export function resetCliVersionCache(): void {
  versionCache = null;
}

/** Compare `major.minor.patch` only. Pre-release suffixes are ignored. */
export function isNpmVersionNewer(latest: string, current: string): boolean {
  const a = parseRelease(latest);
  const b = parseRelease(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

function parseRelease(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function fetchNpmLatest(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(NPM_LATEST_URL, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('version' in body) ||
      typeof body.version !== 'string'
    ) {
      return null;
    }
    return body.version;
  } catch {
    return null;
  }
}

/**
 * Current CLI vs npm `latest`. Failures (offline, timeout, bad payload)
 * return `latest: null` and never throw — the sidebar stays as-is.
 */
export async function getCliVersionStatus(deps?: {
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<CliVersionStatus> {
  const now = deps?.now?.() ?? Date.now();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  if (!versionCache || versionCache.expiresAt <= now) {
    versionCache = {
      expiresAt: now + CACHE_TTL_MS,
      latest: await fetchNpmLatest(fetchImpl),
    };
  }
  const latest = versionCache.latest;
  return {
    current: CLI_VERSION,
    latest,
    updateAvailable: latest !== null && isNpmVersionNewer(latest, CLI_VERSION),
  };
}
