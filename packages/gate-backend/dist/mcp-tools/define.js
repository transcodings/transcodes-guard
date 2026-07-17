export function defineBackendTool(def) {
    return def;
}
export function defineProtectedBackendTool(def) {
    return def;
}
/** Shared text-content result shape for backend tool handlers. */
export function textResult(text, isError = false) {
    return {
        isError,
        content: [{ type: 'text', text }],
    };
}
//# sourceMappingURL=define.js.map