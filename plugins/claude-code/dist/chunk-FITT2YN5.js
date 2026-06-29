var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// host.ts
process.env.TRANSCODES_GUARD_HOST = "claude";

// ../../packages/gate-contract/dist/types.js
var GATE_DECISION_KIND = {
  PROCEED_UNGATED: "proceed-ungated",
  PROCEED_BY_POLICY: "proceed-by-policy",
  PROCEED_BY_VERIFICATION: "proceed-by-verification",
  BLOCK_NO_TOKEN: "block-no-token",
  BLOCK_BY_POLICY: "block-by-policy",
  BLOCK_STEPUP_CREATE_FAILED: "block-stepup-create-failed",
  BLOCK_STEPUP_CHALLENGED: "block-stepup-challenged"
};

// ../../packages/gate-contract/dist/messages.js
function formatNoTokenSessionNotice() {
  return [
    "transcodes-guard: no Transcodes token is configured.",
    "Danger commands will be BLOCKED and step-up MFA cannot start until a token is set.",
    "",
    "How to fix (guide the user \u2014 the token must NOT be pasted into this chat,",
    "it would leak into the transcript):",
    "",
    "  RECOMMENDED \u2014 install the CLI once, then enter the token in the dashboard:",
    "    1. npm install -g @bigstrider/transcodes-cli",
    "    2. transcodes        (opens the dashboard at your local device browser)",
    "    3. Paste the token from the Transcodes console \u2192 member detail page",
    "       (https://app.transcodes.io) into the dashboard.",
    "  Saved to ~/.transcodes/config.json so every agent session can find it.",
    "",
    "  Non-interactive alternative (same store, e.g. for scripts):",
    "    transcodes set <token> -l <label>"
  ].join("\n");
}
function formatBlockedSummary(block) {
  return [
    "\u26D4 BLOCKED \u2014 Bash was NOT executed.",
    "",
    `Reason : ${block.reason}`,
    ...block.details && block.details.length > 0 ? ["", "Affected:", ...block.details.map((d) => `  - ${d}`)] : [],
    `Command: ${block.command}`
  ].join("\n");
}
function formatAllowReason(decision) {
  return `transcodes-guard: step-up MFA verified \u2014 overriding default permission policy. Original danger match: ${decision.block.reason}. Command: ${decision.block.command}`;
}
function formatNoTokenReason(block) {
  return `Bash blocked by transcodes-guard: ${block.reason}. Step-up MFA gate is not configured (no Transcodes token found). Tell the user to install the CLI (\`npm install -g @bigstrider/transcodes-cli\`) and run \`transcodes\` to open the dashboard and paste a token from the Transcodes console (member detail page, https://app.transcodes.io). Non-interactive: \`transcodes set <token> -l <label>\`. Or run the command outside the agent.`;
}
function formatNoTokenSystemMessage(block) {
  return `${formatBlockedSummary(block)}

Step-up MFA gate is not configured (no Transcodes token found).
Ask the user to install the CLI (\`npm install -g @bigstrider/transcodes-cli\`), run
\`transcodes\` to open the dashboard, and paste a token from the Transcodes console \u2192
member detail page (https://app.transcodes.io). Non-interactive: \`transcodes set <token>
-l <label>\`. Then retry. Do not have the user paste the token into this chat.`;
}
function formatRbacDeniedReason(decision) {
  return `Blocked by transcodes-guard: ${decision.block.reason}. Your RBAC role denies this action (resource="${decision.resource}", action="${decision.action}") \u2014 step-up MFA cannot grant it. Report this to the user; do not retry. An admin must grant the permission in the Transcodes console (RBAC \u2192 Roles).`;
}
function formatRbacDeniedSystemMessage(decision) {
  return [
    formatBlockedSummary(decision.block),
    "",
    `RBAC permission DENIED \u2014 resource="${decision.resource}", action="${decision.action}".`,
    "Your role has no access to this action, so step-up MFA cannot unlock it.",
    "An admin must grant the permission in the Transcodes console (RBAC \u2192 Roles),",
    "then retry. Do not retry until the permission is granted."
  ].join("\n");
}
function formatStepupFailureDetail(decision) {
  const { failure } = decision;
  return failure.reason === "no-token" ? "No Transcodes token found \u2014 step-up MFA gate is unavailable. Install the CLI (`npm install -g @bigstrider/transcodes-cli`), run `transcodes` to open the dashboard, and paste a token from the Transcodes console (https://app.transcodes.io member detail page). Non-interactive: `transcodes set <token> -l <label>`." : failure.reason === "create-failed" ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ""}.` : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ""}.`;
}
function formatStepupFailureReason(decision) {
  return `Bash blocked by transcodes-guard: ${decision.block.reason}. ${formatStepupFailureDetail(decision)} Report the failure to the user; do not retry until step-up is available.`;
}
function formatStepupFailureSystemMessage(decision) {
  return `${formatBlockedSummary(decision.block)}

${formatStepupFailureDetail(decision)}`;
}
function formatStepupPendingReason(decision) {
  return `Step-up MFA pending. sid=${decision.sid}. Open ${decision.browserUrl}, complete WebAuthn, then call MCP tool \`poll_stepup_session_wait\` with sid="${decision.sid}" and retry the same Bash command.`;
}
function formatStepupPendingSystemMessage(decision) {
  const launchLine = decision.browserLaunched ? "A browser tab has been opened automatically:" : "A concurrent hook process already opened a tab \u2014 reuse it:";
  return [
    "\u{1F510} BLOCKED \u2014 Step-up MFA required. This Bash command was NOT executed.",
    "",
    `Reason : ${decision.block.reason}`,
    `Command: ${decision.block.command}`,
    "",
    launchLine,
    `  ${decision.browserUrl}`,
    "",
    `Session id: ${decision.sid}`,
    "",
    "Agent \u2014 drive the step-up loop (do this WITHOUT asking the user for confirmation):",
    "  1. Tell the user (one short line) to complete WebAuthn in the opened tab (paste the URL above if it did not open).",
    `  2. Immediately call the MCP tool \`poll_stepup_session_wait\` with sid="${decision.sid}". It blocks until verified or 60s timeout \u2014 one call replaces the polling loop.`,
    '  3. On `outcome: "verified"` retry the SAME Bash command \u2014 the hook detects the verified state and allows it. On `outcome: "timeout"` ask the user to retry WebAuthn, then call the wait tool again. On `outcome: "rejected"` tell the user they declined step-up; do NOT retry the command unless they explicitly ask.'
  ].join("\n");
}
function formatStderrTag(decision) {
  switch (decision.kind) {
    case GATE_DECISION_KIND.PROCEED_UNGATED:
    case GATE_DECISION_KIND.PROCEED_BY_POLICY:
      return "transcodes-guard: pass";
    case GATE_DECISION_KIND.PROCEED_BY_VERIFICATION:
      return `transcodes-guard: ALLOWED (stepup-verified) \u2014 ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_NO_TOKEN:
      return `transcodes-guard: BLOCKED (no token) \u2014 ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_BY_POLICY:
      return `transcodes-guard: BLOCKED (rbac-denied ${decision.resource}/${decision.action}) \u2014 ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_CREATE_FAILED:
      return `transcodes-guard: BLOCKED (stepup-failure) \u2014 ${decision.block.command}`;
    case GATE_DECISION_KIND.BLOCK_STEPUP_CHALLENGED:
      return `transcodes-guard: STEPUP-PENDING sid=${decision.sid} \u2014 ${decision.block.command}`;
  }
}

// ../../packages/gate-contract/dist/noop.js
var NOT_INSTALLED = "transcodes-guard: gate backend not installed";
function notInstalled() {
  throw new Error(NOT_INSTALLED);
}
var denyByDefaultBackend = {
  // hook path — inert no-ops / empty reads
  async evaluatePreToolUse() {
    return { kind: GATE_DECISION_KIND.PROCEED_UNGATED };
  },
  writePending() {
  },
  consumeVerified() {
  },
  clearPending() {
  },
  firstActivePending() {
    return null;
  },
  firstInFlightFpPending() {
    return null;
  },
  readPending() {
    return null;
  },
  readVerified() {
    return null;
  },
  isExpired() {
    return true;
  },
  sweepStepup() {
  },
  hasToken() {
    return false;
  },
  async sendGateDecisionAudit() {
  },
  async refreshPolicyBundle() {
    return "skipped";
  },
  // server path — call-shaped methods throw
  createStepupSession() {
    return notInstalled();
  },
  pollStepupSession() {
    return notInstalled();
  },
  pollStepupSessionWait() {
    return notInstalled();
  },
  inspectStepupState() {
    return notInstalled();
  },
  findPendingBySid() {
    return null;
  },
  writeVerified() {
  },
  markVerified() {
  },
  assertRbacCoordinate() {
    return notInstalled();
  },
  isRbacCoordinateError(_e) {
    return false;
  },
  loadMergedToolRules() {
    return [];
  },
  loadEffectivePatterns() {
    return [];
  },
  findFirstToolRule() {
    return null;
  },
  addToolRule() {
    return notInstalled();
  },
  updateToolRule() {
    return notInstalled();
  },
  removeToolRule() {
    return notInstalled();
  },
  isToolRuleValidationError(_e) {
    return false;
  },
  // no-op: a public-only server simply registers no backend tools.
  registerBackendTools(_server) {
  }
};

// ../../packages/gate-contract/dist/registry.js
var current = null;
function setGateBackend(backend) {
  current = backend;
}
function getGateBackend() {
  return current ?? denyByDefaultBackend;
}

// ../../packages/danger-patterns/dist/data/danger-patterns.json
var danger_patterns_default = {
  patterns: [
    {
      id: "rm-rf-root",
      regex: "\\brm\\s+(-[rRf]+\\s+)+(/[^\\s]*|~[^\\s]*|\\$HOME[^\\s]*)",
      reason: "Recursive removal of an absolute path, ~, or $HOME",
      stepupAction: "delete",
      stepupResource: "system"
    },
    {
      id: "chmod-recursive-root",
      regex: "\\bchmod\\s+-R\\s+\\d+\\s+(/[^\\s]*|~[^\\s]*|\\$HOME[^\\s]*)",
      reason: "Recursive chmod on an absolute path, ~, or $HOME",
      stepupAction: "update",
      stepupResource: "system"
    },
    {
      id: "rm-rf-broad",
      regex: "\\brm\\s+-[rRf]*[rR][rRf]*\\s+\\*",
      reason: "Recursive removal with bare glob (rm -rf *)",
      stepupAction: "delete",
      stepupResource: "system"
    },
    {
      id: "dd-disk",
      regex: "\\bdd\\s+.*of=/dev/(sd|nvme|hd|disk)",
      reason: "Direct write to block device",
      stepupAction: "update",
      stepupResource: "system"
    },
    {
      id: "mkfs",
      regex: "\\bmkfs(\\.|\\s)",
      reason: "Filesystem creation",
      stepupAction: "create",
      stepupResource: "system"
    },
    {
      id: "curl-pipe-shell",
      regex: "\\b(curl|wget)\\b[^|]*\\|\\s*(sudo\\s+)?(sh|bash|zsh)\\b",
      reason: "Piping remote content to shell",
      stepupAction: "update",
      stepupResource: "system"
    },
    {
      id: "fork-bomb",
      regex: ":\\(\\)\\s*\\{\\s*:\\|:&",
      reason: "Classic fork bomb",
      stepupAction: "update",
      stepupResource: "system"
    }
  ]
};

// ../../packages/danger-patterns/dist/rbac.js
var RBAC_ACTIONS = ["create", "read", "update", "delete"];
var DEFAULT_RBAC_RESOURCE = "system";
var DEFAULT_RBAC_ACTION = "update";
function isRbacAction(value) {
  return typeof value === "string" && RBAC_ACTIONS.includes(value);
}
function coerceRbacAction(value) {
  return isRbacAction(value) ? value : DEFAULT_RBAC_ACTION;
}
function coerceRbacResource(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULT_RBAC_RESOURCE;
}

// ../../packages/danger-patterns/dist/danger-patterns.js
function loadSystemPatterns() {
  return { patterns: [...danger_patterns_default.patterns] };
}
function loadMergedPatterns() {
  return loadSystemPatterns().patterns.map((p) => ({
    ...p,
    stepupResource: coerceRbacResource(p.stepupResource),
    stepupAction: coerceRbacAction(p.stepupAction),
    source: "system"
  }));
}
function findFirstMatch(command, patterns) {
  for (const p of patterns) {
    try {
      if (new RegExp(p.regex).test(command))
        return { matched: p };
    } catch {
    }
  }
  return null;
}

// ../../packages/danger-patterns/dist/data/tool-rules.json
var tool_rules_default = {
  rules: [
    {
      id: "tc-retire-member",
      type: "mcp",
      label: "Retire member",
      description: "Permanent member deletion",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__retire_member",
      action: "delete",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-suspend-member",
      type: "mcp",
      label: "Suspend member",
      description: "Member login suspension",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__suspend_member",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-unsuspend-member",
      type: "mcp",
      label: "Unsuspend member",
      description: "Member suspension removal",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__unsuspend_member",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-retire-role",
      type: "mcp",
      label: "Retire role",
      description: "Permanent role deletion",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__retire_role",
      action: "delete",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-set-role-permissions",
      type: "mcp",
      label: "Set role permissions",
      description: "Role permissions matrix reset",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__set_role_permissions",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-update-member-role",
      type: "mcp",
      label: "Update member role",
      description: "Member role reassignment",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__update_member_role",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-retire-resource",
      type: "mcp",
      label: "Retire resource",
      description: "Permanent RBAC resource deletion",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__retire_resource",
      action: "delete",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-passcode-create",
      type: "mcp",
      label: "Passcode create",
      description: "Recovery passcode generation",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__passcode_create",
      action: "create",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-create-member",
      type: "mcp",
      label: "Create member",
      description: "New member provisioning",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__create_member",
      action: "create",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-update-member",
      type: "mcp",
      label: "Update member",
      description: "Member profile update",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__update_member",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-create-role",
      type: "mcp",
      label: "Create role",
      description: "New RBAC role creation",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__create_role",
      action: "create",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-update-role",
      type: "mcp",
      label: "Update role",
      description: "RBAC role metadata update",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__update_role",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-create-resource",
      type: "mcp",
      label: "Create resource",
      description: "New RBAC resource creation",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__create_resource",
      action: "create",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-update-resource",
      type: "mcp",
      label: "Update resource",
      description: "RBAC resource metadata update",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__update_resource",
      action: "update",
      resource: "system",
      matcher: "exact"
    },
    {
      id: "tc-get-security-logs",
      type: "mcp",
      label: "Get security logs",
      description: "Project audit log access",
      name: "mcp__plugin_transcodes-guard_transcodes-guard__get_security_logs",
      action: "read",
      resource: "system",
      matcher: "exact"
    }
  ]
};

// ../../packages/danger-patterns/dist/tool-rules.js
var GUARD_PROVIDERS = [
  "claude",
  "codex",
  "cursor",
  "antigravity"
];
var ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
function loadSystemToolRules() {
  return { rules: [...tool_rules_default.rules] };
}
function normalizeRule(r) {
  if (r.type === "bash") {
    return {
      ...r,
      type: "bash",
      matcher: "regex",
      action: coerceRbacAction(r.action),
      resource: coerceRbacResource(r.resource)
    };
  }
  const { provider: rawProvider, ...rest } = r;
  const provider = rawProvider !== void 0 ? mapHostToProvider(rawProvider) : void 0;
  return {
    ...rest,
    type: "mcp",
    matcher: r.matcher ?? "exact",
    ...provider !== void 0 ? { provider } : {},
    ...r.action !== void 0 ? { action: coerceRbacAction(r.action) } : {},
    ...r.resource !== void 0 ? { resource: coerceRbacResource(r.resource) } : {}
  };
}
function loadMergedToolRules(bundleRules = []) {
  const merged = /* @__PURE__ */ new Map();
  for (const r of loadSystemToolRules().rules) {
    merged.set(r.id, { ...normalizeRule(r), source: "system" });
  }
  for (const r of bundleRules) {
    merged.set(r.id, { ...normalizeRule(r), source: "bundle" });
  }
  return [...merged.values()];
}
function globMatches(pattern, toolName) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(toolName);
}
function toolNameMatchesRule(toolName, rule) {
  if (rule.type === "bash")
    return false;
  const target = toolName.toLowerCase();
  const name = rule.name.toLowerCase();
  return rule.matcher === "glob" ? globMatches(name, target) : name === target;
}
function mapHostToProvider(host) {
  if (!host)
    return void 0;
  const normalized = host === "claude-code" ? "claude" : host;
  return isGuardProvider(normalized) ? normalized : void 0;
}
function currentHostProvider() {
  return mapHostToProvider(process.env.TRANSCODES_GUARD_HOST);
}
function ruleAppliesToHost(rule, hostProvider = currentHostProvider()) {
  if (rule.provider === void 0)
    return true;
  if (hostProvider === void 0)
    return true;
  return rule.provider === hostProvider;
}
function findFirstToolRule(toolName, rules, hostProvider = currentHostProvider()) {
  for (const r of rules) {
    if (toolNameMatchesRule(toolName, r) && ruleAppliesToHost(r, hostProvider)) {
      return { matched: r };
    }
  }
  return null;
}
function mcpConsumesInHook(rule) {
  if (rule.consume_in_hook !== void 0)
    return rule.consume_in_hook;
  return rule.source === "bundle";
}
var ToolRuleValidationError = class extends Error {
};
function detectShellCommand(name) {
  return /[\s|&;<>$*()`\\/]/.test(name);
}
function isGuardProvider(v) {
  return GUARD_PROVIDERS.includes(v);
}
function validateNewToolRule(input) {
  const { id, type = "mcp", label, description, name, matcher = type === "bash" ? "regex" : "exact", provider, action, resource } = input;
  if (!ID_REGEX.test(id)) {
    throw new ToolRuleValidationError(`id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`);
  }
  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(`id "${id}" is reserved by a system tool-rule and cannot be overridden`);
  }
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new ToolRuleValidationError("label must not be empty");
  }
  const trimmedDescription = description.trim();
  if (!trimmedDescription) {
    throw new ToolRuleValidationError("description must not be empty");
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new ToolRuleValidationError("name must not be empty");
  }
  if (type === "bash") {
    if (matcher !== "regex") {
      throw new ToolRuleValidationError('bash rules require matcher "regex"');
    }
    try {
      new RegExp(trimmedName);
    } catch (e) {
      throw new ToolRuleValidationError(`name must be a valid regex: ${e.message}`);
    }
    const trimmedAction = (action ?? "").trim();
    if (!isRbacAction(trimmedAction)) {
      throw new ToolRuleValidationError(`action must be one of create|read|update|delete (got: "${action ?? ""}")`);
    }
    const trimmedResource = (resource ?? "").trim();
    if (!trimmedResource) {
      throw new ToolRuleValidationError("resource must not be empty");
    }
    return {
      id,
      type: "bash",
      label: trimmedLabel,
      description: trimmedDescription,
      name: trimmedName,
      matcher: "regex",
      action: trimmedAction,
      resource: trimmedResource
    };
  }
  if (type !== "mcp") {
    throw new ToolRuleValidationError('type must be "mcp" or "bash"');
  }
  if (detectShellCommand(trimmedName)) {
    throw new ToolRuleValidationError(`"${trimmedName}" looks like a Bash command, not an MCP tool name. Tool rules match a tool_name exactly or via glob; use add_user_pattern (type bash) for Bash.`);
  }
  if (matcher !== "exact" && matcher !== "glob") {
    throw new ToolRuleValidationError("mcp rules require matcher exact or glob");
  }
  if (provider !== void 0) {
    const trimmedProvider = provider.trim();
    if (!isGuardProvider(trimmedProvider)) {
      throw new ToolRuleValidationError(`provider must be one of ${GUARD_PROVIDERS.join("|")} (got: "${provider}")`);
    }
  }
  const rule = {
    id,
    type: "mcp",
    label: trimmedLabel,
    description: trimmedDescription,
    name: trimmedName,
    matcher,
    ...provider !== void 0 ? { provider: provider.trim() } : {}
  };
  if (action !== void 0) {
    const trimmedAction = action.trim();
    if (!isRbacAction(trimmedAction)) {
      throw new ToolRuleValidationError(`action must be one of create|read|update|delete (got: "${action}")`);
    }
    rule.action = trimmedAction;
  }
  if (resource !== void 0) {
    const trimmedResource = resource.trim();
    if (!trimmedResource) {
      throw new ToolRuleValidationError("resource must not be empty");
    }
    rule.resource = trimmedResource;
  }
  return rule;
}
function mergeToolRuleChanges(existing, changes) {
  const provider = changes.provider ?? existing.provider;
  const action = changes.action ?? (existing.action !== void 0 ? coerceRbacAction(existing.action) : void 0);
  const resource = changes.resource ?? (existing.resource !== void 0 ? coerceRbacResource(existing.resource) : void 0);
  return validateNewToolRule({
    id: existing.id,
    type: changes.type ?? existing.type,
    label: changes.label ?? existing.label,
    description: changes.description ?? existing.description,
    name: changes.name ?? existing.name,
    matcher: changes.matcher ?? existing.matcher,
    ...provider !== void 0 ? { provider } : {},
    ...action !== void 0 ? { action } : {},
    ...resource !== void 0 ? { resource } : {}
  });
}
function systemToolRuleIds() {
  return new Set(loadSystemToolRules().rules.map((r) => r.id));
}

