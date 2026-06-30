/**
 * Read-only RBAC fetch for the CLI dashboard — mutations belong in Transcodes Console.
 */
import {
  type Envelope,
  loadStepupConfig,
  request,
  type StepupConfig,
} from '@transcodes-guard/stepup-core';

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

function apiError(envelope: Envelope): string {
  const data = envelope.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.error === 'string' && rec.error) return rec.error;
    if (typeof rec.message === 'string' && rec.message) return rec.message;
  }
  return `Backend request failed (HTTP ${envelope.status})`;
}

function payloadArray<T>(envelope: Envelope): T[] {
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
