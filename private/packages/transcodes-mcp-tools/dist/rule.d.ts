/**
 * Member MCP/bash rule tools — backed by /v1/auth/rule.
 *
 * Read: list_rules, get_rule. Write: create_rule.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerRuleTools(server: McpServer): void;
