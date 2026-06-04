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
import { type StepupConfig } from "@transcodes-guard/stepup-core";
export declare class RbacCoordinateError extends Error {
}
/**
 * Fetch the project's RBAC resource keys. Returns `null` when the backend is
 * unreachable, returns a non-2xx envelope, or the body can't be parsed into a
 * non-empty key list — i.e. when we cannot prove a resource is valid.
 */
export declare function fetchRbacResourceKeys(config: StepupConfig): Promise<string[] | null>;
/**
 * Throw `RbacCoordinateError` unless `action` is a CRUD action and `resource`
 * is a known RBAC resource key for the token's project. The caller catches
 * this and surfaces `Rejected: <message>` to the agent.
 */
export declare function assertRbacCoordinate(config: StepupConfig, resource: string, action: string): Promise<void>;
