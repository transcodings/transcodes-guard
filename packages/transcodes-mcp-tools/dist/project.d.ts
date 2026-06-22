/**
 * Project MCP tool — ported from transcodes-mcp-server's `src/tools/project.ts`.
 *
 * Only `get_project` is carried over (read-only). Console-only configuration
 * tools (`project_pwa_auth_console`) are intentionally not exposed in this
 * plugin. The project is fixed by the TRANSCODES_TOKEN pid claim, never a
 * tool argument, so tenancy cannot be bypassed.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
type AssetStatus = 'available' | 'missing' | 'unreachable';
type PwaAssetsState = 'configured' | 'not_configured_or_missing' | 'partial' | 'unreachable';
type FetchLike = typeof fetch;
export declare function checkProjectAssets(projectId: string, fetcher?: FetchLike): Promise<{
    ok: boolean;
    project_id: string;
    cdn_base_url: string;
    summary: {
        auth_sdk: AssetStatus;
        auth_sdk_ok: boolean;
        pwa_assets: PwaAssetsState;
    };
    assets: ({
        status: AssetStatus;
        http_status: number;
        ok: boolean;
        error?: undefined;
        kind: "auth_sdk" | "pwa_manifest" | "pwa_service_worker";
        required_for: "authentication" | "installable_pwa";
        file: "webworker.js" | "manifest.json" | "sw.js";
        url: string;
    } | {
        status: "unreachable";
        http_status: null;
        ok: boolean;
        error: string;
        kind: "auth_sdk" | "pwa_manifest" | "pwa_service_worker";
        required_for: "authentication" | "installable_pwa";
        file: "webworker.js" | "manifest.json" | "sw.js";
        url: string;
    })[];
    diagnostics: string[];
}>;
export declare function registerProjectTools(server: McpServer): void;
export {};
