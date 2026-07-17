/**
 * Aggregate of every gate-backend tool definition, in registration order.
 *
 * Imported by `registerBackendTools()` for registration and by the codegen
 * pipeline (`scripts/tool-metadata.mts`) for metadata — handlers are never
 * invoked at codegen time.
 */
import type { GuardToolDefinition } from '@transcodes-guard/core/contract';
export declare const backendToolDefinitions: readonly GuardToolDefinition[];
