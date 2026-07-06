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
export declare const RBAC_ACTIONS: readonly ["create", "read", "update", "delete"];
export type RbacAction = (typeof RBAC_ACTIONS)[number];
/** Fallback coordinate for records that predate the RBAC fields. */
export declare const DEFAULT_RBAC_RESOURCE = "system";
export declare const DEFAULT_RBAC_ACTION: RbacAction;
export declare function isRbacAction(value: unknown): value is RbacAction;
/** Coerce a possibly-missing stored action to a valid CRUD action. */
export declare function coerceRbacAction(value: unknown): RbacAction;
/** Coerce a possibly-missing stored resource to a non-empty key. */
export declare function coerceRbacResource(value: unknown): string;
