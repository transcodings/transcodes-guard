/** Display order for TOOL CATALOG sections (docs + CLI). */
export const TOOL_CATEGORY_ORDER = [
    'Gate & Policies',
    'Meta & Identity',
    'Project',
    'Members',
    'RBAC',
    'Passcode',
    'Auth Devices',
    'Audit',
    'Membership',
    'Platform users',
    'JWK',
];
/**
 * Definition-site helper: infers handler arg types from `inputSchema` and
 * returns the erased shape the registration loop and generators consume.
 */
export function defineTool(def) {
    return def;
}
/** `defineTool` for step-up-protected tools (gate-backend only). */
export function defineProtectedTool(def) {
    return def;
}
/**
 * Generic registration loop — the single `registerTool` call site per
 * package. Protected definitions require `wrapProtected` (the 403 →
 * `STEP_UP_REQUIRED` translation adapter); registering one without it throws
 * loudly at startup rather than shipping a protected tool with no recovery
 * guidance.
 */
export function registerToolDefinitions(server, defs, wrapProtected) {
    for (const def of defs) {
        let handler;
        if (def.stepUp !== undefined) {
            if (wrapProtected === undefined) {
                throw new Error(`transcodes-guard: protected tool ${def.name} registered without a wrapProtected adapter`);
            }
            handler = wrapProtected(def);
        }
        else {
            handler = def.handler;
        }
        server.registerTool(def.name, {
            title: def.title,
            description: def.description,
            inputSchema: def.inputSchema,
        }, 
        // Erased `never`-args signature back to the SDK's callback shape — the
        // definition-site generics (defineTool) already checked the real types.
        handler);
    }
}
//# sourceMappingURL=tool-def.js.map