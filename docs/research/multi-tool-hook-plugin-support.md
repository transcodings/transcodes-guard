# Codex · Antigravity · Cursor — Hook/Plugin 호환 지원 리서치

> 날짜: 2026-05-25 (Asia/Seoul) | 키워드: Codex CLI / Google Antigravity 2.0 / Cursor — hook · MCP · plugin 매니페스트 비교, ai-action-tracker 다중 호스트 포팅 전략
>
> **개정 이력**
> - **2026-05-25 v2 (Antigravity 2.0 refresh)** — 2026-05-19 Google I/O 키노트에서 발표된 Antigravity 2.0 (standalone desktop app + CLI + SDK + Managed Agents)을 기준으로 Antigravity 관련 모든 섹션을 재작성. 핵심 변경: ① Antigravity의 hook 설정 파일 형식이 Claude Code와 1:1 동일 확인(`${CLAUDE_PLUGIN_ROOT}` 변수 그대로 재사용), ② before/after model call 등 2종 신규 hook event 발견, ③ Dynamic Subagents는 static + 런타임 둘 다 가능, ④ Antigravity 포팅 난이도 **상 → 중** 하향, ⑤ 1.0 → 2.0 backwards-compat break 3건 추가.
> - **2026-05-25 v1 (initial)** — Codex / Antigravity 1.0 / Cursor 3-tool 비교 초안.

## 한줄 요약

OpenAI Codex(2026), **Google Antigravity 2.0 (Google I/O 2026)**, Cursor(2025-2026) 모두 **Claude Code와 동일 형태의 PreToolUse-style hook + MCP server + plugin 번들**을 정식 지원한다. 특히 Antigravity 2.0는 hook 설정 파일을 Claude Code와 사실상 그대로 차용(`${CLAUDE_PLUGIN_ROOT}` placeholder 동일 사용)했으므로, 현재 `plugins/ai-action-tracker`의 step-up MFA 게이트 로직은 **이벤트 이름 매핑 + 출력 JSON 평탄도 어댑터** 두 가지만 추가하면 4개 호스트 모두에 그대로 이식 가능하다. 권장 모노레포 재편: `packages/stepup-core/`(MCP·hook 무관 순수 로직) + `plugins/{claude-code,codex,antigravity,cursor}-ai-action-tracker/`(호스트별 매니페스트 + 얇은 hook entry script).

## 핵심 발견사항

| # | 발견사항 | 소스 유형 | 신뢰도 |
|---|---------|----------|--------|
| 1 | 4개 도구(Claude Code, Codex, Antigravity, Cursor) 모두 **stdin JSON → 외부 스크립트 → stdout JSON**으로 tool call을 deny/allow/rewrite하는 동일 패턴을 채택했다 | 4 공식문서 + StacklokLabs/cursor-hooks + Noma Security | 높음 |
| 2 | Codex hook event 이름은 Claude Code와 **거의 1:1** (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `UserPromptSubmit`, `PreCompact`/`PostCompact`, `SubagentStart/Stop`) 이며 `hookSpecificOutput.permissionDecision` JSON contract까지 동일하다 | developers.openai.com/codex/hooks + DeepWiki | 높음 |
| 3 | Cursor는 이벤트 이름이 **camelCase** (`preToolUse`, `beforeShellExecution`, `beforeMCPExecution`)이고 출력이 **평면 `{permission: "deny", user_message, agent_message, updated_input}`** 으로 다르다 | cursor.com/docs/hooks + TrueFoundry mirror | 높음 |
| 4 | **Antigravity 2.0의 hook 설정 파일 포맷은 Claude Code와 1:1 동일** — `{"hooks": {"PreToolUse": [{"matcher": ..., "hooks": [...] }]}}` 구조에 `${CLAUDE_PLUGIN_ROOT}` 변수까지 그대로 재사용. antigravity.google 공식 deep-dive blog가 5종 lifecycle event(before/after tool exec, before/after model call, agent loop stop)를 직접 언급 | antigravity.google blog (I/O 2026 deep-dive) + lobehub skill 예제 + Antigravity SDK 공지 | 높음 |
| 5 | 네 도구 모두 **MCP server registration 포맷이 사실상 동일** (`mcpServers` 객체 + `command/args` 또는 `url`) — Claude Desktop 포맷을 사실상 표준으로 채택 | 4 공식문서 | 높음 |
| 6 | 플러그인 매니페스트는 도구별로 파일명만 다르고 구조는 유사: Claude Code `.claude-plugin/plugin.json`, Codex `plugins/<name>/plugin.json`, Antigravity `<plugin>/plugin.json`, Cursor 플러그인은 Marketplace 번들 (공개 스펙 일부 비공개) | 공식문서 | 높음 |
| 7 | 모든 도구가 **plugin 내부에서 hook + MCP server + skills/rules + slash commands**를 함께 번들링하는 모델을 공유 → ai-action-tracker 한 패키지 안에 모두 담는 현재 구조는 그대로 유지 가능 | 4 공식문서 | 높음 |
| 8 | 환경변수 `${CLAUDE_PLUGIN_ROOT}` 대응물: Codex `${PLUGIN_ROOT}`(`${CLAUDE_PLUGIN_ROOT}` alias 제공), **Antigravity 2.0는 `${CLAUDE_PLUGIN_ROOT}` 변수를 그대로 차용** (이름 변경 없이 호환), Cursor는 `~/.cursor/hooks/` 절대경로 권장 | developers.openai.com/codex/hooks + lobehub Antigravity skill + StacklokLabs install.sh | 높음 |
| 9 | Cursor에는 `failClosed: true` 플래그가 있어 hook 실패 시 deny로 fallback 가능 — 현재 ai-action-tracker의 "fail-open before / fail-safe after" 정책과 정렬 가능 | cursor.com/docs/hooks | 높음 |
| 10 | Codex만 **`PreToolUse`에서 `updatedInput`으로 인수 재작성**을 명시적 contract로 보장 (Cursor도 `updated_input`, Antigravity 2.0도 `updatedInput` 동일 키 사용) | Codex/Cursor 공식문서 + lobehub Antigravity skill | 높음 |
| 11 | **Antigravity 2.0 신규** (I/O 2026): 4-surface 모델 — desktop app(Mission Control) + CLI(`agy`) + SDK(self-host) + Managed Agents in Gemini API. 네 surface 모두 동일 plugin/hook/MCP 자산을 공유 | blog.google + developers.googleblog.com + apidog | 높음 |
| 12 | **Antigravity 2.0 고유**: `before model call` / `after model call` hook event 2종 — LLM 호출 직전 system instruction 주입, 직후 exit rule 오버라이드. Claude Code/Codex/Cursor 모두 없음 | antigravity.google deep-dive blog | 높음 |
| 13 | **Antigravity 2.0 backwards-compat break 3건**: ① in-app file editor 사실상 제거(IDE → agent orchestrator로 전환), ② Gemini Pro 사용량 quota 변경, ③ Gemini CLI → Antigravity CLI 마이그레이션 권장 (Gemini CLI deprecated). 단 hook/plugin 매니페스트 자체는 1.0 호환 | TechCrunch + 9to5google + piunikaweb | 높음 |
| 14 | **Antigravity Dynamic Subagents**: static 정의(plugin/SDK) + runtime 동적 생성 둘 다 지원. main agent가 task 시 spawn하며 tool config/security perm을 부모로부터 상속. 키노트 데모에서 1개 task에 93개 subagent spawn | antigravity.google deep-dive + DataCamp | 높음 |

