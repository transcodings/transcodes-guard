/**
 * Shared RBAC coordinate types for danger-patterns and tool-rules.
 *
 * Every rule (Bash pattern or MCP tool-rule) carries a step-up coordinate that
 * maps onto the Transcodes RBAC model: a `resource` key (e.g. "system") and a
 * CRUD `action`. These feed `createStepupSession({ resource, action })` so the
 * step-up audit log and the project's RBAC permission matrix speak the same
 * language. Resource keys are validated against the live backend at add time
 * (see the MCP tool handlers); the action is constrained to the CRUD enum here.
 */
export const RBAC_ACTIONS = ["create", "read", "update", "delete"];
/** Fallback coordinate for records that predate the RBAC fields. */
export const DEFAULT_RBAC_RESOURCE = "system";
export const DEFAULT_RBAC_ACTION = "update";
export function isRbacAction(value) {
    return (typeof value === "string" && RBAC_ACTIONS.includes(value));
}
/** Coerce a possibly-missing stored action to a valid CRUD action. */
export function coerceRbacAction(value) {
    return isRbacAction(value) ? value : DEFAULT_RBAC_ACTION;
}
/** Coerce a possibly-missing stored resource to a non-empty key. */
export function coerceRbacResource(value) {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : DEFAULT_RBAC_RESOURCE;
}
//# sourceMappingURL=rbac.js.map