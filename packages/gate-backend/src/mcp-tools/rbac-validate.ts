/**
 * Hard validation of a rule's RBAC coordinate (resource + action) against the
 * live Transcodes backend, used when adding/updating Bash patterns and MCP
 * tool-rules.
 *
 * The action is constrained to the CRUD enum (create/read/update/delete). The
 * resource MUST match a key returned by `get_resources` for the token's
 * project — this keeps every rule's step-up coordinate aligned with the
 * project's RBAC permission matrix. Validation is fail-CLOSED: if the backend
 * can't be reached or parsed, creation is rejected (the caller chose hard
 * validation), so a rule can never be saved against an unverifiable resource.
 */

import { isRbacAction, RBAC_ACTIONS } from '@transcodes-guard/danger-patterns';
import type { StepupConfig } from '@transcodes-guard/stepup-core';
import { req } from './transcodes-client.js';

export class RbacCoordinateError extends Error {}

/** Pull resource keys out of the (loosely-typed) get_resources body. */
export function extractResourceKeys(data: unknown): string[] {
  const items: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? ((): unknown[] => {
          const rec = data as Record<string, unknown>;
          // NestJS NormalizedResponse uses `payload`; legacy shapes use the rest.
          for (const k of ['payload', 'resources', 'data', 'items', 'result']) {
            if (Array.isArray(rec[k])) return rec[k] as unknown[];
          }
          return [];
        })()
      : [];

  const keys = new Set<string>();
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.trim()) keys.add(item.trim());
      continue;
    }
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const key =
        rec.key ?? rec.resource_key ?? rec.resourceKey ?? rec.name ?? rec.id;
      if (typeof key === 'string' && key.trim()) keys.add(key.trim());
    }
  }
  return [...keys];
}

/**
 * Fetch the project's RBAC resource keys. Returns `null` when the backend is
 * unreachable, returns a non-2xx envelope, or the body can't be parsed into a
 * non-empty key list — i.e. when we cannot prove a resource is valid.
 */
export async function fetchRbacResourceKeys(
  config: StepupConfig,
): Promise<string[] | null> {
  let text: string;
  try {
    text = await req(
      config,
      { method: 'GET', query: { project_id: config.projectId } },
      'get_resources',
    );
  } catch {
    return null;
  }

  let envelope: { ok?: unknown; data?: unknown };
  try {
    envelope = JSON.parse(text) as { ok?: unknown; data?: unknown };
  } catch {
    return null;
  }
  if (envelope.ok !== true) return null;

  const keys = extractResourceKeys(envelope.data);
  return keys.length > 0 ? keys : null;
}

/**
 * Throw `RbacCoordinateError` unless `action` is a CRUD action and `resource`
 * is a known RBAC resource key for the token's project. The caller catches
 * this and surfaces `Rejected: <message>` to the agent.
 */
export async function assertRbacCoordinate(
  config: StepupConfig,
  resource: string,
  action: string,
): Promise<void> {
  if (!isRbacAction(action.trim())) {
    throw new RbacCoordinateError(
      `action must be one of ${RBAC_ACTIONS.join('|')} (got: "${action}")`,
    );
  }

  const keys = await fetchRbacResourceKeys(config);
  if (keys === null) {
    throw new RbacCoordinateError(
      'could not fetch RBAC resources from the backend to validate `resource` ' +
        '(network failure, auth error, empty project resources, or unparseable response). ' +
        'The token is read from ~/.transcodes/config.json (written by the transcodes CLI). ' +
        'If `get_resources` already succeeded, retry after updating the plugin build. ' +
        'Inspect valid resources with the `get_resources` tool.',
    );
  }

  if (!keys.includes(resource.trim())) {
    throw new RbacCoordinateError(
      `resource "${resource}" is not a known RBAC resource for this project. ` +
        `Valid resources: ${keys.join(', ')}. ` +
        'Call `get_resources` to inspect, or create it first with `create_resource`.',
    );
  }
}