## 상세 분석

### 1. Hook 시스템 4-way 비교

#### 1.1 이벤트 이름 매핑

| Claude Code (현재) | Codex CLI | Cursor | Antigravity | 비고 |
|---|---|---|---|---|
| `PreToolUse` | `PreToolUse` | `preToolUse` / `beforeShellExecution` / `beforeMCPExecution` | **`PreToolUse`** (matcher=`Write|Edit|tool_name`) | Cursor는 일반(generic) + tool-specific 분리. Antigravity 2.0는 Claude Code 명명 그대로 채택. |
| `PostToolUse` | `PostToolUse` | `postToolUse` / `afterShellExecution` / `afterMCPExecution` | **`PostToolUse`** | Codex/Cursor는 실패 분기(`postToolUseFailure`) 별도. |
| `SessionStart` | `SessionStart` (matchers: startup/resume/clear/compact) | `sessionStart` | **`SessionStart`** + **`SessionEnd`** | Antigravity 2.0는 `SessionEnd` 별도 보유. |
| `Stop` | `Stop` | `stop` | **`Stop`** + `SubagentStop` (loop stop conditions) | 4개 모두 turn 종료 hook 보유. |
| `UserPromptSubmit` | `UserPromptSubmit` | `beforeSubmitPrompt` | **`UserPromptSubmit`** | Antigravity 2.0 공식 명문화 완료. |
| `PreCompact` / `PostCompact` | `PreCompact` / `PostCompact` | `preCompact` | **`PreCompact`** + `Notification` | Antigravity 2.0는 `Notification` event 보유(사용자 알림 시점). |
| `PermissionRequest` | `PermissionRequest` | (없음 — `preToolUse`로 통합) | (없음 — `PreToolUse`로 통합) | Codex만 별도 escalation hook을 둠. |
| `SubagentStart` / `SubagentStop` | `SubagentStart` / `SubagentStop` | `subagentStart` / `subagentStop` | **`SubagentStop`** (Start 미공개) | Antigravity Dynamic Subagent 라이프사이클 일부만 노출. |
| (없음) | (없음) | (없음) | **`before model call` / `after model call`** ⭐ | **Antigravity 2.0 고유 신규 hook event** — LLM 호출 전후 system 메시지 주입/exit rule 오버라이드 가능. |

#### 1.2 hook 입출력 contract (가장 중요한 차이)

**Claude Code (현재 우리 contract)**:
```json
// stdout
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "step-up MFA required"
  }
}
```

