/**
 * Read-only RBAC fetch for the CLI dashboard — mutations belong in Transcodes Console.
 */
import {
  type Envelope,
  loadStepupConfig,
  request,
  type StepupConfig,
} from '@transcodes-guard/core/stepup';

export type PermissionLevel = 0 | 1 | 2;
export type CrudAction = 'create' | 'read' | 'update' | 'delete';
export type RolePermissionsMatrix = Record<
  string,
  Partial<Record<CrudAction, PermissionLevel>>
>;

export type RbacResource = {
  id: string;
  key: string;
  name: string;
  description?: string;
};

export type RbacRole = {
  id: string;
  name: string;
  description?: string;
  permissions?: RolePermissionsMatrix;
};

export type RbacSnapshot = {
  resources: RbacResource[];
  roles: RbacRole[];
};

function firstErrorText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 240);
    }
    if (Array.isArray(value)) {
      const joined = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .join('; ');
      if (joined) return joined.slice(0, 240);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      const nested = firstErrorText(
        rec.message,
        rec.error,
        rec.Message,
        rec.Code,
      );
      if (nested) return nested;
    }
  }
  return undefined;
}

export function apiError(envelope: Envelope): string {
  const data = envelope.data;
  const rec =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  const rawText = typeof data === 'string' ? data : undefined;
  const cloudfrontBlocked =
    envelope.status === 403 &&
    typeof rawText === 'string' &&
    rawText.includes('The request could not be satisfied');
  if (cloudfrontBlocked) {
    return (
      'Backend request failed (HTTP 403): CloudFront/WAF blocked this upload. ' +
      'The Persona file list is larger than the ~8KB POST body limit. ' +
      'Publish a smaller Persona, or raise the API WAF body-size / oversize rule.'
    );
  }
  const detail =
    typeof data === 'string'
      ? firstErrorText(data)
      : firstErrorText(rec?.error, rec?.message);
  const logId = firstErrorText(rec?.logId);
  const status =
    envelope.status > 0 ? `HTTP ${envelope.status}` : 'network error';
  if (!detail) {
    return (
      `Backend request failed (${status}). ` +
      'The server returned no JSON error body — often a proxy, WAF, or S3 denial.'
    );
  }
  return logId
    ? `Backend request failed (${status}): ${detail} (logId ${logId})`
    : `Backend request failed (${status}): ${detail}`;
}

export function payloadArray<T>(envelope: Envelope): T[] {
  if (!envelope.ok) throw new Error(apiError(envelope));
  const root = envelope.data;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  const rec = root as Record<string, unknown>;
  if (rec.success === false) {
    throw new Error(String(rec.error ?? 'request failed'));
  }
  const payload = rec.payload;
  return Array.isArray(payload) ? (payload as T[]) : [];
}

export function loadRbacConfig(): StepupConfig {
  return loadStepupConfig();
}

export async function fetchRbacSnapshot(
  config: StepupConfig,
): Promise<RbacSnapshot> {
  const query = { project_id: config.projectId };
  const [rolesEnv, resourcesEnv] = await Promise.all([
    request(config, { method: 'GET', path: '/auth/roles', query }),
    request(config, { method: 'GET', path: '/auth/resources', query }),
  ]);
  return {
    roles: payloadArray<RbacRole>(rolesEnv),
    resources: payloadArray<RbacResource>(resourcesEnv),
  };
}