// ../../packages/stepup-core/dist/client.js
var REQUEST_TIMEOUT_MS = 3e4;
async function request(config, input) {
  const path7 = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const params = new URLSearchParams();
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      if (v !== void 0 && v !== null && v !== "") {
        params.append(k, String(v));
      }
    }
  }
  const qs = params.toString();
  const url = `${config.apiBaseV1}${path7}${qs ? `?${qs}` : ""}`;
  const headers = {
    "x-transcodes-token": config.token,
    Accept: "application/json"
  };
  if (input.stepUpSid) {
    headers["X-Step-Up-Session-Id"] = input.stepUpSid;
  }
  let body;
  const sendsBody = input.method !== "GET" && !input.omitBody;
  if (sendsBody) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(input.body ?? {});
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: input.method,
      headers,
      body,
      signal: controller.signal
    });
    let data;
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data
    };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      status: 0,
      data: {
        error: "Network Request Failed",
        message: aborted ? "Request timed out" : "Could not reach the backend. Check TRANSCODES_BACKEND_URL and network connectivity."
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

// ../../packages/stepup-core/dist/jwt.js
var REQUIRED_AUDIENCE = "transcodes-mcp";
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function tryDecodeBase64UrlJson(segment) {
  if (!segment)
    return void 0;
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return isPlainObject(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function readString(rec, key) {
  const v = rec[key];
  if (typeof v !== "string")
    return void 0;
  const t = v.trim();
  return t || void 0;
}
function readNumericDate(rec, key) {
  const v = rec[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.floor(n) : void 0;
}
function readAudience(rec) {
  const aud = rec.aud;
  if (typeof aud === "string") {
    const t = aud.trim();
    return t ? [t] : void 0;
  }
  if (Array.isArray(aud)) {
    const list = aud.filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0);
    return list.length > 0 ? list : void 0;
  }
  return void 0;
}
function parseMemberAccessToken(rawToken) {
  if (typeof rawToken !== "string") {
    throw new Error("token must be a string");
  }
  const raw = rawToken.trim();
  if (!raw) {
    throw new Error("token is empty");
  }
  const warnings = [];
  const parts = raw.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    warnings.push(`token does not look like a JWT (expected 3 non-empty segments, got ${parts.length})`);
  }
  const payloadSegment = parts.length === 3 ? parts[1] : raw;
  const payload = tryDecodeBase64UrlJson(payloadSegment);
  if (!payload) {
    throw new Error("token payload could not be decoded as base64url JSON object");
  }
  const organizationId = readString(payload, "oid");
  const projectId = readString(payload, "pid");
  const memberId = readString(payload, "mid");
  if (!organizationId || !projectId || !memberId) {
    throw new Error("token payload must include oid, pid, and mid claims");
  }
  const aud = readAudience(payload);
  if (!aud) {
    warnings.push("aud claim is missing");
  } else if (!aud.includes(REQUIRED_AUDIENCE)) {
    warnings.push(`aud does not include "${REQUIRED_AUDIENCE}" (got ${JSON.stringify(aud)})`);
  }
  const exp = readNumericDate(payload, "exp");
  if (exp === void 0) {
    throw new Error("token must include exp claim (NumericDate, integer seconds)");
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  if (nowSec >= exp) {
    throw new Error("token has expired");
  }
  return {
    raw,
    claims: {
      organizationId,
      projectId,
      memberId,
      aud,
      exp,
      iss: readString(payload, "iss"),
      jti: readString(payload, "jti"),
      iat: readNumericDate(payload, "iat")
    },
    warnings
  };
}

// ../../packages/stepup-core/dist/token-store.js
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
var CONFIG_DIR_NAME = ".transcodes";
var CONFIG_FILE_NAME = "config.json";
function transcodesConfigDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}
function transcodesConfigFile() {
  return path.join(transcodesConfigDir(), CONFIG_FILE_NAME);
}
function readRawConfig() {
  let raw;
  try {
    raw = readFileSync(transcodesConfigFile(), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}
function normalizeToken(v) {
  if (typeof v !== "string")
    return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeLabel(v) {
  if (typeof v !== "string")
    return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeRecord(item) {
  if (typeof item === "string") {
    const token = normalizeToken(item);
    return token ? { token, label: null } : null;
  }
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const obj = item;
    const token = normalizeToken(obj.token);
    if (!token)
      return null;
    return { token, label: normalizeLabel(obj.label) };
  }
  return null;
}
function readConfig() {
  const obj = readRawConfig();
  if (!obj) {
    return { token: null, tokenList: [] };
  }
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (rec) => {
    if (!rec)
      return;
    const existing = list.find((r) => r.token === rec.token);
    if (existing) {
      if (!existing.label && rec.label)
        existing.label = rec.label;
      return;
    }
    seen.add(rec.token);
    list.push(rec);
  };
  if (Array.isArray(obj.token_list)) {
    for (const item of obj.token_list)
      push(normalizeRecord(item));
  }
  const active = normalizeToken(obj.token);
  if (active)
    push({ token: active, label: null });
  return {
    token: active ?? (list.length > 0 ? list[0].token : null),
    tokenList: list
  };
}
function readTokenFromFile() {
  return readConfig().token;
}
function resolveToken() {
  const fileToken = readTokenFromFile();
  if (fileToken) {
    return { token: fileToken, source: "file" };
  }
  return { token: null, source: "none" };
}

// ../../packages/stepup-core/dist/config.js
var DEFAULT_BACKEND_URL = process.env.environment === "dev" ? "http://localhost:3500" : "https://api.transcodesapis.com";
var STEPUP_TTL_MS = 10 * 60 * 1e3;
function loadStepupConfig() {
  const rawUrl = process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
  const backendUrl = rawUrl.replace(/\/$/, "");
  try {
    new URL(backendUrl);
  } catch {
    throw new Error(`TRANSCODES_BACKEND_URL is not a valid URL: ${backendUrl}`);
  }
  const { token: tokenRaw } = resolveToken();
  if (!tokenRaw) {
    throw new Error("No Transcodes token found. Install the CLI (`npm install -g @bigstrider/transcodes-cli`), run `transcodes` to open the dashboard, and paste a token from the Transcodes console (member detail page, https://app.transcodes.io). Non-interactive: `transcodes set <token> -l <label>`.");
  }
  const parsed = parseMemberAccessToken(tokenRaw);
  for (const w of parsed.warnings) {
    process.stderr.write(`[transcodes-guard] WARN token: ${w}
`);
  }
  return {
    backendUrl,
    apiBaseV1: `${backendUrl}/v1`,
    token: parsed.raw,
    organizationId: parsed.claims.organizationId,
    projectId: parsed.claims.projectId,
    memberId: parsed.claims.memberId
  };
}

// ../../packages/stepup-core/dist/console.js
import { spawn } from "child_process";

// ../../packages/stepup-core/dist/session.js
var STEPUP_PATH = "/auth/temp-session/step-up/session";
var CONSOLE_SESSION_PATH = "/auth/temp-session/console/session";
function readStepupPayload(envelope) {
  const data = envelope.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return void 0;
  }
  const payload = data.payload;
  if (!Array.isArray(payload) || payload.length === 0)
    return void 0;
  const first = payload[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return void 0;
  }
  return first;
}
function readString2(rec, key) {
  const v = rec[key];
  return typeof v === "string" && v.trim() ? v : void 0;
}
async function createStepupSession(config, args) {
  const comment = args.comment?.trim();
  if (!comment) {
    throw new Error("comment is required: one short sentence for the step-up UI");
  }
  const envelope = await request(config, {
    method: "POST",
    path: STEPUP_PATH,
    body: {
      project_id: config.projectId,
      member_id: args.member_id ?? config.memberId,
      action: args.action,
      resource: args.resource,
      comment
    }
  });
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    sid: payload ? readString2(payload, "sid") : void 0,
    browserUrl: payload ? readString2(payload, "url") ?? readString2(payload, "browser_url") ?? readString2(payload, "browserUrl") : void 0,
    expiresAt: payload ? readString2(payload, "expiresAt") ?? readString2(payload, "expires_at") : void 0
  };
}
async function createConsoleBrowserSession(config, args = {}) {
  const envelope = await request(config, {
    method: "POST",
    path: CONSOLE_SESSION_PATH,
    body: {
      project_id: config.projectId,
      member_id: config.memberId,
      organization_id: config.organizationId,
      comment: args.comment
    }
  });
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    sid: payload ? readString2(payload, "sid") : void 0,
    browserUrl: payload ? readString2(payload, "url") ?? readString2(payload, "browser_url") ?? readString2(payload, "browserUrl") : void 0,
    expiresAt: payload ? readString2(payload, "expiresAt") ?? readString2(payload, "expires_at") : void 0
  };
}
async function pollStepupSession(config, sid) {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error("sid is required");
  }
  const envelope = await request(config, {
    method: "GET",
    path: `${STEPUP_PATH}/${encodeURIComponent(trimmed)}`
  });
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    status: payload ? readString2(payload, "status") : void 0
  };
}
async function pollStepupSessionWait(config, sid, options = {}) {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error("sid is required");
  }
  const maxWaitMs = options.maxWaitMs ?? 6e4;
  const intervalMs = options.intervalMs ?? 1e3;
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;
  let lastEnvelope;
  while (true) {
    attempts += 1;
    const result = await pollStepupSession(config, trimmed);
    lastEnvelope = result.envelope;
    if (result.status === "verified") {
      return {
        envelope: result.envelope,
        outcome: "verified",
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts
      };
    }
    if (result.status === "rejected") {
      return {
        envelope: result.envelope,
        outcome: "rejected",
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        envelope: lastEnvelope,
        outcome: "timeout",
        elapsedMs: maxWaitMs - Math.max(0, remaining),
        attempts
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}

// ../../packages/stepup-core/dist/console.js
var CONSOLE_SESSION_COMMENT = "Manage your authentication methods (passkeys, TOTP, security keys)";
function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(opener, args, {
      stdio: "ignore",
      detached: true
    });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
async function openConsoleSession(options) {
  if (!resolveToken().token) {
    return { ok: false, reason: "no-token" };
  }
  let config;
  try {
    config = loadStepupConfig();
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  let created;
  try {
    created = await createConsoleBrowserSession(config, {
      comment: options?.comment ?? CONSOLE_SESSION_COMMENT
    });
  } catch (err) {
    return {
      ok: false,
      reason: "create-failed",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  if (!created.envelope.ok || !created.sid || !created.browserUrl) {
    return {
      ok: false,
      reason: "create-failed",
      detail: `backend rejected console session (status ${created.envelope.status})`
    };
  }
  const shouldOpen = options?.openBrowser !== false;
  if (shouldOpen) {
    openBrowser(created.browserUrl);
  }
  return {
    ok: true,
    sid: created.sid,
    browserUrl: created.browserUrl,
    expiresAt: created.expiresAt,
    launched: shouldOpen
  };
}

// ../../packages/stepup-core/dist/evaluate.js
import { execFileSync } from "child_process";
import path6 from "path";

// ../../packages/stepup-core/dist/gate.js
import { spawn as spawn2 } from "child_process";
import { createHash } from "crypto";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import path3 from "path";

// ../../packages/plugin-paths/dist/index.js
import { copyFileSync, existsSync, mkdirSync as mkdirSync2, renameSync } from "fs";
import os2 from "os";
import path2 from "path";
var CLAUDE_PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
function transcodesDir() {
  return path2.join(os2.homedir(), ".transcodes");
}
function stateDir() {
  return path2.join(transcodesDir(), "state");
}
function legacyDataDir() {
  return path2.join(os2.homedir(), ".claude", "transcodes-guard");
}
function legacyCacheDir() {
  if (process.platform === "win32") {
    const base2 = process.env.LOCALAPPDATA?.trim() || path2.join(os2.homedir(), "AppData", "Local");
    return path2.join(base2, "transcodes-guard", "Cache");
  }
  if (process.platform === "darwin") {
    return path2.join(os2.homedir(), "Library", "Caches", "transcodes-guard");
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path2.join(os2.homedir(), ".cache");
  return path2.join(base, "transcodes-guard");
}
function cacheDir() {
  return stateDir();
}
function migrateLegacyFile(name, kind) {
  void kind;
  try {
    const target = stateDir();
    const newPath = path2.join(target, name);
    if (existsSync(newPath)) {
      return;
    }
    const candidates = [];
    const plug = process.env[CLAUDE_PLUGIN_DATA_ENV]?.trim();
    if (plug && plug.length > 0) {
      candidates.push(path2.join(plug, name));
    }
    candidates.push(path2.join(legacyDataDir(), name));
    candidates.push(path2.join(legacyCacheDir(), name));
    const oldPath = candidates.find((p) => p !== newPath && existsSync(p));
    if (!oldPath) {
      return;
    }
    mkdirSync2(target, { recursive: true });
    copyFileSync(oldPath, newPath);
    renameSync(oldPath, `${oldPath}.bak`);
  } catch {
  }
}

// ../../packages/stepup-core/dist/gate.js
var BROWSER_LOCK_TTL_MS = 15e3;
var BROWSER_LOCK_FILE = "stepup-browser-lock.json";
function fingerprintOf(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
function claimBrowserLaunch(fingerprintKey) {
  migrateLegacyFile(BROWSER_LOCK_FILE, "cache");
  const lockFile = path3.join(cacheDir(), BROWSER_LOCK_FILE);
  const fingerprint = fingerprintOf(fingerprintKey);
  try {
    const raw = readFileSync2(lockFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed;
      const sameCommand = obj.fingerprint === fingerprint;
      const openedAt = typeof obj.openedAt === "number" ? obj.openedAt : 0;
      if (sameCommand && Date.now() - openedAt < BROWSER_LOCK_TTL_MS) {
        return false;
      }
    }
  } catch {
  }
  try {
    mkdirSync3(path3.dirname(lockFile), { recursive: true });
    writeFileSync2(lockFile, JSON.stringify({ fingerprint, openedAt: Date.now() }), { mode: 384 });
  } catch {
  }
  return true;
}
function openBrowser2(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn2(opener, args, {
      stdio: "ignore",
      detached: true
    });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
async function requestStepup(input) {
  if (!resolveToken().token) {
    return { ok: false, reason: "no-token" };
  }
  let config;
  try {
    config = loadStepupConfig();
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  let created;
  try {
    created = await createStepupSession(config, {
      comment: input.comment ?? `Confirm ${input.reason}`,
      action: input.action,
      resource: input.resource
    });
  } catch (err) {
    return {
      ok: false,
      reason: "create-failed",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  if (!created.envelope.ok || !created.sid || !created.browserUrl) {
    return {
      ok: false,
      reason: "create-failed",
      detail: `backend rejected create_stepup_session (status ${created.envelope.status})`
    };
  }
  const launched = claimBrowserLaunch(input.fingerprintKey);
  if (launched) {
    openBrowser2(created.browserUrl);
  }
  return {
    ok: true,
    sid: created.sid,
    browserUrl: created.browserUrl,
    expiresAt: created.expiresAt,
    launched
  };
}

// ../../packages/stepup-core/dist/pending.js
import { mkdirSync as mkdirSync5, readFileSync as readFileSync4, rmSync as rmSync3, writeFileSync as writeFileSync4 } from "fs";

// ../../node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path7, errorMaps, issueData } = params;
  const fullPath = [...path7, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path7, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path7;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../../packages/stepup-core/dist/stepup-files.js
import { readdirSync } from "fs";
import path4 from "path";
function stepupFileName(base, fp) {
  return fp ? `${base}.${fp}.json` : `${base}.json`;
}
function stepupFilePath(base, fp) {
  return path4.join(cacheDir(), stepupFileName(base, fp));
}
function stepupDir() {
  return cacheDir();
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function fpFileRegex(base) {
  return new RegExp(`^${escapeRegex(base)}\\.([0-9a-f]+)\\.json$`);
}
function listFingerprints(base) {
  const re = fpFileRegex(base);
  try {
    return readdirSync(cacheDir()).map((name) => re.exec(name)?.[1]).filter((fp) => typeof fp === "string");
  } catch {
    return [];
  }
}
function isExpiredAt(createdAt, expiresAt, now, ttlMs = STEPUP_TTL_MS) {
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t))
      return now >= t;
  }
  return now - createdAt > ttlMs;
}

// ../../packages/stepup-core/dist/store.js
import { mkdirSync as mkdirSync4, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "fs";
var FILE_BASE = "stepup-verified";
function storePath(fp) {
  return stepupFilePath(FILE_BASE, fp);
}
function readVerified(fp) {
  if (!fp)
    migrateLegacyFile(stepupFileName(FILE_BASE), "cache");
  const file = storePath(fp);
  let raw;
  try {
    raw = readFileSync3(file, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    consumeVerified(fp);
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    consumeVerified(fp);
    return null;
  }
  const obj = parsed;
  const sid = typeof obj.sid === "string" ? obj.sid : null;
  const verifiedAt = typeof obj.verifiedAt === "number" ? obj.verifiedAt : null;
  if (!sid || verifiedAt === null) {
    consumeVerified(fp);
    return null;
  }
  const ageMs = Date.now() - verifiedAt;
  if (ageMs > STEPUP_TTL_MS) {
    process.stderr.write(`transcodes-guard: verified record EXPIRED (sid=${sid}, age=${ageMs}ms, ttl=${STEPUP_TTL_MS}ms${fp ? `, fp=${fp}` : ""}) \u2014 starting a new step-up.
`);
    consumeVerified(fp);
    return null;
  }
  return { sid, verifiedAt };
}
function writeVerified(v, fp) {
  const file = storePath(fp);
  mkdirSync4(stepupDir(), { recursive: true });
  writeFileSync3(file, JSON.stringify(v), { mode: 384 });
}
function consumeVerified(fp) {
  try {
    rmSync2(storePath(fp), { force: true });
  } catch {
  }
}

// ../../packages/stepup-core/dist/pending.js
var FILE_BASE2 = "stepup-pending";
var PendingStateSchema = external_exports.object({
  sid: external_exports.string().min(1),
  command: external_exports.string(),
  reason: external_exports.string(),
  browserUrl: external_exports.string(),
  createdAt: external_exports.number().int().nonnegative(),
  expiresAt: external_exports.string().optional(),
  status: external_exports.enum(["pending", "verified"]),
  /** Present for the hook-consume (FP-KEYED) path; absent for the GLOBAL
   * MCP system-rule path. Selects which file this record lives in. */
  fp: external_exports.string().optional()
});
function pendingPath(fp) {
  return stepupFilePath(FILE_BASE2, fp);
}
function parsePendingRaw(file) {
  try {
    const raw = readFileSync4(file, "utf8");
    const parsed = PendingStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function readPending(fp) {
  if (!fp)
    migrateLegacyFile(stepupFileName(FILE_BASE2), "cache");
  return parsePendingRaw(pendingPath(fp));
}
function writePending(state) {
  const file = pendingPath(state.fp);
  mkdirSync5(stepupDir(), { recursive: true });
  writeFileSync4(file, JSON.stringify(state), { mode: 384 });
}
function clearPending(fp) {
  try {
    rmSync3(pendingPath(fp), { force: true });
  } catch {
  }
}
function listFpPendings() {
  const out = [];
  for (const fp of listFingerprints(FILE_BASE2)) {
    const rec = parsePendingRaw(pendingPath(fp));
    if (rec)
      out.push(rec);
  }
  return out;
}
function findPendingBySid(sid) {
  const global = readPending();
  if (global && global.sid === sid)
    return { pending: global };
  for (const rec of listFpPendings()) {
    if (rec.sid === sid)
      return { fp: rec.fp, pending: rec };
  }
  return null;
}
function markVerified(sid) {
  const found = findPendingBySid(sid);
  if (!found)
    return;
  writePending({ ...found.pending, status: "verified" });
}
function isExpired(state, now = Date.now()) {
  return isExpiredAt(state.createdAt, state.expiresAt, now);
}
function firstInFlightFpPending(now = Date.now()) {
  for (const rec of listFpPendings()) {
    if (rec.status === "pending" && !isExpired(rec, now))
      return rec;
  }
  return null;
}
function firstActivePending(now = Date.now()) {
  const global = readPending();
  if (global && !isExpired(global, now))
    return global;
  for (const rec of listFpPendings()) {
    if (!isExpired(rec, now))
      return rec;
  }
  return null;
}
function sweepStepup(now = Date.now()) {
  for (const rec of listFpPendings()) {
    const fp = rec.fp;
    if (!fp)
      continue;
    if (rec.status === "verified" && !readVerified(fp)) {
      clearPending(fp);
      continue;
    }
    if (isExpired(rec, now)) {
      clearPending(fp);
      consumeVerified(fp);
    }
  }
}

// ../../packages/stepup-core/dist/policy-bundle.js
import { createHash as createHash2 } from "crypto";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync5, renameSync as renameSync2, writeFileSync as writeFileSync5 } from "fs";
import path5 from "path";
var GUARD_POLICY_BUNDLE_SCHEMA_VERSION = 3;
var POLICY_BUNDLE_TTL_MS = 60 * 60 * 1e3;
var POLICY_BUNDLE_FETCH_TIMEOUT_MS = 3e3;
var bundleToolRuleSchema = external_exports.object({
  id: external_exports.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  type: external_exports.enum(["mcp", "bash"]),
  label: external_exports.string().min(1),
  description: external_exports.string().min(1),
  name: external_exports.string().min(1),
  matcher: external_exports.enum(["exact", "glob", "regex"]),
  provider: external_exports.enum(["claude", "codex", "cursor", "antigravity"]).optional(),
  action: external_exports.enum(RBAC_ACTIONS).optional(),
  resource: external_exports.string().min(1).optional()
});
var policyBundleSchema = external_exports.object({
  schemaVersion: external_exports.literal(GUARD_POLICY_BUNDLE_SCHEMA_VERSION),
  revision: external_exports.string().min(1),
  rules: external_exports.array(bundleToolRuleSchema)
});
var manifestSchema = external_exports.object({
  sha384: external_exports.string().regex(/^[0-9a-f]{96}$/i)
});
var PolicyBundleError = class extends Error {
};
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
function policyBundleSha384(body) {
  return createHash2("sha384").update(canonicalJson(body), "utf8").digest("hex");
}
function verifyAndParsePolicyBundle(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PolicyBundleError("bundle body is not an object");
  }
  const { manifest, ...body } = raw;
  const manifestParsed = manifestSchema.safeParse(manifest);
  if (!manifestParsed.success) {
    throw new PolicyBundleError("manifest.sha384 missing or malformed");
  }
  const expected = manifestParsed.data.sha384.toLowerCase();
  const actual = policyBundleSha384(body);
  if (actual !== expected) {
    throw new PolicyBundleError(`manifest sha384 mismatch (manifest=${expected.slice(0, 12)}\u2026, body=${actual.slice(0, 12)}\u2026)`);
  }
  const parsed = policyBundleSchema.safeParse(body);
  if (!parsed.success) {
    throw new PolicyBundleError(`bundle schema invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}
function policyBundleCachePath(projectId) {
  const safe = projectId.replace(/[^A-Za-z0-9._-]/g, "_");
  return path5.join(cacheDir(), `policy-bundle.${safe}.json`);
}
function readCachedPolicyBundle(projectId, ttlMs = POLICY_BUNDLE_TTL_MS) {
  let raw;
  try {
    raw = readFileSync5(policyBundleCachePath(projectId), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const envelope = parsed;
  if (typeof envelope.fetchedAt !== "number") {
    return null;
  }
  const bundle = policyBundleSchema.safeParse(envelope.bundle);
  if (!bundle.success) {
    return null;
  }
  return {
    bundle: bundle.data,
    fetchedAt: envelope.fetchedAt,
    fresh: Date.now() - envelope.fetchedAt < ttlMs
  };
}
function writeCachedPolicyBundle(projectId, bundle) {
  const file = policyBundleCachePath(projectId);
  mkdirSync6(path5.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const envelope = { fetchedAt: Date.now(), bundle };
  writeFileSync5(tmp, JSON.stringify(envelope), { mode: 384 });
  renameSync2(tmp, file);
}
function unwrapBundleBody(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const env = data;
  if (Array.isArray(env.payload) && ("success" in env || "statusCode" in env)) {
    return env.payload[0];
  }
  return data;
}
async function fetchPolicyBundle(config, currentRevision) {
  const res = await request(config, {
    method: "GET",
    path: "/guard/policy-bundle",
    query: { revision: currentRevision },
    timeoutMs: POLICY_BUNDLE_FETCH_TIMEOUT_MS
  });
  if (res.status === 304) {
    return { kind: "not-modified" };
  }
  if (!res.ok) {
    return {
      kind: "error",
      message: res.status === 0 ? "backend unreachable" : `backend responded ${res.status}`
    };
  }
  try {
    return {
      kind: "fetched",
      bundle: verifyAndParsePolicyBundle(unwrapBundleBody(res.data))
    };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
async function refreshPolicyBundle(config, opts = {}) {
  try {
    const ttlMs = opts.ttlMs ?? POLICY_BUNDLE_TTL_MS;
    const cached = readCachedPolicyBundle(config.projectId, ttlMs);
    if (cached?.fresh && !opts.force) {
      return "fresh";
    }
    const result = await fetchPolicyBundle(config, cached?.bundle.revision);
    if (result.kind === "fetched") {
      writeCachedPolicyBundle(config.projectId, result.bundle);
      return "refreshed";
    }
    if (result.kind === "not-modified" && cached) {
      writeCachedPolicyBundle(config.projectId, cached.bundle);
      return "not-modified";
    }
    if (result.kind === "error") {
      console.error(`transcodes-guard: policy bundle refresh failed \u2014 keeping cached bundle (${result.message})`);
    }
    return "failed";
  } catch (err) {
    console.error(`transcodes-guard: policy bundle refresh failed \u2014 keeping cached bundle (${err instanceof Error ? err.message : String(err)})`);
    return "failed";
  }
}
function loadEffectiveToolRules() {
  let bundleRules = [];
  try {
    const config = loadStepupConfig();
    bundleRules = (readCachedPolicyBundle(config.projectId)?.bundle.rules ?? []).filter((r) => r.type === "mcp").map((r) => ({ ...r, type: "mcp" }));
  } catch {
  }
  return loadMergedToolRules(bundleRules);
}
function loadEffectivePatterns() {
  const system = loadMergedPatterns();
  let bundle = [];
  try {
    const config = loadStepupConfig();
    const rules = readCachedPolicyBundle(config.projectId)?.bundle.rules ?? [];
    bundle = rules.filter((r) => r.type === "bash").map((r) => ({
      id: r.id,
      regex: r.name,
      reason: r.description,
      stepupResource: coerceRbacResource(r.resource),
      stepupAction: coerceRbacAction(r.action),
      source: "bundle"
    }));
  } catch {
  }
  return [...system, ...bundle];
}
async function refreshPolicyBundleIfConfigured(opts = {}) {
  let config;
  try {
    config = loadStepupConfig();
  } catch {
    return "skipped";
  }
  return refreshPolicyBundle(config, opts);
}

// ../../packages/stepup-core/dist/rbac-check.js
function extractPermission(data, resource, action) {
  if (!data || typeof data !== "object")
    return null;
  const payload = data.payload;
  if (!Array.isArray(payload))
    return null;
  const match = payload.find((p) => !!p && typeof p === "object" && p.resource === resource && p.action === action);
  const level = match?.permission;
  return level === 0 || level === 1 || level === 2 ? level : null;
}
async function checkRbacPermission(config, resource, action) {
  const env = await request(config, {
    method: "POST",
    path: "/auth/role/check-permission",
    body: {
      member_id: config.memberId,
      resource,
      action,
      project_id: config.projectId
    }
  });
  if (!env.ok)
    return null;
  return extractPermission(env.data, resource, action);
}

// ../../packages/stepup-core/dist/evaluate.js
var GATE_DECISION_KIND2 = {
  PROCEED_UNGATED: "proceed-ungated",
  PROCEED_BY_POLICY: "proceed-by-policy",
  PROCEED_BY_VERIFICATION: "proceed-by-verification",
  BLOCK_NO_TOKEN: "block-no-token",
  BLOCK_BY_POLICY: "block-by-policy",
  BLOCK_STEPUP_CREATE_FAILED: "block-stepup-create-failed",
  BLOCK_STEPUP_CHALLENGED: "block-stepup-challenged"
};
function checkPatternMatch(command) {
  const hit = findFirstMatch(command, loadEffectivePatterns());
  if (!hit)
    return null;
  const { source, id, reason, stepupResource, stepupAction } = hit.matched;
  return {
    reason: `matched ${source} pattern \`${id}\` \u2014 ${reason}`,
    command,
    ruleId: id,
    stepupResource,
    stepupAction
  };
}
function extractRmTargets(command) {
  const tokens = command.trim().split(/\s+/);
  const rmIdx = tokens.indexOf("rm");
  if (rmIdx === -1)
    return null;
  let i = rmIdx + 1;
  let recursive = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") {
      i++;
      break;
    }
    if (t.startsWith("-") && /^-[a-zA-Z]+$/.test(t)) {
      if (/[rR]/.test(t))
        recursive = true;
      i++;
      continue;
    }
    break;
  }
  if (!recursive)
    return null;
  const targets = tokens.slice(i).filter((t) => !t.startsWith("-"));
  return targets.length > 0 ? targets : null;
}
function checkTargetGitTracked(target, cwd) {
  if (/[*?{[]/.test(target))
    return null;
  const abs = path6.resolve(cwd, target);
  let toplevel;
  try {
    toplevel = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
  const rel = path6.relative(toplevel, abs);
  if (rel.startsWith("..") || path6.isAbsolute(rel))
    return null;
  let tracked;
  try {
    const out = execFileSync("git", ["-C", toplevel, "ls-files", "--", rel || "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    tracked = out.split("\n").filter(Boolean);
  } catch {
    return null;
  }
  if (tracked.length === 0)
    return null;
  return {
    target,
    trackedCount: tracked.length,
    samples: tracked.slice(0, 3)
  };
}
function checkRmGitTracked(command, cwd) {
  const targets = extractRmTargets(command);
  if (!targets)
    return null;
  const hits = [];
  for (const target of targets) {
    const check = checkTargetGitTracked(target, cwd);
    if (check)
      hits.push(check);
  }
  if (hits.length === 0)
    return null;
  const totalFiles = hits.reduce((a, h) => a + h.trackedCount, 0);
  return {
    reason: `rm -rf would delete ${totalFiles} file(s) tracked in git`,
    details: hits.map((h) => {
      const more = h.trackedCount > h.samples.length ? `, +${h.trackedCount - h.samples.length} more` : "";
      return `${h.target} \u2014 ${h.trackedCount} tracked file(s): ${h.samples.join(", ")}${more}`;
    }),
    command,
    ruleId: "rm-git-tracked",
    stepupResource: DEFAULT_RBAC_RESOURCE,
    stepupAction: "delete"
  };
}
function stringifyToolInput(input) {
  try {
    const s = JSON.stringify(input);
    if (s === void 0)
      return "[unserializable]";
    return s.length > 200 ? `${s.slice(0, 197)}...` : s;
  } catch {
    return "[unserializable]";
  }
}
async function recheckVerifiedSid(sid) {
  if (!resolveToken().token)
    return "trust";
  let config;
  try {
    config = loadStepupConfig();
  } catch {
    return "trust";
  }
  try {
    const { envelope, status } = await pollStepupSession(config, sid);
    if (status === "verified")
      return "trust";
    if (envelope.ok || envelope.status === 404)
      return "reauth";
    return "trust";
  } catch {
    return "trust";
  }
}
function classifyToolCall(input) {
  if (input.toolName === "Bash" || input.toolName === "run_command" || input.toolName === "Shell") {
    const cmd = input.toolInput?.command;
    if (typeof cmd !== "string")
      return null;
    return { kind: "bash", command: cmd, cwd: input.cwd };
  }
  const rules = loadEffectiveToolRules();
  const match = findFirstToolRule(input.toolName, rules);
  if (!match)
    return null;
  return {
    kind: "mcp",
    toolName: input.toolName,
    toolInput: input.toolInput,
    rule: match.matched
  };
}
async function evaluatePreToolUse(input) {
  let classified;
  try {
    classified = classifyToolCall(input);
  } catch {
    return { kind: GATE_DECISION_KIND2.PROCEED_UNGATED };
  }
  if (!classified)
    return { kind: GATE_DECISION_KIND2.PROCEED_UNGATED };
  const block = classified.kind === "bash" ? checkPatternMatch(classified.command) ?? checkRmGitTracked(classified.command, classified.cwd) : {
    reason: `matched ${classified.rule.source} tool-rule \`${classified.rule.id}\` \u2014 ${classified.rule.description}`,
    command: `${classified.toolName} ${stringifyToolInput(classified.toolInput)}`,
    ruleId: classified.rule.id,
    stepupResource: classified.rule.resource ?? DEFAULT_RBAC_RESOURCE,
    stepupAction: classified.rule.action ?? "update"
  };
  if (!block)
    return { kind: GATE_DECISION_KIND2.PROCEED_UNGATED };
  const consumeHere = classified.kind === "bash" || classified.kind === "mcp" && mcpConsumesInHook(classified.rule);
  const fingerprintKey = classified.kind === "bash" ? classified.command : `${classified.toolName}:${JSON.stringify(classified.toolInput)}`;
  const fp = consumeHere ? fingerprintOf(fingerprintKey) : void 0;
  const verified = readVerified(fp);
  if (verified) {
    if (!consumeHere || await recheckVerifiedSid(verified.sid) === "trust") {
      return {
        kind: GATE_DECISION_KIND2.PROCEED_BY_VERIFICATION,
        block,
        consumeHere,
        fp
      };
    }
    consumeVerified(fp);
    clearPending(fp);
  }
  if (!resolveToken().token) {
    return { kind: GATE_DECISION_KIND2.BLOCK_NO_TOKEN, block };
  }
  const { stepupResource: resource, stepupAction: action } = block;
  const hasRbacCoord = classified.kind === "bash" || classified.rule.action !== void 0 && classified.rule.resource !== void 0;
  let level = 2;
  if (hasRbacCoord) {
    try {
      const config = loadStepupConfig();
      level = await checkRbacPermission(config, resource, action) ?? 2;
    } catch {
      level = 2;
    }
  }
  if (level === 0) {
    return {
      kind: GATE_DECISION_KIND2.BLOCK_BY_POLICY,
      block,
      resource,
      action
    };
  }
  if (level === 1) {
    return {
      kind: GATE_DECISION_KIND2.PROCEED_BY_POLICY,
      block,
      resource,
      action
    };
  }
  const gateInput = {
    reason: block.reason,
    action,
    resource,
    fingerprintKey,
    comment: classified.kind === "bash" ? `Confirm danger command: ${block.reason}` : `Confirm ${classified.rule.id}: ${classified.rule.label}`
  };
  const req2 = await requestStepup(gateInput);
  if (!req2.ok) {
    return {
      kind: GATE_DECISION_KIND2.BLOCK_STEPUP_CREATE_FAILED,
      block,
      failure: req2
    };
  }
  const pending = {
    sid: req2.sid,
    command: block.command,
    reason: block.reason,
    browserUrl: req2.browserUrl,
    createdAt: Date.now(),
    expiresAt: req2.expiresAt,
    status: "pending",
    // FP-KEYED record for the hook-consume path; GLOBAL (no fp) otherwise.
    ...fp ? { fp } : {}
  };
  return {
    kind: GATE_DECISION_KIND2.BLOCK_STEPUP_CHALLENGED,
    block,
    sid: req2.sid,
    browserUrl: req2.browserUrl,
    browserLaunched: req2.launched,
    pending
  };
}

// ../../packages/stepup-core/dist/decision-audit.js
var DECISION_AUDIT_TAG = "guard_gate_decision";
var DECISION_AUDIT_TIMEOUT_MS = 1e3;
var LEGACY_WIRE_DECISION = {
  [GATE_DECISION_KIND2.PROCEED_BY_VERIFICATION]: "allow",
  [GATE_DECISION_KIND2.BLOCK_STEPUP_CREATE_FAILED]: "deny-stepup-failure"
};
function legacySeverity(decision) {
  return decision === GATE_DECISION_KIND2.PROCEED_BY_VERIFICATION ? "low" : "medium";
}
function decisionAuditEventOf(decision) {
  switch (decision.kind) {
    case GATE_DECISION_KIND2.PROCEED_BY_VERIFICATION:
      return {
        decision: decision.kind,
        resource: decision.block.stepupResource,
        action: decision.block.stepupAction,
        ruleId: decision.block.ruleId,
        ...decision.fp ? { fp: decision.fp } : {}
      };
    case GATE_DECISION_KIND2.BLOCK_STEPUP_CREATE_FAILED:
      if (decision.failure.reason !== "create-failed")
        return null;
      return {
        decision: decision.kind,
        resource: decision.block.stepupResource,
        action: decision.block.stepupAction,
        ruleId: decision.block.ruleId
      };
    default:
      return null;
  }
}
async function sendDecisionAudit(config, event, opts = {}) {
  try {
    const env = await request(config, {
      method: "POST",
      path: "/audit/logs",
      timeoutMs: opts.timeoutMs ?? DECISION_AUDIT_TIMEOUT_MS,
      body: {
        project_id: config.projectId,
        member_id: config.memberId,
        tag: DECISION_AUDIT_TAG,
        severity: legacySeverity(event.decision),
        status: true,
        // Wire-translation seam: send the legacy kind string the backend
        // knows, not the renamed local kind. See LEGACY_WIRE_DECISION.
        metadata: { ...event, decision: LEGACY_WIRE_DECISION[event.decision] }
      }
    });
    if (!env.ok) {
      console.error(`transcodes-guard: decision audit not recorded (status ${env.status})`);
    }
  } catch (err) {
    console.error(`transcodes-guard: decision audit not recorded (${err instanceof Error ? err.message : String(err)})`);
  }
}
async function sendGateDecisionAudit(decision) {
  const event = decisionAuditEventOf(decision);
  if (!event)
    return;
  let config;
  try {
    config = loadStepupConfig();
  } catch {
    return;
  }
  await sendDecisionAudit(config, event);
}

// ../../packages/stepup-core/dist/guard-rules.js
function requireConfig() {
  try {
    return loadStepupConfig();
  } catch {
    throw new ToolRuleValidationError("No Transcodes token configured \u2014 tool-rules are managed in the backend and require a project token.");
  }
}
function extractBackendError(data) {
  if (data && typeof data === "object" && "error" in data) {
    const e = data.error;
    if (typeof e === "string" && e.length > 0)
      return e;
  }
  return void 0;
}
function backendWriteError(env, id, op) {
  if (env.status === 409) {
    return new ToolRuleValidationError(`tool-rule "${id}" already exists`);
  }
  if (env.status === 404) {
    return new ToolRuleValidationError(`no tool-rule with id "${id}"`);
  }
  const detail = env.status === 0 ? "backend unreachable" : extractBackendError(env.data) ?? `backend responded ${env.status}`;
  return new ToolRuleValidationError(`could not ${op} tool-rule: ${detail}`);
}
function ruleToCreateBody(input, rule) {
  return {
    rule_id: rule.id,
    type: rule.type,
    label: rule.label,
    description: rule.description,
    status: input.status ?? "active",
    name: rule.name,
    matcher: rule.matcher,
    ...rule.provider !== void 0 ? { provider: rule.provider } : {},
    ...rule.action !== void 0 ? { action: rule.action } : {},
    ...rule.resource !== void 0 ? { resource: rule.resource } : {},
    ...input.metadata !== void 0 ? { metadata: input.metadata } : {}
  };
}
function ruleToUpdateBody(merged, changes) {
  const body = {
    type: merged.type,
    label: merged.label,
    description: merged.description,
    status: changes.status ?? "active",
    name: merged.name,
    matcher: merged.matcher,
    ...changes.metadata !== void 0 ? { metadata: changes.metadata } : {}
  };
  if (merged.action !== void 0) {
    body.action = merged.action;
  }
  if (merged.resource !== void 0) {
    body.resource = merged.resource;
  }
  if (merged.provider !== void 0) {
    body.provider = merged.provider;
  }
  return body;
}
function unwrapPayloadArray(data) {
  if (Array.isArray(data))
    return data;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const payload = data.payload;
    if (Array.isArray(payload))
      return payload;
  }
  return [];
}
function parseGuardRuleRecord(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw;
  const id = typeof r.id === "string" ? r.id : "";
  const type = r.type === "mcp" || r.type === "bash" ? r.type : null;
  const label = typeof r.label === "string" ? r.label : "";
  const description = typeof r.description === "string" ? r.description : "";
  const name = typeof r.name === "string" ? r.name : "";
  const matcher = r.matcher === "exact" || r.matcher === "glob" || r.matcher === "regex" ? r.matcher : type === "bash" ? "regex" : "exact";
  const status = r.status === "active" || r.status === "inactive" ? r.status : null;
  if (!id || !type || !label || !description || !name || !status)
    return null;
  const record = {
    id,
    type,
    label,
    description,
    name,
    matcher,
    status
  };
  if (typeof r.action === "string")
    record.action = r.action;
  if (typeof r.resource === "string")
    record.resource = r.resource;
  if (r.provider === "claude" || r.provider === "codex" || r.provider === "cursor" || r.provider === "antigravity") {
    record.provider = r.provider;
  }
  if (typeof r.memberId === "string")
    record.memberId = r.memberId;
  if (typeof r.createdAt === "string")
    record.createdAt = r.createdAt;
  if (typeof r.updatedAt === "string")
    record.updatedAt = r.updatedAt;
  if (r.metadata !== void 0 && r.metadata !== null && typeof r.metadata === "object") {
    record.metadata = r.metadata;
  }
  return record;
}
async function listGuardRules() {
  const config = requireConfig();
  const env = await request(config, {
    method: "GET",
    path: "/guard/rules"
  });
  if (!env.ok) {
    throw backendWriteError(env, "", "list");
  }
  return unwrapPayloadArray(env.data).map(parseGuardRuleRecord).filter((r) => r !== null);
}
async function findProjectRule(config, id) {
  if (systemToolRuleIds().has(id))
    return void 0;
  const cached = readCachedPolicyBundle(config.projectId)?.bundle.rules.find((r) => r.id === id);
  if (cached) {
    return {
      ...cached,
      type: cached.type,
      status: "active"
    };
  }
  return (await listGuardRules()).find((r) => r.id === id);
}
async function addToolRule(input) {
  const config = requireConfig();
  const rule = validateNewToolRule(input);
  const env = await request(config, {
    method: "POST",
    path: "/guard/rules",
    body: ruleToCreateBody(input, rule)
  });
  if (!env.ok)
    throw backendWriteError(env, rule.id, "add");
  await refreshPolicyBundle(config, { force: true });
  return rule;
}
async function updateToolRule(id, changes) {
  const config = requireConfig();
  if (systemToolRuleIds().has(id)) {
    throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be modified`);
  }
  const existing = await findProjectRule(config, id);
  if (!existing) {
    throw new ToolRuleValidationError(`no tool-rule with id "${id}"`);
  }
  const merged = mergeToolRuleChanges(existing, changes);
  const env = await request(config, {
    method: "PUT",
    path: `/guard/rules/${encodeURIComponent(id)}`,
    body: ruleToUpdateBody(merged, changes)
  });
  if (!env.ok)
    throw backendWriteError(env, id, "update");
  await refreshPolicyBundle(config, { force: true });
  return merged;
}
async function removeToolRule(id) {
  const config = requireConfig();
  if (systemToolRuleIds().has(id)) {
    throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be removed`);
  }
  const env = await request(config, {
    method: "DELETE",
    path: `/guard/rules/${encodeURIComponent(id)}`,
    omitBody: true
  });
  if (!env.ok)
    throw backendWriteError(env, id, "remove");
  await refreshPolicyBundle(config, { force: true });
}

// ../../packages/stepup-core/dist/inspector.js
import { readFileSync as readFileSync6 } from "fs";
var VERIFIED_BASE = "stepup-verified";
var PENDING_BASE = "stepup-pending";
var BROWSER_LOCK_BASE = "stepup-browser-lock";
var BROWSER_LOCK_TTL_MS2 = 15e3;
var COMMAND_PREVIEW_LIMIT = 120;
function readJsonFile(file) {
  try {
    const raw = readFileSync6(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return null;
}
function previewCommand(command) {
  if (command.length <= COMMAND_PREVIEW_LIMIT)
    return command;
  return `${command.slice(0, COMMAND_PREVIEW_LIMIT)}\u2026`;
}
function inspectVerifiedFile(file, now, fp) {
  const data = readJsonFile(file);
  if (!data)
    return { exists: false };
  const sid = typeof data.sid === "string" ? data.sid : null;
  const verifiedAt = typeof data.verifiedAt === "number" ? data.verifiedAt : null;
  if (!sid || verifiedAt === null)
    return { exists: false };
  const ageMs = now - verifiedAt;
  return {
    exists: true,
    sid,
    verified_at_ms: verifiedAt,
    age_ms: ageMs,
    expired: isExpiredAt(verifiedAt, void 0, now),
    ttl_ms: STEPUP_TTL_MS,
    ...fp ? { fp } : {}
  };
}
function inspectVerified(now) {
  return inspectVerifiedFile(stepupFilePath(VERIFIED_BASE), now);
}
function inspectPendingFile(file, now, fp) {
  const data = readJsonFile(file);
  if (!data)
    return { exists: false };
  const sid = typeof data.sid === "string" ? data.sid : null;
  const status = data.status === "verified" || data.status === "pending" ? data.status : null;
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : null;
  const command = typeof data.command === "string" ? data.command : null;
  const browserUrl = typeof data.browserUrl === "string" ? data.browserUrl : "";
  if (!sid || !status || createdAt === null || command === null) {
    return { exists: false };
  }
  const ageMs = now - createdAt;
  const expiresAt = typeof data.expiresAt === "string" ? data.expiresAt : void 0;
  const expired = isExpiredAt(createdAt, expiresAt, now);
  return {
    exists: true,
    sid,
    status,
    command_preview: previewCommand(command),
    browser_url: browserUrl,
    created_at_ms: createdAt,
    age_ms: ageMs,
    expired,
    expires_at: expiresAt,
    ...fp ? { fp } : {}
  };
}
function inspectPending(now) {
  return inspectPendingFile(stepupFilePath(PENDING_BASE), now);
}
function inspectBrowserLock(now) {
  const file = stepupFilePath(BROWSER_LOCK_BASE);
  const data = readJsonFile(file);
  if (!data)
    return { exists: false };
  const fingerprint = typeof data.fingerprint === "string" ? data.fingerprint : null;
  const openedAt = typeof data.openedAt === "number" ? data.openedAt : null;
  if (!fingerprint || openedAt === null)
    return { exists: false };
  const ageMs = now - openedAt;
  return {
    exists: true,
    fingerprint,
    opened_at_ms: openedAt,
    age_ms: ageMs,
    expired: isExpiredAt(openedAt, void 0, now, BROWSER_LOCK_TTL_MS2),
    ttl_ms: BROWSER_LOCK_TTL_MS2
  };
}
function inspectStepupState(now = Date.now()) {
  migrateLegacyFile(stepupFileName(VERIFIED_BASE), "cache");
  migrateLegacyFile(stepupFileName(PENDING_BASE), "cache");
  migrateLegacyFile(stepupFileName(BROWSER_LOCK_BASE), "cache");
  return {
    cache_dir: cacheDir(),
    now_ms: now,
    verified: inspectVerified(now),
    pending: inspectPending(now),
    verified_fp: listFingerprints(VERIFIED_BASE).map((fp) => inspectVerifiedFile(stepupFilePath(VERIFIED_BASE, fp), now, fp)).filter((v) => v.exists),
    pending_fp: listFingerprints(PENDING_BASE).map((fp) => inspectPendingFile(stepupFilePath(PENDING_BASE, fp), now, fp)).filter((p) => p.exists),
    browser_lock: inspectBrowserLock(now)
  };
}

// ../../packages/transcodes-mcp-tools/dist/stepup-helper.js
var RBAC_TTL_MS = 5 * 6e4;
var SYSTEM_WIRE_PREFIX = "mcp__plugin_transcodes-guard_transcodes-guard__";
var rbacCache = /* @__PURE__ */ new Map();
async function getCachedRbacLevel(config, resource, action) {
  const key = `${config.memberId}:${resource}:${action}`;
  const hit = rbacCache.get(key);
  if (hit && Date.now() < hit.exp)
    return hit.level;
  const level = await checkRbacPermission(config, resource, action) ?? 2;
  rbacCache.set(key, { level, exp: Date.now() + RBAC_TTL_MS });
  return level;
}
function resolveProtectedToolRule(toolName, rules = loadMergedToolRules()) {
  if (toolName.startsWith("mcp__")) {
    return rules.find((r) => toolNameMatchesRule(toolName, r) && ruleAppliesToHost(r));
  }
  return rules.find((r) => {
    if (r.source !== "system" || r.type !== "mcp" || r.matcher !== "exact") {
      return false;
    }
    if (!ruleAppliesToHost(r))
      return false;
    if (!r.name.startsWith(SYSTEM_WIRE_PREFIX))
      return false;
    return r.name.slice(SYSTEM_WIRE_PREFIX.length) === toolName;
  });
}
function stepupRequiredResult(toolName, rule) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          blocked: true,
          code: "STEP_UP_REQUIRED",
          message: "Step-up MFA is required before running this protected MCP tool.",
          tool: toolName,
          rule: {
            id: rule.id,
            resource: rule.resource,
            action: rule.action
          },
          next_actions: [
            "Use the host MCP tool path so the PreToolUse hook can create a step-up session.",
            "Complete WebAuthn in the opened browser window.",
            `When verification succeeds, retry ${toolName} with the same arguments.`
          ]
        }, null, 2)
      }
    ]
  };
}
async function execProtectedTool(toolName, run) {
  const verified = readVerified();
  const rule = resolveProtectedToolRule(toolName);
  if (rule?.action !== void 0 && rule.resource !== void 0) {
    let level = 2;
    try {
      const config = loadStepupConfig();
      level = await getCachedRbacLevel(config, rule.resource, rule.action);
    } catch {
      level = 2;
    }
    if (level === 0) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `transcodes-guard: BLOCKED (rbac-denied ${rule.resource}/${rule.action}) \u2014 ${toolName}`
          }
        ]
      };
    }
    if (level === 2 && !verified) {
      return stepupRequiredResult(toolName, rule);
    }
    const sid = level === 2 ? verified?.sid : void 0;
    try {
      return {
        isError: false,
        content: [{ type: "text", text: await run(sid) }]
      };
    } finally {
      if (verified) {
        consumeVerified();
        clearPending();
      }
    }
  }
  if (!verified) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            blocked: true,
            code: "STEP_UP_VERIFIED_RECORD_MISSING",
            message: "This protected MCP tool has no verified step-up record and no matching tool-rule was found.",
            tool: toolName,
            next_actions: [
              "Use the IDE MCP tool path so the PreToolUse hook can create a step-up session.",
              "If this keeps happening, check that the system tool-rule name matches the installed MCP wire name."
            ]
          }, null, 2)
        }
      ]
    };
  }
  try {
    return {
      isError: false,
      content: [{ type: "text", text: await run(verified.sid) }]
    };
  } finally {
    consumeVerified();
    clearPending();
  }
}