**Codex** — Claude Code와 **사실상 동일**:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "..."
  }
}
```
`permissionDecision`에 `"allow" | "deny" | "ask"` 모두 허용. MCP tool의 경우 `"updatedInput"`을 함께 반환하면 인수 재작성. legacy 호환으로 `"approve"`, `{"continue": false, "stopReason": "..."}`도 인식.

**Cursor** — **평면 구조 + camelCase**:
```json
{
  "permission": "deny",
  "user_message": "WebAuthn required",
  "agent_message": "Step-up MFA required",
  "updated_input": { "command": "..." }
}
```
exit code 2 = deny와 동등. hook entry에 `"failClosed": true` 옵션이 있어 hook 실패시 deny default 변경 가능.

**Antigravity 2.0** — **Claude Code와 사실상 동일 contract** (I/O 2026에서 확정):

```json
// plugin: hooks/hooks.json — wrapper 형식
{
  "description": "Validation hooks for code quality",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/validate.sh" }
        ]
      }
    ]
  }
}
```

```json
// hook stdout (lobehub 공개 skill 기준 — 사실상 Claude Code schema)
{
  "hookSpecificOutput": {
    "permissionDecision": "allow" | "deny" | "ask",
    "updatedInput": { "field": "modified_value" }
  },
  "systemMessage": "Reason text shown to the agent"
}
```

추가 hook 타입 `"prompt"`(스크립트 대신 LLM에게 검증을 위임)도 지원. **global + workspace-specific** 두 스코프, workspace 우선. ⚠️ Google이 stdin/stdout 와이어 스펙을 **공식 한 페이지로 명문화**하진 않았으나, antigravity.google 공식 deep-dive blog의 "hooks at ... before a tool execution (can help customize arguments)" 표현 + lobehub `hook-development` skill의 실제 예제 + `${CLAUDE_PLUGIN_ROOT}` 변수 그대로 사용이 일치하므로 **Claude Code wire format 호환으로 간주하고 어댑터 작성 가능**.

### 2. MCP 서버 등록 4-way 비교

| 항목 | Claude Code | Codex CLI | Cursor | Antigravity |
|---|---|---|---|---|
| 설정 파일 | `.mcp.json` (plugin), `settings.json` (user) | `~/.codex/config.toml` `[mcp_servers.<n>]` | `.cursor/mcp.json` (project), `~/.cursor/mcp.json` (user) | `~/.gemini/antigravity/mcp_config.json` (1.0/2.0 공통) |
| 형식 | JSON `mcpServers` 맵 | TOML 테이블 | JSON `mcpServers` 맵 (Claude Desktop 호환) | JSON `mcpServers` 맵 (Claude Desktop 호환) |
| stdio 키 | `command`, `args`, `env` | `command`, `args`, `env`, `env_vars`, `cwd` | `command`, `args`, `env` | `command`, `args`, `env` |
| HTTP 키 | `url` | `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers` | `url` | `url` |
| CLI helper | `claude mcp add` | `codex mcp add <n> -- npx -y ...` | (UI 등록 위주) | UI "Manage MCP Servers" |
| Plugin-bundled | `${CLAUDE_PLUGIN_ROOT}` 변수 | `${PLUGIN_ROOT}` (+ `${CLAUDE_PLUGIN_ROOT}` alias) | Marketplace 번들 | `plugin.json` + `mcp_config.json` |

→ **결론**: Codex(TOML)만 별도 변환기 필요. 나머지 셋은 동일 JSON 스키마 그대로 재사용 가능 (env 변수 prefix만 swap).

### 3. Plugin 매니페스트 4-way 비교

#### 3.1 Claude Code (현재)
```
plugins/ai-action-tracker/
├── .claude-plugin/plugin.json   # name, description, version, ...
├── .mcp.json                    # mcpServers
├── hooks/
│   ├── hooks.json               # PreToolUse/SessionStart/UserPromptSubmit/Stop
│   └── pre-tool-use.ts          # entry script
└── dist/                        # tsc 산출물
```

#### 3.2 Codex (제안)
```
plugins/codex-ai-action-tracker/
├── plugin.json                  # { "name": "...", "hooks": "./hooks/hooks.json", ... }
├── config.toml                  # [mcp_servers.ai-action-tracker]
├── hooks/
│   ├── hooks.json               # 동일 schema (Claude Code-호환)
│   └── pre-tool-use.js          # 같은 로직, ${PLUGIN_ROOT} 변수만 다름
└── (Codex skills/, agents/.toml 선택)
```

#### 3.3 Cursor (제안)
```
plugins/cursor-ai-action-tracker/      # Cursor Marketplace 번들 (공개 스펙은 cursor.com/blog/marketplace 만 존재)
├── package.json                       # cursor marketplace 메타 (잠정)
├── hooks.json                         # { "version": 1, "hooks": { "preToolUse": [...] } }
├── mcp.json                           # mcpServers 맵
├── hooks/
│   └── pre-tool-use.js                # stdout: { permission: "deny", ... } 평면 JSON
└── .cursor/rules/*.mdc                # rules (선택)
```

#### 3.4 Antigravity 2.0 (제안)
```
plugins/antigravity-ai-action-tracker/
├── plugin.json                        # { "name": "ai-action-tracker", "description": "..." }
├── mcp_config.json                    # { mcpServers: { "ai-action-tracker": { command, args } } }
├── hooks/
│   ├── hooks.json                     # { "description": "...", "hooks": { "PreToolUse": [...] } }
│   └── pre-tool-use.js                # Claude Code-호환 wire format으로 stdout JSON emit
├── rules/                             # GUARDRAILS.md, AGENTS.md (있으면 자동 로드)
└── skills/SKILL.md                    # 선택 (Antigravity Skill)
```

Antigravity 2.0의 4-surface 모델 (desktop app · CLI `agy` · SDK · Managed Agents) **모두 동일한 plugin 디렉토리를 공유**한다 — desktop app은 `~/.gemini/config/plugins/` 또는 workspace `.agents/plugins/`에서 로드하고, CLI는 `~/.gemini/antigravity-cli/`, SDK는 plugin path를 옵션으로 받는 식. step-up 게이트 입장에서는 한 벌의 plugin만 패키징하면 모든 surface 대응.

### 4. 합의점 (4-tool 모두 동일하게 처리되는 부분)

1. **PreToolUse intercept → stdin JSON → 외부 스크립트 spawn → stdout JSON으로 deny** 패턴: 4개 도구 모두 동일.
2. **stdio + Streamable HTTP MCP 양쪽 지원**, `command`/`args`/`env` 키 동일.
3. **Plugin은 hook + MCP + rules/skills를 한 디렉토리로 묶는 번들 모델** 채택.
4. **Project-scope vs user-scope vs system-scope** 3계층 설정 우선순위 (변형 있음).
5. **`failClosed`/trust review** 등 hook 실행 신뢰 모델 보유 — `--dangerously-bypass-hook-trust`(Codex), Cursor 마켓플레이스 review, Claude Code `/plugin trust` 등 명칭만 상이.

### 5. 의견 분화 / 도구별 고유 특성

- **Codex**가 contract 다양성에서 가장 풍부 (`PermissionRequest`, `PreCompact`/`PostCompact`, `SubagentStart` matcher = `agent_type`, OTel 통합). step-up MFA의 escalation 경로를 다루기에 가장 자연스러운 hook event 셋을 보유.
- **Cursor**의 hook 모델은 가장 "platform-agnostic"하다 (config schema 버전 명시 `{ "version": 1, ... }`). 단, Claude Code/Codex보다 event coverage가 적어 step-up flow에서 `Stop` orphan reap 같은 정교한 패턴을 만들기 어려울 수 있음.
- **Antigravity 2.0**는 IDE-first에서 **agent-first**로 전환 (standalone desktop app + CLI `agy` + SDK + Managed Agents in Gemini API). Mission Control이 새 UI 중심이며, **Dynamic Subagents가 static 정의 또는 runtime 등록 둘 다 가능**. hook은 Claude Code 형식 그대로 차용해 사실상 즉시 포팅 가능. 다만 stdin/stdout 와이어 스펙이 Google에 의해 한 페이지로 명문화되지 않아, 가장자리 case에서 동작 차이가 있을 수 있음 — production 출시 전 e2e smoke test 필수.

### 6. 정량 데이터

| 도구 | 공식 hook event 수 | MCP transport | Plugin manifest 키 수 | 공식 docs 페이지(추출 성공) |
|---|---|---|---|---|
| Claude Code | 30+ (PR/이슈/사이드 이펙트 포함) | stdio + Streamable HTTP | 9 | (이미 보유) |
| Codex CLI | 10 (turn + thread scope) | stdio + Streamable HTTP | 8+ | 5/5 |
| Cursor | ~20 (Tab, Workspace, Subagent 포함) | stdio + Streamable HTTP | 5+ | 5/5 (1 URL substitute) |
| **Antigravity 2.0** | **9 명문화** (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, SessionStart, SessionEnd, PreCompact, Notification) + 2 신규 (before/after model call) | stdio + HTTP (extension) | 4 | 6/6 (2.0 refresh; 1.0 blog 1건 재추출 성공) |

## 권장 모노레포 레이아웃

### 6.1 현재 구조의 한계

현재 모든 코드가 `plugins/ai-action-tracker/`에 묶여있고, hook 스크립트는 `hooks/pre-tool-use.ts`에서 `../src/stepup/gate.ts`를 직접 import. 호스트가 늘어나면:
- (a) 동일 step-up 로직을 N번 복제하거나
- (b) cross-plugin import (`../../plugins/.../src/stepup/`) — npm workspace에서 지저분
이 두 안티패턴 중 하나로 빠진다.

### 6.2 권장 구조 (Turborepo 친화)

```
.
├── package.json                              # workspaces: ["packages/*", "plugins/*"]
├── turbo.json
├── packages/                                 # 호스트 무관 라이브러리
│   ├── stepup-core/                          # ★ 신설 — 기존 src/stepup/* 이전
│   │   ├── src/
│   │   │   ├── jwt.ts, config.ts, client.ts
│   │   │   ├── session.ts, gate.ts, inspector.ts
│   │   │   ├── pending.ts, store.ts
│   │   │   └── index.ts                      # public surface
│   │   ├── package.json                      # "@ai-action-tracker/stepup-core"
│   │   └── tsconfig.json
│   ├── hook-adapters/                        # ★ 신설 — 호스트별 JSON 변환만 책임
│   │   ├── src/
│   │   │   ├── claude-code.ts                # hookSpecificOutput.permissionDecision (현 contract)
│   │   │   ├── codex.ts                      # 동일 schema, 일부 legacy alias
│   │   │   ├── cursor.ts                     # { permission, user_message, ... } 평면
│   │   │   └── antigravity.ts                # spec stabilize까지 stub
│   │   └── package.json                      # "@ai-action-tracker/hook-adapters"
│   ├── mcp-server-core/                      # ★ 신설 — 기존 src/server.ts + tools/* 이전
│   │   ├── src/
│   │   │   ├── server.ts                     # createServer() — 공통 단일 정의
│   │   │   ├── tools/{members,rbac,passcode,stepup-helper,transcodes-client}.ts
│   │   │   ├── danger-patterns.ts, tool-rules.ts
│   │   │   └── stdio.ts, http.ts             # 두 transport
│   │   └── package.json                      # "@ai-action-tracker/mcp-server-core"
│   └── danger-patterns/                      # ★ 신설 — danger-patterns.json + tool-rules.json
│       ├── system/danger-patterns.json
│       ├── system/tool-rules.json
│       └── index.ts                          # 로더 헬퍼
└── plugins/                                  # 호스트별 얇은 어댑터
    ├── claude-code-ai-action-tracker/        # (기존 plugins/ai-action-tracker 리네임)
    │   ├── .claude-plugin/plugin.json
    │   ├── .mcp.json
    │   ├── hooks/
    │   │   ├── hooks.json
    │   │   └── pre-tool-use.ts               # 30줄: stdin parse → core gate → claude-code adapter emit
    │   └── package.json                      # deps: @ai-action-tracker/{stepup-core,hook-adapters,mcp-server-core}
    ├── codex-ai-action-tracker/              # ★ 신설
    │   ├── plugin.json
    │   ├── config.toml                       # [mcp_servers.ai-action-tracker]
    │   ├── hooks/
    │   │   ├── hooks.json
    │   │   └── pre-tool-use.ts               # same core, codex adapter
    │   └── package.json
    ├── cursor-ai-action-tracker/             # ★ 신설
    │   ├── hooks.json                        # version: 1 schema
    │   ├── mcp.json
    │   ├── hooks/pre-tool-use.ts             # same core, cursor adapter
    │   └── package.json
    └── antigravity-ai-action-tracker/        # ★ 신설 (실험)
        ├── plugin.json
        ├── mcp_config.json
        ├── hooks.json
        ├── hooks/pre-tool-call.ts
        ├── rules/GUARDRAILS.md
        └── package.json
```

### 6.3 공통 로직 분리 원칙

| 분리 기준 | 위치 | 이유 |
|---|---|---|
| **순수 비즈니스 로직** (stepup, jwt, session lifecycle, pending/verified state file I/O) | `packages/stepup-core/` | 호스트 무관 — 4개 도구가 모두 동일하게 활용 |
| **MCP server tool 정의** (members, rbac, passcode, ...) | `packages/mcp-server-core/` | MCP 서버 자체가 호스트 무관. plugin은 단지 `mcpServers` 매니페스트로 가리킬 뿐 |
| **danger pattern / tool rule 데이터** | `packages/danger-patterns/` | 도구마다 다르게 둘 이유가 없음. user-rule CRUD는 stepup-core가 같은 파일을 봄 |
| **Hook stdout JSON 형식 변환** | `packages/hook-adapters/` | 호스트별 유일한 진짜 차이 — adapter로 격리 |
| **hook entry script** (stdin parse, core 호출, adapter 호출, exit) | `plugins/<host>-.../hooks/*.ts` | 30~50줄 thin entrypoint. tsc로 컴파일 후 `dist/`에 commit |
| **호스트별 매니페스트** (`plugin.json`, `mcp.json`, `hooks.json`, `config.toml`) | 각 plugin 루트 | 도구별 파일명/포맷이 다르므로 plugin마다 자기 매니페스트 |

### 6.4 핵심 코드 단면 (예시)

**`packages/stepup-core/src/index.ts`** (public surface):
```ts
export { evaluateBashCommand, evaluateMcpToolCall, type GateDecision } from "./gate.js";
export { readVerified, consumeVerified, writePending, ... } from "./store.js";
export { type StepupSession, createStepupSession, ... } from "./session.js";
```

**`packages/hook-adapters/src/index.ts`**:
```ts
import type { GateDecision } from "@ai-action-tracker/stepup-core";

export interface HookAdapter {
  parseStdin(raw: string): { toolName: string; toolInput: unknown; eventName: string };
  emitAllow(): string;                                 // stdout payload
  emitDeny(reason: string, sid: string, url: string): string;
  emitRewrite(updatedInput: unknown): string;          // optional
}

export const claudeCodeAdapter: HookAdapter = { /* ... 현 contract ... */ };
export const codexAdapter:     HookAdapter = { /* ... hookSpecificOutput.permissionDecision ... */ };
export const cursorAdapter:    HookAdapter = {
  parseStdin: (raw) => { const j = JSON.parse(raw); return { toolName: j.tool_name, toolInput: j.tool_input, eventName: j.hook_event_name }; },
  emitAllow: () => JSON.stringify({ permission: "allow" }),
  emitDeny:  (reason, sid, url) => JSON.stringify({
    permission: "deny",
    user_message: `Step-up MFA required. Open ${url}`,
    agent_message: `[stepup-pending sid=${sid}] ${reason}`
  }),
};
export const antigravityAdapter: HookAdapter = { /* spec 잠정, claude-code 패스스루로 시작 */ };
```

**`plugins/cursor-ai-action-tracker/hooks/pre-tool-use.ts`** (얇은 entrypoint, 약 30줄):
```ts
import { readFileSync } from "node:fs";
import { evaluateBashCommand, writePending } from "@ai-action-tracker/stepup-core";
import { cursorAdapter } from "@ai-action-tracker/hook-adapters";

