import { RBAC_ACTIONS, isRbacAction } from "@transcodes-guard/danger-patterns";
import { req } from "./transcodes-client.js";
export class RbacCoordinateError extends Error {
}
/** Pull resource keys out of the (loosely-typed) get_resources body. */
function extractResourceKeys(data) {
    const items = Array.isArray(data)
        ? data
        : data && typeof data === "object"
            ? (() => {
                const rec = data;
                for (const k of ["resources", "data", "items", "result"]) {
                    if (Array.isArray(rec[k]))
                        return rec[k];
                }
                return [];
            })()
            : [];
    const keys = new Set();
    for (const item of items) {
        if (typeof item === "string") {
            if (item.trim())
                keys.add(item.trim());
            continue;
        }
        if (item && typeof item === "object") {
            const rec = item;
            const key = rec.key ?? rec.resource_key ?? rec.resourceKey ?? rec.name ?? rec.id;
            if (typeof key === "string" && key.trim())
                keys.add(key.trim());
        }
    }
    return [...keys];
}
/**
 * Fetch the project's RBAC resource keys. Returns `null` when the backend is
 * unreachable, returns a non-2xx envelope, or the body can't be parsed into a
 * non-empty key list — i.e. when we cannot prove a resource is valid.
 */
export async function fetchRbacResourceKeys(config) {
    let text;
    try {
        text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "get_resources");
    }
    catch {
        return null;
    }
    let envelope;
    try {
        envelope = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (envelope.ok !== true)
        return null;
    const keys = extractResourceKeys(envelope.data);
    return keys.length > 0 ? keys : null;
}
/**
 * Throw `RbacCoordinateError` unless `action` is a CRUD action and `resource`
 * is a known RBAC resource key for the token's project. The caller catches
 * this and surfaces `Rejected: <message>` to the agent.
 */
export async function assertRbacCoordinate(config, resource, action) {
    if (!isRbacAction(action.trim())) {
        throw new RbacCoordinateError(`action must be one of ${RBAC_ACTIONS.join("|")} (got: "${action}")`);
    }
    const keys = await fetchRbacResourceKeys(config);
    if (keys === null) {
        throw new RbacCoordinateError("could not fetch RBAC resources from the backend to validate `resource`. " +
            "Ensure TRANSCODES_TOKEN is set and the backend is reachable, then retry. " +
            "Inspect valid resources with the `get_resources` tool.");
    }
    if (!keys.includes(resource.trim())) {
        throw new RbacCoordinateError(`resource "${resource}" is not a known RBAC resource for this project. ` +
            `Valid resources: ${keys.join(", ")}. ` +
            `Call \`get_resources\` to inspect, or create it first with \`create_resource\`.`);
    }
}
//# sourceMappingURL=rbac-validate.js.map