// ../../packages/transcodes-mcp-tools/dist/transcodes-client.js
var ENDPOINT_MAP = {
  // Project
  get_project: "/project",
  // Audit
  get_security_logs: "/audit/logs",
  // Members
  get_member: "/auth/member",
  list_members_paginated: "/auth/members/list",
  list_member_devices: "/auth/members/devices",
  create_member: "/auth/member",
  update_member: "/auth/member",
  get_member_suspension: "/auth/member/revocation",
  retire_member: "/auth/member",
  suspend_member: "/auth/member/revocation",
  unsuspend_member: "/auth/member/revocation",
  // Auth devices — authenticators
  list_authenticators: "/auth/authenticators",
  // Auth devices — passkeys
  list_passkeys: "/auth/passkeys",
  // Auth devices — TOTP
  list_totps: "/auth/totps",
  // RBAC — roles
  get_roles: "/auth/roles",
  create_role: "/auth/role",
  update_role: "/auth/role",
  check_rbac_permission: "/auth/role/check-permission",
  retire_role: "/auth/role",
  set_role_permissions: "/auth/role",
  update_member_role: "/auth/member/role",
  // RBAC — resources
  get_resources: "/auth/resources",
  create_resource: "/auth/resources",
  update_resource: "/auth/resources",
  retire_resource: "/auth/resources",
  // Membership / billing
  membership_plans: "/membership/plans",
  membership_plans_limits: "/membership/plans/limits",
  membership_customer_status_by_project: "/membership/customer/status/project",
  membership_customer_status_by_organization: "/membership/customer/status/organization",
  membership_create_checkout_session: "/membership/mcp/session",
  // Passcode
  passcode_create: "/auth/passcode/create",
  // Platform users
  user_get_current: "/user",
  user_find: "/user"
};
async function req(config, input, toolName, pathSuffix) {
  const base = ENDPOINT_MAP[toolName];
  if (!base) {
    return JSON.stringify({
      ok: false,
      blocked: true,
      message: `Tool '${toolName}' is not in this plugin's endpoint map.`
    }, null, 2);
  }
  const path7 = pathSuffix ? `${base}${pathSuffix}` : base;
  const envelope = await request(config, { ...input, path: path7 });
  return JSON.stringify(envelope, null, 2);
}
function blockedResult(message) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, blocked: true, message }, null, 2)
      }
    ]
  };
}

