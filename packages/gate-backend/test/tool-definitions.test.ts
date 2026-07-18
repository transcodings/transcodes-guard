/**
 * Definition-data drift alarms (t5 §3). This suite can see BOTH definition
 * arrays, so it owns the full 1:1 checks between the definition data and
 * every derived table:
 *  - definition names ↔ generated GUARD_TOOL_NAMES
 *  - registration loop wiring (52 registrations, protected wrapped)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  denyByDefaultBackend,
  type ProtectedToolDefinition,
  registerToolDefinitions,
} from '@transcodes-guard/core/contract';
import {
  GUARD_META_TOOL_NAMES,
  GUARD_TOOL_NAMES,
} from '@transcodes-guard/core/patterns';
import { coreToolDefinitions } from '@transcodes-guard/core/server';
import { backendToolDefinitions } from '../src/mcp-tools/definitions.js';

const allDefinitions = [
  ...coreToolDefinitions(denyByDefaultBackend),
  ...backendToolDefinitions,
];

describe('definition data ↔ generated constants drift alarm', () => {
  it('definition names equal GUARD_TOOL_NAMES 1:1', () => {
    assert.deepEqual(
      allDefinitions.map((d) => d.name).sort(),
      [...GUARD_TOOL_NAMES].sort(),
    );
  });

  it('no backend definition is meta', () => {
    for (const def of backendToolDefinitions) {
      assert.equal(def.meta, false, def.name);
      assert.equal(GUARD_META_TOOL_NAMES.has(def.name), false, def.name);
    }
  });

  it('every stepUp declaration carries a full RBAC coordinate (15 tools)', () => {
    const declared = allDefinitions.filter((d) => d.stepUp !== undefined);
    assert.equal(declared.length, 15);
    for (const def of declared) {
      assert.ok(def.stepUp?.resource, def.name);
      assert.ok(def.stepUp?.action, def.name);
    }
  });
});

describe('registration loop wiring', () => {
  function fakeServer(names: string[]): McpServer {
    return {
      registerTool: (name: string) => {
        names.push(name);
      },
    } as unknown as McpServer;
  }

  it('registers all 52 definitions with unique names', () => {
    const names: string[] = [];
    const wrapped: string[] = [];
    registerToolDefinitions(
      fakeServer(names),
      coreToolDefinitions(denyByDefaultBackend),
    );
    registerToolDefinitions(
      fakeServer(names),
      backendToolDefinitions,
      (def: ProtectedToolDefinition) => {
        wrapped.push(def.name);
        return (async () => ({ content: [] })) as never;
      },
    );
    assert.equal(names.length, 52);
    assert.equal(new Set(names).size, 52);
    assert.deepEqual(names.sort(), [...GUARD_TOOL_NAMES].sort());
    assert.deepEqual(
      wrapped.sort(),
      allDefinitions
        .filter((d) => d.stepUp !== undefined)
        .map((d) => d.name)
        .sort(),
    );
  });

  it('a protected definition without wrapProtected throws loudly', () => {
    const protectedDef = backendToolDefinitions.find(
      (d) => d.stepUp !== undefined,
    );
    assert.ok(protectedDef);
    assert.throws(
      () => registerToolDefinitions(fakeServer([]), [protectedDef]),
      /without a wrapProtected adapter/,
    );
  });
});
