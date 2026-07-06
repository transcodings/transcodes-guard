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
export type ProjectOriginConfig = {
    domain_url?: unknown;
    authentication?: {
        related_origins?: unknown;
    };
};
type FetchLike = typeof fetch;
export declare function checkRelatedOriginRegistration(project: ProjectOriginConfig, redirectUriOrOrigin: string): {
    ok: boolean;
    message: string;
    checked_origin?: undefined;
    registered_origins?: undefined;
    source?: undefined;
    diagnostics?: undefined;
    next_action?: undefined;
} | {
    ok: boolean;
    checked_origin: string;
    registered_origins: string[];
    source: {
        domain_url: {} | null;
        domain_url_origin: string | null;
        domain_url_counts_as_redirect_origin: boolean;
        related_origins: any[];
        ignored_related_origins: unknown[];
        auth_host_origins: string[];
    };
    diagnostics: string[];
    next_action: {
        add_related_origin: string;
        console_path: string;
    } | null;
    message?: undefined;
};
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