// ../../packages/transcodes-mcp-tools/dist/audit.js
function registerAuditTools(server) {
  server.registerTool("get_security_logs", {
    title: "Get security logs",
    description: "List project audit logs with pagination and filters. Use for security investigations, login/admin activity review, compliance. Returns tag, severity, IP, user_agent, member_id, metadata. Filter by `tag`; `start_date`/`end_date` are ISO 8601 range filters. RBAC-gated via tool-rule `tc-get-security-logs` (system/read).",
    inputSchema: {
      page: external_exports.number().optional(),
      limit: external_exports.number().optional(),
      tag: external_exports.string().optional(),
      start_date: external_exports.string().optional(),
      end_date: external_exports.string().optional()
    }
  }, async ({ page, limit, tag, start_date, end_date }) => {
    const config = loadStepupConfig();
    return execProtectedTool("get_security_logs", (sid) => req(config, {
      method: "GET",
      query: {
        project_id: config.projectId,
        page,
        limit,
        tag,
        start_date,
        end_date
      },
      stepUpSid: sid
    }, "get_security_logs"));
  });
}

// ../../packages/transcodes-mcp-tools/dist/auth-devices.js
var textResult = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerAuthDeviceTools(server) {
  server.registerTool("list_authenticators", {
    title: "List authenticators",
    description: "List all WebAuthn authenticators for a member. Separate from the passkey service. Requires member_id.",
    inputSchema: {
      member_id: external_exports.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_authenticators");
    return textResult(text);
  });
  server.registerTool("list_passkeys", {
    title: "List passkeys",
    description: "List passkeys for a member. Server typically filters by project rp_id. Requires member_id.",
    inputSchema: {
      member_id: external_exports.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_passkeys");
    return textResult(text);
  });
  server.registerTool("list_totps", {
    title: "List TOTP devices",
    description: "List TOTP devices for a member. Use to audit MFA enrollment. Requires member_id.",
    inputSchema: {
      member_id: external_exports.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_totps");
    return textResult(text);
  });
}

// ../../packages/transcodes-mcp-tools/dist/jwk.js
var MSG_JWK_BACKUP_CONSOLE = "JWK backup (encrypted download of member metadata, registered authentication methods, and audit logs) must be done in the Transcodes console. This MCP tool does not call the API.";
function registerJwkTools(server) {
  server.registerTool("jwk_backup", {
    title: "JWK backup (console-only)",
    description: "Blocked: JWK backup must be performed in the Transcodes console only. That flow yields an encrypted backup bundle that can include member metadata, authentication methods, and audit logs \u2014 not exposed through MCP.",
    inputSchema: {}
  }, async () => blockedResult(MSG_JWK_BACKUP_CONSOLE));
}

// ../../packages/transcodes-mcp-tools/dist/members.js
var textResult2 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
var MEMBER_SUSPENSION_API_NOTE = "Exact path after /v1: /auth/member/revocation (singular member, NOT members). GET=query only; POST=suspend body; DELETE=unsuspend body. No PUT, PATCH, or /member/suspend.";
function registerMemberTools(server) {
  server.registerTool("get_member", {
    title: "Get member",
    description: "Get one member profile. Pass `member_id` OR `email` \u2014 at least one is required (never omit both). Use for support lookups and auth debugging.",
    inputSchema: {
      member_id: external_exports.string().optional(),
      email: external_exports.string().optional()
    }
  }, async ({ member_id, email }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: {
        project_id: config.projectId,
        member_id,
        email
      }
    }, "get_member");
    return textResult2(text);
  });
  server.registerTool("list_members_paginated", {
    title: "List members (paginated)",
    description: "Paginated member list without search. Fast for large directories; use sort_by/order.",
    inputSchema: {
      page: external_exports.number().optional(),
      limit: external_exports.number().optional(),
      sort_by: external_exports.enum(["created_at", "updated_at"]).optional(),
      order: external_exports.enum(["asc", "desc"]).optional()
    }
  }, async ({ page, limit, sort_by, order }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: {
        project_id: config.projectId,
        page,
        limit,
        sort_by,
        order
      }
    }, "list_members_paginated");
    return textResult2(text);
  });
  server.registerTool("list_member_devices", {
    title: "List member devices",
    description: "Summary of passkeys, authenticators, and TOTP devices for a member. Labels and last-used timestamps. Use to audit MFA surface.",
    inputSchema: {
      member_id: external_exports.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "list_member_devices");
    return textResult2(text);
  });
  server.registerTool("get_member_suspension", {
    title: "Get member suspension status",
    description: "Check whether a member is currently suspended and when it was applied. Returns { revoked_at: ISO date string } if suspended, or { revoked_at: null } if active. Read-only. " + MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      member_id: external_exports.string()
    }
  }, async ({ member_id }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id }
    }, "get_member_suspension");
    return textResult2(text);
  });
  server.registerTool("retire_member", {
    title: "Retire member (permanent)",
    description: "PERMANENTLY delete a member from the project (kill switch \u2014 irreversible). Use only when the user wants to fully delete / remove a member; for a temporary block use suspend_member. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-member`). Body: { member_id } \u2014 project_id comes from TRANSCODES_TOKEN.",
    inputSchema: {
      body: external_exports.object({ member_id: external_exports.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("retire_member", (sid) => req(config, {
      method: "DELETE",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "retire_member"));
  });
  server.registerTool("suspend_member", {
    title: "Suspend member (reversible)",
    description: "Temporarily SUSPEND a member: blocks login and invalidates active sessions. Reversible via unsuspend_member. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-suspend-member`). " + MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      body: external_exports.object({ member_id: external_exports.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("suspend_member", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "suspend_member"));
  });
  server.registerTool("unsuspend_member", {
    title: "Unsuspend member",
    description: "Lift a member's suspension and restore their ability to log in and create sessions. Use only on members previously suspended. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-unsuspend-member`). " + MEMBER_SUSPENSION_API_NOTE,
    inputSchema: {
      body: external_exports.object({ member_id: external_exports.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("unsuspend_member", (sid) => req(config, {
      method: "DELETE",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "unsuspend_member"));
  });
  server.registerTool("create_member", {
    title: "Create member",
    description: "Create a member (CreateMemberDto). member_id/name may be auto-generated. Use for onboarding or manual provisioning. RBAC-gated via tool-rule `tc-create-member` (0=block, 1=allow, 2=step-up MFA). Auth: TRANSCODES_TOKEN sent as x-transcodes-token (not in body).",
    inputSchema: {
      body: external_exports.object({
        email: external_exports.string(),
        name: external_exports.string().optional(),
        role: external_exports.string().optional(),
        metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("create_member", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "create_member"));
  });
  server.registerTool("update_member", {
    title: "Update member",
    description: "Update member PROFILE fields \u2014 name, email, metadata (UpdateMemberDto, flat shape). RBAC-gated via tool-rule `tc-update-member` (0=block, 1=allow, 2=step-up MFA). member_id is required \u2014 supply the target member explicitly (it may differ from the caller). To REASSIGN a member's ROLE, use `update_member_role` instead: it validates the role exists (this tool writes `role` straight through with no validation). Prefer omitting `role` here.",
    inputSchema: {
      body: external_exports.object({
        member_id: external_exports.string(),
        name: external_exports.string().optional(),
        email: external_exports.string().optional(),
        role: external_exports.string().optional(),
        metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("update_member", (sid) => req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "update_member"));
  });
}

// ../../packages/transcodes-mcp-tools/dist/membership.js
var textResult3 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerMembershipTools(server) {
  server.registerTool("membership_plans", {
    title: "Membership plans",
    description: "Returns the full list of available Transcodes membership plans (free, standard, business, enterprise) including price, currency, billing interval, and Stripe product metadata. This is a public endpoint \u2014 no authentication required. Use this tool to display plan options to users or to look up the price_id needed for membership_create_checkout_session.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "membership_plans");
    return textResult3(text);
  });
  server.registerTool("membership_plans_limits", {
    title: "Membership plan limits",
    description: "Returns the resource limits enforced per plan tier. Each plan entry includes: projects (max projects allowed), roles, resources, members (max members per project), and price (monthly USD, null = contact for pricing). Free tier: 1 project / 2 roles / 2 resources / 2 members. Standard: 5 projects / unlimited roles & resources / 10 members. Business & Enterprise: unlimited everything. Use this to build pricing comparison UI or to warn users when they are approaching a limit.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "membership_plans_limits");
    return textResult3(text);
  });
  server.registerTool("membership_customer_status_by_project", {
    title: "Customer status by project",
    description: "Returns the active subscription status of the organization that owns the project in TRANSCODES_TOKEN (pid claim). SkipAuth \u2014 GET /v1/membership/customer/status/project?project_id=... Useful when the SDK Toolkit only carries a project context.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "membership_customer_status_by_project");
    return textResult3(text);
  });
  server.registerTool("membership_customer_status_by_organization", {
    title: "Customer status by organization",
    description: "Returns the active subscription status for the organization in TRANSCODES_TOKEN (oid claim). SkipAuth \u2014 GET /v1/membership/customer/status/organization?organization_id=... Preferred when the caller already knows the organization (avoids the project \u2192 organization lookup).",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { organization_id: config.organizationId } }, "membership_customer_status_by_organization");
    return textResult3(text);
  });
  server.registerTool("membership_create_checkout_session", {
    title: "Create checkout session",
    description: 'MCP checkout: POST /v1/membership/mcp/session \u2014 creates a Stripe Checkout session for the organization bound to the MAT (x-transcodes-token) and returns a one-time redirect URL. Use for plan upgrade or first purchase (e.g. free \u2192 standard). Body: price_id from membership_plans; optional mode: "subscription" (default) | "payment" | "setup". Organization is resolved server-side from the authenticated principal \u2014 do not pass organization_id in the body. The returned URL expires after a short window \u2014 redirect the user immediately after receiving it.',
    inputSchema: {
      body: external_exports.object({
        price_id: external_exports.string(),
        mode: external_exports.enum(["subscription", "payment", "setup"]).optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "POST", body }, "membership_create_checkout_session");
    return textResult3(text);
  });
}

// ../../packages/transcodes-mcp-tools/dist/meta.js
var INSTRUCTIONS_URL = "https://transcodes.io/instructions";
var textResult4 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerMetaTools(server) {
  server.registerTool("get_current_project_id", {
    title: "Get current project id",
    description: "Returns the active project ID parsed from TRANSCODES_TOKEN. Call this tool first when you need the project ID instead of asking the user.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    return textResult4(JSON.stringify({ ok: true, project_id: config.projectId }, null, 2));
  });
  server.registerTool("get_current_organization_id", {
    title: "Get current organization id",
    description: "Returns organizationId from TRANSCODES_TOKEN JWT.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    return textResult4(JSON.stringify({ ok: true, organization_id: config.organizationId }, null, 2));
  });
  server.registerTool("get_current_member_id", {
    title: "Get current member id",
    description: "Returns memberId from TRANSCODES_TOKEN JWT.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    return textResult4(JSON.stringify({ ok: true, member_id: config.memberId }, null, 2));
  });
  server.registerTool("get_my_profile", {
    title: "Get my profile",
    description: 'Returns the profile of the member identified by TRANSCODES_TOKEN (organizationId, projectId, memberId in config). Use when the user asks "who am I", "show my profile", or "show my member info". No arguments needed.',
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { project_id: config.projectId, member_id: config.memberId }
    }, "get_member");
    return textResult4(text);
  });
  server.registerTool("get_console_url", {
    title: "Get console URL",
    description: "Mint a step-up-protected console URL. Console access is gated behind step-up MFA via POST .../console/session; this tool returns the browser URL the user must visit to authenticate (WebAuthn) before reaching the console. Use when the user needs to perform browser-only actions: passkey register/update/revoke, authenticator register/update/revoke, TOTP enroll/update/revoke, OTP flows, JWK backup, or subscription portal (cancel, payment method, invoices). Direct the user to visit the returned browser_url and complete the action there.",
    inputSchema: {}
  }, async () => {
    const result = await openConsoleSession({
      openBrowser: false,
      comment: "Open the Transcodes console (browser-only action)"
    });
    if (!result.ok) {
      return textResult4(JSON.stringify({
        ok: false,
        reason: result.reason,
        detail: result.detail,
        message: "Could not mint a console step-up session. Check the token and backend connectivity"
      }, null, 2), true);
    }
    return textResult4(JSON.stringify({
      ok: true,
      sid: result.sid,
      browser_url: result.browserUrl,
      expires_at: result.expiresAt,
      message: "Console access is protected by step-up MFA. Direct the user to browser_url to authenticate, then complete the browser-only action."
    }, null, 2));
  });
  server.registerTool("get_integration_guide", {
    title: "Get integration guide",
    description: "IMPORTANT: You MUST call this tool BEFORE writing ANY Transcodes-related code. Fetches the official Transcodes integration guide (llms.txt) \u2014 the single source of truth for all implementation details. Trigger keywords: install, setup, integrate, SDK, passkey, auth, login, signup, redirect, step-up, MFA, JWT, token, audit, webhook, RBAC, role, CDN, webworker, sign-in, sign-out, session, member, console, admin, IDP, OTP, TOTP, biometric, WebAuthn. The returned guide contains exact API signatures, code examples, framework setup (React, Next.js, Vue, Vite), CSP rules, JWT verification, and common mistakes. You MUST follow it instead of guessing. Call once per conversation \u2014 the result stays in context for follow-up requests.",
    inputSchema: {
      topic: external_exports.string().optional()
    }
  }, async ({ topic }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15e3);
    try {
      const response = await fetch(INSTRUCTIONS_URL, {
        headers: { Accept: "text/plain" },
        signal: controller.signal
      });
      const content = await response.text();
      const trimmed = topic?.trim();
      if (trimmed) {
        return textResult4(JSON.stringify({ topic: trimmed, instructions: content }, null, 2));
      }
      return textResult4(content);
    } catch (err) {
      return textResult4(`Could not fetch the integration guide: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      clearTimeout(timer);
    }
  });
}

// ../../packages/transcodes-mcp-tools/dist/organization.js
var MSG_PLATFORM_CONSOLE = "User creation must be done in the Transcodes console. This MCP tool does not call the API.";
var textResult5 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
function registerOrganizationTools(server) {
  server.registerTool("user_get_current", {
    title: "Get current user",
    description: 'Returns the currently authenticated platform user (Firebase/console account). Use when the user asks "who am I" at the platform-user level (distinct from `get_my_profile`, which returns the member record for TRANSCODES_TOKEN).',
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "user_get_current");
    return textResult5(text);
  });
  server.registerTool("user_find", {
    title: "Find user",
    description: "Find platform users by comma-separated ids or emails. Pass `ids` and/or `emails`.",
    inputSchema: {
      ids: external_exports.string().optional().describe("comma-separated user ids"),
      emails: external_exports.string().optional().describe("comma-separated emails")
    }
  }, async ({ ids, emails }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "GET",
      query: { ids, emails }
    }, "user_find", "/find");
    return textResult5(text);
  });
  server.registerTool("user_create", {
    title: "Create user (console-only)",
    description: "Blocked: user creation must be done in the Transcodes console.",
    inputSchema: {}
  }, async () => blockedResult(MSG_PLATFORM_CONSOLE));
}

// ../../packages/transcodes-mcp-tools/dist/passcode.js
function registerPasscodeTools(server) {
  server.registerTool("passcode_create", {
    title: "Create recovery passcode",
    description: "Create a recovery passcode (CreatePasscodeDto in body). RBAC-gated via tool-rule `tc-passcode-create` (0=block, 1=allow, 2=step-up MFA). Use for onboarding, support, or admin provisioning.",
    inputSchema: {
      body: external_exports.object({ member_id: external_exports.string() })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("passcode_create", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "passcode_create"));
  });
}

// ../../packages/transcodes-mcp-tools/dist/project.js
var DEFAULT_CDN_BASE_URL = "https://cdn.transcodes.link";
var ASSET_CHECK_TIMEOUT_MS = 5e3;
var AUTH_APP_URL_PROD = "https://auth.transcodes.io";
var AUTH_APP_URL_DEV = "https://auth.automexpert.com";
var textResult6 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
var PROJECT_ASSETS = [
  ["auth_sdk", "authentication", "webworker.js"],
  ["pwa_manifest", "installable_pwa", "manifest.json"],
  ["pwa_service_worker", "installable_pwa", "sw.js"]
];
var MSG_PROJECT_PWA_AUTH_CONSOLE = "Authentication and console configuration (manifest, service worker, widget, branding, WebAuthn, related origins, token expiry, etc.) must be performed in the Transcodes console. Changes to these settings require the project SDK to be rebuilt and redeployed \u2014 a process that the console handles automatically. Modifying them directly via API without going through the console build pipeline will leave the deployed SDK out of sync with your configuration. This MCP tool does not call the API.";
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function toOrigin(value) {
  if (typeof value !== "string" || !value.trim())
    return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
function resolveAuthHostOrigins() {
  return new Set([AUTH_APP_URL_PROD, AUTH_APP_URL_DEV].map(toOrigin).filter((origin) => Boolean(origin)));
}
function resolveCdnBaseUrl() {
  const value = process.env.TRANSCODES_CDN_BASE_URL?.trim() || DEFAULT_CDN_BASE_URL;
  try {
    return new URL(value).href.replace(/\/$/, "");
  } catch {
    throw new Error(`CDN base URL is not valid: ${value}`);
  }
}
function extractProjectPayload(envelope) {
  if (!isRecord(envelope) || !isRecord(envelope.data))
    return null;
  const { payload } = envelope.data;
  const project = Array.isArray(payload) ? payload[0] : payload;
  return isRecord(project) ? project : null;
}
async function fetchWithTimeout(fetcher, url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_CHECK_TIMEOUT_MS);
  try {
    return await fetcher(url, { method, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function probeAsset(url, fetcher) {
  try {
    let response = await fetchWithTimeout(fetcher, url, "HEAD");
    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(fetcher, url, "GET");
    }
    const status = response.ok ? "available" : response.status === 404 ? "missing" : "unreachable";
    return { status, http_status: response.status, ok: response.ok };
  } catch (err) {
    return {
      status: "unreachable",
      http_status: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function checkRelatedOriginRegistration(project, redirectUriOrOrigin) {
  const checkedOrigin = toOrigin(redirectUriOrOrigin);
  if (!checkedOrigin) {
    return {
      ok: false,
      message: "redirect_uri or origin must be a valid URL."
    };
  }
  const authHostOrigins = resolveAuthHostOrigins();
  const relatedOrigins = Array.isArray(project.authentication?.related_origins) ? project.authentication.related_origins : [];
  const registeredOrigins = /* @__PURE__ */ new Set();
  const ignoredRelatedOrigins = [];
  for (const candidate of relatedOrigins) {
    const origin = toOrigin(candidate);
    if (origin) {
      registeredOrigins.add(origin);
    } else {
      ignoredRelatedOrigins.push(candidate);
    }
  }
  const domainOrigin = toOrigin(project.domain_url);
  const domainUrlCountsAsRedirectOrigin = domainOrigin !== null && !authHostOrigins.has(domainOrigin);
  if (domainUrlCountsAsRedirectOrigin && domainOrigin) {
    registeredOrigins.add(domainOrigin);
  }
  const matched = registeredOrigins.has(checkedOrigin);
  return {
    ok: matched,
    checked_origin: checkedOrigin,
    registered_origins: [...registeredOrigins],
    source: {
      domain_url: project.domain_url ?? null,
      domain_url_origin: domainOrigin,
      domain_url_counts_as_redirect_origin: domainUrlCountsAsRedirectOrigin,
      related_origins: relatedOrigins,
      ignored_related_origins: ignoredRelatedOrigins,
      auth_host_origins: [...authHostOrigins]
    },
    diagnostics: matched ? [
      "This redirect origin is registered for sign-in callbacks.",
      "WebAuthn credentials still live on the hosted auth origin; related_origins is only the redirect allow-list for sign-in callbacks."
    ] : [
      "redirect_uri origin is not registered for this project.",
      "Add the checked_origin to Transcodes Console > Project > Authentication > Related origins, then rebuild/redeploy the project SDK from the console."
    ],
    next_action: matched ? null : {
      add_related_origin: checkedOrigin,
      console_path: "Transcodes Console > Project > Authentication > Related origins"
    }
  };
}
async function checkProjectAssets(projectId, fetcher = fetch) {
  const baseUrl = resolveCdnBaseUrl();
  const assets = await Promise.all(PROJECT_ASSETS.map(async ([kind, requiredFor, file]) => {
    const url = `${baseUrl}/${encodeURIComponent(projectId)}/${file}`;
    return {
      kind,
      required_for: requiredFor,
      file,
      url,
      ...await probeAsset(url, fetcher)
    };
  }));
  const auth = assets.find((asset) => asset.kind === "auth_sdk");
  const pwaAssets = assets.filter((asset) => asset.required_for === "installable_pwa");
  const pwaState = pwaAssets.some((asset) => asset.status === "unreachable") ? "unreachable" : pwaAssets.every((asset) => asset.status === "available") ? "configured" : pwaAssets.every((asset) => asset.status === "missing") ? "not_configured_or_missing" : "partial";
  const authOk = auth?.status === "available";
  return {
    ok: authOk,
    project_id: projectId,
    cdn_base_url: baseUrl,
    summary: {
      auth_sdk: auth?.status ?? "unreachable",
      auth_sdk_ok: authOk,
      pwa_assets: pwaState
    },
    assets,
    diagnostics: [
      authOk ? "Authentication SDK webworker.js is available. Missing install assets do not block authentication-only setup." : "Authentication SDK webworker.js is not available. Check project ID, CDN base URL, and Console SDK build state.",
      pwaState === "configured" ? "Web App Kit assets (manifest.json, sw.js) are available." : pwaState === "unreachable" ? "Web App Kit asset state is unclear because one or more assets could not be checked." : "Web App Kit assets are missing or partial. Treat this separately from auth SDK availability."
    ]
  };
}
async function loadProjectForOriginCheck() {
  const config = loadStepupConfig();
  const text = await req(config, { method: "GET" }, "get_project", `/${config.projectId}`);
  const envelope = JSON.parse(text);
  if (isRecord(envelope) && envelope.ok === false) {
    throw new Error(`Could not fetch project: ${text}`);
  }
  const project = extractProjectPayload(envelope);
  if (!project) {
    throw new Error(`Could not read project payload: ${text}`);
  }
  return project;
}
function registerProjectTools(server) {
  server.registerTool("get_project", {
    title: "Get project",
    description: "Fetch the active project (fixed by TRANSCODES_TOKEN pid claim). Returns all information about the project \u2014 including toolkit, domain_url, title, description, and created/updated timestamps. No arguments \u2014 project is determined by the token.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET" }, "get_project", `/${config.projectId}`);
    return textResult6(text);
  });
  server.registerTool("check_related_origin", {
    title: "Check sign-in related origin",
    description: "Read-only diagnostic for hosted sign-in redirect setup. Checks whether a redirect_uri/origin is present in the active project authentication.related_origins allow-list, matching the backend sign-in callback policy.",
    inputSchema: {
      redirect_uri: external_exports.string().optional(),
      origin: external_exports.string().optional()
    }
  }, async ({ redirect_uri, origin }) => {
    try {
      const target = redirect_uri?.trim() || origin?.trim();
      if (!target) {
        return textResult6(JSON.stringify({
          ok: false,
          message: "Pass redirect_uri or origin."
        }, null, 2), true);
      }
      const project = await loadProjectForOriginCheck();
      const report = checkRelatedOriginRegistration(project, target);
      return textResult6(JSON.stringify(report, null, 2), !report.ok);
    } catch (err) {
      return textResult6(JSON.stringify({
        ok: false,
        message: `Could not check related origin: ${err instanceof Error ? err.message : String(err)}`
      }, null, 2), true);
    }
  });
  server.registerTool("check_project_assets", {
    title: "Check project CDN assets",
    description: "Read-only CDN asset diagnostic for the active project. Separates Authentication-only SDK availability (`webworker.js`) from optional Web App Kit install assets (`manifest.json`, `sw.js`) so missing manifest/sw.js is not mistaken for auth failures. Use when webworker/manifest/sw.js status, CDN setup, auth-only install, or installable app assets are unclear.",
    inputSchema: {}
  }, async () => {
    try {
      const config = loadStepupConfig();
      const report = await checkProjectAssets(config.projectId);
      return textResult6(JSON.stringify(report, null, 2), !report.ok);
    } catch (err) {
      return textResult6(JSON.stringify({
        ok: false,
        message: `Could not check project assets: ${err instanceof Error ? err.message : String(err)}`
      }, null, 2), true);
    }
  });
  server.registerTool("project_pwa_auth_console", {
    title: "Auth config (console-only)",
    description: "Blocked: Authentication and console configuration (manifest, service worker, branding, WebAuthn, related origins, token expiry, etc.) must be done in the Transcodes console. These settings trigger an SDK rebuild and redeployment \u2014 a pipeline the console manages automatically. Applying changes directly via API skips that pipeline and leaves the live SDK out of sync with the new configuration.",
    inputSchema: {}
  }, async () => blockedResult(MSG_PROJECT_PWA_AUTH_CONSOLE));
}

// ../../packages/transcodes-mcp-tools/dist/rbac.js
var textResult7 = (text, isError = false) => ({
  isError,
  content: [{ type: "text", text }]
});
var PROJECT_ID_GUIDANCE = "project_id in the body must be the TRANSCODES_TOKEN project id (pid claim); it is not configurable per tool call.";
var PermissionLevel = external_exports.union([external_exports.literal(0), external_exports.literal(1), external_exports.literal(2)]);
var ResourcePermissions = external_exports.object({
  create: PermissionLevel.optional(),
  read: PermissionLevel.optional(),
  update: PermissionLevel.optional(),
  delete: PermissionLevel.optional()
});
function registerRbacTools(server) {
  server.registerTool("get_roles", {
    title: "Get roles",
    description: "List all roles and permission matrix for a project. Use when you need RBAC data for console parity or to know which roles can be assigned.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "get_roles");
    return textResult7(text);
  });
  server.registerTool("get_resources", {
    title: "Get resources",
    description: "List RBAC resource keys for a project. Use before editing roles or building permission UI.",
    inputSchema: {}
  }, async () => {
    const config = loadStepupConfig();
    const text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "get_resources");
    return textResult7(text);
  });
  server.registerTool("check_rbac_permission", {
    title: "Check RBAC permission",
    description: "Simulate whether a member may access a resource+action (SkipAuth). Returns denied/allowed; if allowed, may include stepUpRequired. Use for guard/debugging before routing.",
    inputSchema: {
      body: external_exports.object({
        member_id: external_exports.string(),
        resource: external_exports.string(),
        action: external_exports.enum(["create", "read", "update", "delete"])
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    const text = await req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId }
    }, "check_rbac_permission");
    return textResult7(text);
  });
  server.registerTool("retire_role", {
    title: "Retire role",
    description: "Retire a role from the project. Use when the user wants to remove, drop, or discard a role. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-role`). Body { project_id } is injected from TRANSCODES_TOKEN by the server.",
    inputSchema: {
      role_id: external_exports.string()
    }
  }, async ({ role_id }) => {
    const config = loadStepupConfig();
    return execProtectedTool("retire_role", (sid) => req(config, {
      method: "DELETE",
      body: { project_id: config.projectId },
      stepUpSid: sid
    }, "retire_role", `/${encodeURIComponent(role_id)}`));
  });
  server.registerTool("set_role_permissions", {
    title: "Set role permissions",
    description: "Set per-resource permission matrix for a role. 0=deny, 1=allow, 2=allow+step-up. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-set-role-permissions`).",
    inputSchema: {
      role_id: external_exports.string(),
      body: external_exports.object({
        permissions: external_exports.record(external_exports.string(), ResourcePermissions)
      })
    }
  }, async ({ role_id, body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("set_role_permissions", (sid) => req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "set_role_permissions", `/${encodeURIComponent(role_id)}/permissions`));
  });
  server.registerTool("update_member_role", {
    title: "Update member role",
    description: "Change a member's assigned role (UpdateMemberRoleDto) \u2014 the canonical role-reassignment path. Validates the target role EXISTS in the project before assigning (unlike `update_member`, which writes `role` unchecked). Use this whenever the user wants to change a member's role. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-update-member-role`).",
    inputSchema: {
      body: external_exports.object({
        member_id: external_exports.string(),
        role: external_exports.string()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("update_member_role", (sid) => req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "update_member_role"));
  });
  server.registerTool("retire_resource", {
    title: "Retire resource",
    description: "Retire a resource key from the project. Use when the user wants to remove, drop, or discard a resource. Verified action \u2014 step-up MFA enforced by the PreToolUse hook (tool-rule `tc-retire-resource`). Path: resource_key. Query: project_id. No JSON body.",
    inputSchema: {
      resource_key: external_exports.string()
    }
  }, async ({ resource_key }) => {
    const config = loadStepupConfig();
    return execProtectedTool("retire_resource", (sid) => req(config, {
      method: "DELETE",
      query: { project_id: config.projectId },
      omitBody: true,
      stepUpSid: sid
    }, "retire_resource", `/${encodeURIComponent(resource_key)}`));
  });
  server.registerTool("create_role", {
    title: "Create role",
    description: "Create a new role (CreateRoleDto). Use before set_role_permissions to fill per-resource access. RBAC-gated via tool-rule `tc-create-role` (0=block, 1=allow, 2=step-up MFA). " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      body: external_exports.object({
        name: external_exports.string(),
        description: external_exports.string().optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("create_role", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "create_role"));
  });
  server.registerTool("update_role", {
    title: "Update role",
    description: "Update role metadata (UpdateRoleDto). RBAC-gated via tool-rule `tc-update-role` (0=block, 1=allow, 2=step-up MFA). " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      role_id: external_exports.string(),
      body: external_exports.object({
        description: external_exports.string().optional()
      })
    }
  }, async ({ role_id, body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("update_role", (sid) => req(config, {
      method: "PUT",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "update_role", `/${encodeURIComponent(role_id)}`));
  });
  server.registerTool("create_resource", {
    title: "Create resource",
    description: "Add a new resource key (CreateResourceDto). Every existing role is initialized with the default permission matrix for the new key: read = allow (1), and create/update/delete = allow + step-up MFA (2). RBAC-gated via tool-rule `tc-create-resource` (0=block, 1=allow, 2=step-up MFA). " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      body: external_exports.object({
        key: external_exports.string(),
        name: external_exports.string(),
        description: external_exports.string().optional()
      })
    }
  }, async ({ body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("create_resource", (sid) => req(config, {
      method: "POST",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "create_resource"));
  });
  server.registerTool("update_resource", {
    title: "Update resource",
    description: "Update resource label/description (UpdateResourceDto). Key stays the same. RBAC-gated via tool-rule `tc-update-resource` (0=block, 1=allow, 2=step-up MFA). " + PROJECT_ID_GUIDANCE,
    inputSchema: {
      resource_key: external_exports.string(),
      body: external_exports.object({
        description: external_exports.string().optional()
      })
    }
  }, async ({ resource_key, body }) => {
    const config = loadStepupConfig();
    return execProtectedTool("update_resource", (sid) => req(config, {
      method: "PATCH",
      body: { ...body, project_id: config.projectId },
      stepUpSid: sid
    }, "update_resource", `/${encodeURIComponent(resource_key)}`));
  });
}

// ../../packages/transcodes-mcp-tools/dist/rbac-validate.js
var RbacCoordinateError = class extends Error {
};
function extractResourceKeys(data) {
  const items = Array.isArray(data) ? data : data && typeof data === "object" ? (() => {
    const rec = data;
    for (const k of ["payload", "resources", "data", "items", "result"]) {
      if (Array.isArray(rec[k]))
        return rec[k];
    }
    return [];
  })() : [];
  const keys = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (typeof item === "string") {
      if (item.trim())
        keys.add(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item;
      const key = rec.key ?? rec.resource_key ?? rec.resourceKey ?? rec.name ?? rec.id;
      if (typeof key === "string" && key.trim())
        keys.add(key.trim());
    }
  }
  return [...keys];
}
async function fetchRbacResourceKeys(config) {
  let text;
  try {
    text = await req(config, { method: "GET", query: { project_id: config.projectId } }, "get_resources");
  } catch {
    return null;
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return null;
  }
  if (envelope.ok !== true)
    return null;
  const keys = extractResourceKeys(envelope.data);
  return keys.length > 0 ? keys : null;
}
async function assertRbacCoordinate(config, resource, action) {
  if (!isRbacAction(action.trim())) {
    throw new RbacCoordinateError(`action must be one of ${RBAC_ACTIONS.join("|")} (got: "${action}")`);
  }
  const keys = await fetchRbacResourceKeys(config);
  if (keys === null) {
    throw new RbacCoordinateError("could not fetch RBAC resources from the backend to validate `resource` (network failure, auth error, empty project resources, or unparseable response). The token is read from ~/.transcodes/config.json (written by the transcodes CLI). If `get_resources` already succeeded, retry after updating the plugin build. Inspect valid resources with the `get_resources` tool.");
  }
  if (!keys.includes(resource.trim())) {
    throw new RbacCoordinateError(`resource "${resource}" is not a known RBAC resource for this project. Valid resources: ${keys.join(", ")}. Call \`get_resources\` to inspect, or create it first with \`create_resource\`.`);
  }
}

// ../../packages/gate-backend/dist/index.js
var transcodesGateBackend = {
  // hook path — direct bindings
  evaluatePreToolUse,
  writePending,
  consumeVerified,
  clearPending,
  firstActivePending,
  firstInFlightFpPending,
  readPending,
  readVerified,
  isExpired,
  sweepStepup,
  hasToken: () => Boolean(resolveToken().token),
  sendGateDecisionAudit,
  refreshPolicyBundle: async () => {
    return refreshPolicyBundleIfConfigured({ force: true });
  },
  // server path: step-up session — config loaded internally
  createStepupSession: (args) => createStepupSession(loadStepupConfig(), args),
  pollStepupSession: (sid) => pollStepupSession(loadStepupConfig(), sid),
  pollStepupSessionWait: (sid, options) => pollStepupSessionWait(loadStepupConfig(), sid, options),
  inspectStepupState,
  findPendingBySid,
  writeVerified,
  markVerified,
  // server path: RBAC coordinate — config loaded internally, error wrapped
  assertRbacCoordinate: (resource, action) => assertRbacCoordinate(loadStepupConfig(), resource, action),
  isRbacCoordinateError: (e) => e instanceof RbacCoordinateError,
  // server path: tool-rule registry — the effective set includes the cached
  // org policy bundle layer (G3): baseline → bundle → user.
  loadMergedToolRules: loadEffectiveToolRules,
  loadEffectivePatterns,
  findFirstToolRule,
  addToolRule,
  updateToolRule,
  removeToolRule,
  isToolRuleValidationError: (e) => e instanceof ToolRuleValidationError,
  // server path: backend-coupled MCP tools
  registerBackendTools: (server) => {
    registerMemberTools(server);
    registerRbacTools(server);
    registerPasscodeTools(server);
    registerProjectTools(server);
    registerAuditTools(server);
    registerAuthDeviceTools(server);
    registerMembershipTools(server);
    registerMetaTools(server);
    registerOrganizationTools(server);
    registerJwkTools(server);
  }
};

// backend.ts
setGateBackend(transcodesGateBackend);

export {
  __commonJS,
  __export,
  __toESM,
  findFirstMatch,
  currentHostProvider,
  ruleAppliesToHost,
  ZodOptional,
  ZodFirstPartyTypeKind,
  objectType,
  external_exports,
  GATE_DECISION_KIND,
  formatNoTokenSessionNotice,
  formatAllowReason,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatRbacDeniedReason,
  formatRbacDeniedSystemMessage,
  formatStepupFailureReason,
  formatStepupFailureSystemMessage,
  formatStepupPendingReason,
  formatStepupPendingSystemMessage,
  formatStderrTag,
  getGateBackend
};