const raw = readFileSync(0, "utf8");
const { toolName, toolInput } = cursorAdapter.parseStdin(raw);

if (toolName !== "Shell") { process.stdout.write(cursorAdapter.emitAllow()); process.exit(0); }

const decision = await evaluateBashCommand((toolInput as { command: string }).command);
if (decision.kind === "allow") { process.stdout.write(cursorAdapter.emitAllow()); process.exit(0); }

const session = await writePending(decision); // creates sid + opens browser
process.stdout.write(cursorAdapter.emitDeny(decision.reason, session.sid, session.url));
process.exit(0);
```

→ 코드 본질은 같고, **호스트별 adapter swap만으로 PreToolUse 게이트 동작 보장**.

## 도구별 구현 청사진

### Codex 포팅 (난이도: 낮음)

1. `plugins/codex-ai-action-tracker/plugin.json` 생성:
   ```json
   { "name": "ai-action-tracker", "hooks": "./hooks/hooks.json" }
   ```
2. `hooks/hooks.json` — Claude Code 매니페스트 그대로 복사 (matcher 패턴 동일).
3. `config.toml`로 MCP 서버 등록:
   ```toml
   [mcp_servers.ai-action-tracker]
   command = "node"
   args = ["${PLUGIN_ROOT}/dist/mcp-server-core/stdio.js"]
   ```
4. hook entry는 `codexAdapter` 사용. **legacy `{"continue": false}`도 인식**하므로 점진 마이그레이션 용이.
5. AGENTS.md에 step-up 프로토콜 사전 주입 (현재 SessionStart hook의 역할을 일부 AGENTS.md로 대체 가능).

### Cursor 포팅 (난이도: 중간)

1. `.cursor/hooks.json` (project scope) 또는 `~/.cursor/hooks.json` (user scope) 등록.
2. **camelCase 이벤트 이름** + 평면 JSON 출력 — `cursorAdapter` 필수.
3. `failClosed: true` 옵션을 모든 step-up hook에 설정 → 현재 ai-action-tracker의 fail-safe 정책과 일치.
4. `beforeMCPExecution`을 별도 등록하여 우리 MCP tool 자체 호출도 게이트 (현재 `Bash|mcp__plugin_ai-action-tracker_...` 통합 matcher 분할).
5. `StacklokLabs/cursor-hooks`의 install.sh 패턴을 차용 — `~/.cursor/hooks/` 절대경로 설치.
6. Marketplace 번들 공식 스펙 공개되기 전까지는 GitHub release tarball + install 스크립트 배포가 현실적.

### Antigravity 2.0 포팅 (난이도: 중 — 1.0 대비 spec 안정화로 하향)

1. `plugin.json` — 최소 필드 `{ "name": "ai-action-tracker", "description": "..." }`. Antigravity 2.0는 `name` 생략시 디렉토리명을 자동 사용.
2. `mcp_config.json` — Claude Desktop 포맷 그대로 (`mcpServers` 맵 + `command`/`args`/`env`). Antigravity 2.0는 이를 일급 시민으로 채택.
3. `hooks/hooks.json` — **Claude Code 매니페스트를 거의 그대로 복사 가능**:
   ```json
   {
     "description": "ai-action-tracker step-up MFA gate",
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash|Write|Edit",
           "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-tool-use.js" }]
         }
       ],
       "SessionStart": [
         { "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.js" }] }
       ],
       "Stop": [
         { "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/dist/hooks/stop.js" }] }
       ]
     }
   }
   ```
   `${CLAUDE_PLUGIN_ROOT}` 변수는 Antigravity가 그대로 채택했으므로 이름 변환 불필요.
4. hook entry script는 `antigravityAdapter` 사용 — **lobehub 공개 skill 예제 기준 Claude Code wire format(`hookSpecificOutput.permissionDecision`)과 동일**으로 emit. 단 Google 공식 stdin/stdout 한 페이지 spec이 부재하므로, 첫 출시는 fail-open + audit-log only로 두고 deny enforcement는 staged rollout.
5. **신규 hook 활용 기회**: Antigravity 2.0의 `before model call` / `after model call` event를 활용하면 step-up state를 LLM 컨텍스트에 직접 주입 가능. 현재 SessionStart에 primer 한 번 주입하던 패턴을 model call마다 동적으로 갱신하도록 업그레이드 검토 가능.
6. **Dynamic Subagent 대응**: Antigravity 2.0는 main agent가 runtime에 subagent를 spawn하므로 `~/.cache/.../stepup-pending.json` 단일 파일 race가 훨씬 잦아진다. 두 가지 옵션:
   - (a) 파일명에 `conversation_id`를 끼워 namespace 분리: `stepup-pending.<conversation_id>.json`
   - (b) `SubagentStop` hook으로 verified record orphan reap을 일찍 트리거.
   - SDK 사용자는 추가로 자기 환경의 멀티프로세스 lock helper를 packaged 형태로 제공해야 할 수도.
7. **Managed Agents in Gemini API 대응**: cloud-hosted 실행 환경에서 step-up MFA를 어떻게 처리할지 별도 설계 필요. WebAuthn 브라우저 탭 자동 오픈은 cloud 환경에서 불가하므로 (a) deferred verification(사용자 머신에 알림 push) 또는 (b) cloud 환경에서는 Managed Agent를 step-up 면제 대상으로 정책 분기. 1차 출시에서는 desktop/CLI/SDK 3개 surface만 지원하고 Managed Agents 대응은 후속 단계로.
8. **Browser Subagent 충돌 가능성**: Antigravity의 자체 Browser Subagent가 WebAuthn 탭을 열 수 있으나, 우리 게이트가 여는 브라우저 탭과 동일 Chrome profile에서 발생하는 경우 lock contention. `~/.cache/.../browser_lock` 디렉토리에 owner field 추가하여 명시적 차단.

### 공통 hook 데이터 마이그레이션

- `danger-patterns.json` / `tool-rules.json`은 형식 변경 없이 그대로 4개 호스트에서 공유.
- `consume_in_hook` 플래그도 호스트 무관 (실행 컨텍스트 결정 옵션이므로 stepup-core 안에 머문다).

## 위험요소 / 미비점

- **Antigravity 2.0 hook stdin/stdout 와이어 스펙 한 페이지 명문화 부재** — Google이 hook의 config 파일 형식은 공개했으나 stdin JSON 필드 / stdout JSON contract를 한 곳에서 정리한 reference page는 아직 없다. lobehub 공개 skill의 예제와 Antigravity 공식 deep-dive blog의 서술이 Claude Code wire format과 호환됨을 강하게 시사하지만, 가장자리 case(예: `permissionDecision: "ask"` 처리, exit code 0 vs 2 의미)는 e2e 테스트로 확정 필요.
- **Antigravity Scheduled Tasks ↔ hook firing 관계 미문서화** — cron-style 트리거가 `SessionStart`를 발화시키는지, 별도 event를 발화시키는지, 또는 hook 없이 headless로 실행되는지 불명. step-up 게이트가 scheduled task에서 동작하지 않을 수 있으므로 정책 결정 필요(예: scheduled context는 step-up 면제).
- **Cursor Marketplace 번들 포맷 비공개** — 현재는 GitHub release + install.sh가 사실상 표준. 공식 manifest 명세 공개 시 패키징 재작업 필요.
- **Codex `PostToolUse` 미발화 이슈 (#16246)** — exec-session polling으로 완료되는 tool에서는 PostToolUse가 안 떠 verified record orphan reap 정확도가 떨어질 수 있음. Stop hook 백스톱이 더 중요해짐.
- **TOML vs JSON manifest** — Codex의 `config.toml`은 별도 빌드 단계가 필요. 단순 변환기를 `packages/manifest-tools/`에 둘지, 매니페스트를 수동 관리할지 결정 필요.
- **Antigravity 2.0 Dynamic Subagent로 인한 race 빈도 증가** — 한 task가 수십 개의 subagent를 spawn하므로 single-file shared state 패턴은 사실상 깨진다. 멀티프로세스 lock 또는 conversation-scoped namespace로 전환 권장.
- **Antigravity Managed Agents 환경에서 WebAuthn 흐름 불가** — cloud-hosted sandbox는 사용자 머신의 브라우저에 접근할 수 없다. 1차 출시에서 Managed Agents는 step-up 면제 또는 deferred verification 정책 명시 필수.
- **Antigravity 1.0 → 2.0 사용자 마이그레이션 영향** — 2.0의 file-editor 제거 / quota 변경 / Gemini CLI deprecation 사용자 불만이 있어, 2.0 출시 직후 plugin 출시는 위험 노출 큼. 1.0 사용자 잔존 비중을 봐서 출시 타이밍 조정 권장.
- **공유 state 파일 (`~/.cache/.../stepup-pending.json`)의 cross-host conflict** — 사용자가 Claude Code와 Codex/Antigravity를 동시에 띄우면 같은 파일을 두고 race. 네임스페이스 분리(`stepup-pending.{host}.json`) 또는 host id를 record에 포함.
- **테스트 시그널 부재** — 현 ai-action-tracker는 hook smoke test가 1종(Claude Code)뿐. 호스트별 smoke test fixture 추가 필요 (각 도구의 stdin JSON 예시를 `tests/fixtures/{host}/`에 두기). Antigravity는 wire format 미확정이므로 fixture 자체가 잠정.

## 전체 출처

### 공식 문서 (1차 출처)

**Codex CLI**
1. [Codex Hooks (공식)](https://developers.openai.com/codex/hooks) — event 전체 spec + JSON I/O contract
2. [Codex MCP (공식)](https://developers.openai.com/codex/mcp) — stdio + Streamable HTTP server config
3. [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) — 계층적 instruction file 모델
4. [Advanced configuration](https://developers.openai.com/codex/config-advanced) — Profiles, sandbox, OTel
5. [DeepWiki: hooks system internals](https://deepwiki.com/openai/codex/3.11-hooks-system) — Rust 구현 세부

**Google Antigravity 2.0 (I/O 2026)**
6. [Antigravity 2.0 deep dive (공식 blog)](https://antigravity.google/blog/google-io-2026-feature-deep-dive) — JSON Hooks 5종 event 설명, Dynamic Subagent 정의 (static + runtime), Asynchronous Task Management. **v1 추출 실패 → v2에서 advanced-depth로 성공**
7. [Google blog: I/O 2026 developer highlights](https://blog.google/innovation-and-ai/technology/developers-tools/google-io-2026-developer-highlights/) — Antigravity 2.0 desktop app, Managed Agents in Gemini API, Gemini 3.5 Flash
8. [Google developers blog: I/O 2026 keynote 전체 뉴스](https://developers.googleblog.com/all-the-news-from-the-google-io-2026-developer-keynote/) — Antigravity SDK, CLI, subagent terminal sandboxing/credential masking/hardened Git policies
9. [DataCamp: Antigravity CLI 튜토리얼](https://www.datacamp.com/tutorial/antigravity-cli) — `/schedule`, `/grill-me`, `/goal` 슬래시 커맨드, Dynamic Subagent FAQ, Managed Agents 임베딩
10. [MarkTechPost: Antigravity 2.0 launch coverage](https://www.marktechpost.com/2026/05/19/google-launches-antigravity-2-0-at-i-o-2026-a-standalone-agent-first-platform-with-cli-sdk-managed-execution-and-enterprise-support/) — enterprise support, CLI/SDK/Managed Execution 종합
11. [lobehub: Antigravity hook-development skill](https://lobehub.com/skills/ibossynr1-antigravity-skills-hook-development) — **실제 hook JSON 예제** (`${CLAUDE_PLUGIN_ROOT}` 사용 확인), 9종 event 표, `hookSpecificOutput.permissionDecision` schema
12. [Antigravity Plugins (공식)](https://antigravity.google/docs/plugins) — plugin.json + supported components (1.0/2.0 공통)
13. [Antigravity MCP (공식)](https://antigravity.google/docs/mcp) — mcp_config.json 위치, 33+ MCP integration
14. [Antigravity Agent (공식)](https://antigravity.google/docs/agent) — 아키텍처 개관
15. [Codelab: Autonomous Dev Pipelines](https://codelabs.developers.google.com/autonomous-ai-developer-pipelines-antigravity) — agents.md + skills.md + /startcycle workflow (1.0 기반)
16. [TechCrunch: Antigravity 2.0 launch](https://techcrunch.com/2026/05/19/google-launches-antigravity-2-0-with-an-updated-desktop-app-and-cli-tool/) — 일반 미디어 커버리지
17. [apidog: Antigravity 2.0 explainer](https://apidog.com/blog/google-antigravity-2/) — feature breakdown
18. [Cloud blog: I/O 2026 news for agent developers](https://cloud.google.com/blog/topics/developers-practitioners/io26-news-for-agent-developers-on-google-cloud) — Google Cloud 통합 관점

**Cursor**
19. [Cursor Hooks (공식)](https://cursor.com/docs/hooks) — hooks.json schema, preToolUse contract
20. [Cursor Marketplace (공식 블로그)](https://cursor.com/blog/marketplace) — plugin 번들 모델
21. [Cursor Hooks vs Claude Code 비교 (TrueFoundry mirror)](https://www.truefoundry.com/docs/platform/cursor-hooks) — 전체 비교 표
22. [Forum: 'required first tool' feature request](https://forum.cursor.com/t/feature-request-required-first-tool-or-pre-tool-hook-for-mcp-enforcement/148730) — enforcement gap 사용자 사례
23. [StacklokLabs/cursor-hooks (GitHub)](https://github.com/StacklokLabs/cursor-hooks) — beforeMCPExecution governance reference impl
24. [Noma Security: Cursor 런타임 가드레일](https://noma.security/blog/securing-the-agentic-frontier-noma-unveils-the-first-real-time-agent-runtime-security-for-cursor/) — production hook governance

### 보조 / 커뮤니티 (2차 출처)

25. [Codex vs Claude Code 비교 (Blake Crosley)](https://blakecrosley.com/blog/codex-vs-claude-code-2026)
26. [openai/codex (GitHub)](https://github.com/openai/codex)
27. [Codex PR #11067](https://github.com/openai/codex/pull/11067) — hooks 시스템 도입
28. [Codex 이슈 #16246](https://github.com/openai/codex/issues/16246) — PostToolUse exec-session gap
29. [How to MCP with Codex (Composio)](https://composio.dev/content/how-to-mcp-with-codex)
30. [Antigravity 2.0 Hitchhiker's Guide (Medium)](https://medium.com/google-cloud/the-hitchhikers-guide-to-antigravity-2-0-af17eb4845c0)
31. [Antigravity SDK 가이드](https://www.aimadetools.com/blog/antigravity-sdk-custom-agents-guide/)
32. [Cursor Hardening Guide](https://howtoharden.com/guides/cursor/)
33. [Cursor Agent System Prompt (gist)](https://gist.github.com/sshh12/25ad2e40529b269a88b80e7cf1c38084)
34. [agentupdate.ai: Antigravity 2.0 explained](https://www.agentupdate.ai/blog/google-antigravity-2-0-explained/)
35. [braincuber: Antigravity CLI Dynamic Subagents pipeline](https://www.braincuber.com/tutorial/how-to-use-google-antigravity-cli-dynamic-subagents-data-pipeline)
36. [antigravityide.org: Antigravity 2.0 release notes](https://antigravityide.org/blog/introducing-google-antigravity-2-0/)
37. [Ken Huang: I/O 2026 was not just a model](https://kenhuangus.substack.com/p/google-io-2026-was-not-just-a-model) — agent platform 관점

### 내부 reference (현재 plugin 구조 파악)

- `plugins/ai-action-tracker/hooks/hooks.json:1-46`
- `plugins/ai-action-tracker/.mcp.json:1-9`
- `plugins/ai-action-tracker/src/server.ts`, `src/stepup/*`, `src/tools/*`
- `CLAUDE.md` (프로젝트 규칙)

---

> **v2 추출 결과**: Antigravity 2.0 deep-dive blog는 Tavily `--depth=advanced` 모드로 재추출 성공. JSON Hooks 5-event 설명 + Dynamic Subagent 정의(static + runtime) 명확. v1에서 비어있던 Antigravity 섹션이 v2에서 가장 풍부한 섹션으로 전환됨.
>
> **남은 미결 항목**: Antigravity 2.0 SDK의 정확한 패키지명/API 클래스 시그니처, Scheduled Tasks의 hook 발화 동작, Managed Agents의 sandboxed WebAuthn 정책 — 모두 Google이 공식 reference page를 추가 publish할 때까지 추가 1차 조사 권장.
