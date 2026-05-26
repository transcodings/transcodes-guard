# ai-action-tracker-monorepo

Risky-shell interceptor + step-up MFA audit MCP server, packaged as plugins for **Claude Code**, **OpenAI Codex CLI**, and **Google Antigravity 2.0**. All three plugins share a single MCP server core and gate logic via npm workspaces — adding a fourth host (Cursor, …) means writing a new adapter + thin plugin shell, not duplicating the gate. Codex shares Claude Code's hook wire format; Antigravity uses a **native** wire format with `PreInvocation` covering both `SessionStart` and `UserPromptSubmit` (see [`docs/research/multi-tool-hook-plugin-support.md`](./docs/research/multi-tool-hook-plugin-support.md) v3 for the spec-vs-research reconciliation).

## Essential Commands

```bash
npm install                  # workspaces hoist (packages/* + plugins/*)
npm run build                # turbo run build — packages 먼저, plugins 그 다음
npm run build:plugin         # turbo run build:plugin — dist/ 산출물 동기화
npm run dev:stdio            # tsx, Claude Code plugin의 stdio transport (Inspector 등 외부 MCP 클라이언트용)
npm run dev:http             # tsx, Claude Code plugin의 Streamable HTTP transport (port 3000 /mcp)
npm run dev:hook             # tsx, Claude Code plugin의 PreToolUse hook (stdin JSON으로 단발 실행)
npm run inspect              # MCP Inspector UI 자동 기동 (Claude Code plugin의 stdio 서버에 접속)
```

CI(`.github/workflows/ci.yml`)는 PR마다 `build:plugin` 실행 후 ① `packages/*/dist/`, ② `plugins/claude-code-ai-action-tracker/dist/`, ③ `plugins/codex-ai-action-tracker/dist/`, ④ `plugins/antigravity-ai-action-tracker/dist/` **네 곳**에 대해 `git diff --exit-code`로 빌드 산출물 동기성을 검증한다. hook smoke test **15종**(claude-code 7 + codex 3 + antigravity 5)도 함께 통과해야 한다.

## Running locally without installing the plugin

- `npm run dev:stdio` — tsx 핫리로드 stdio (Inspector·외부 MCP 클라이언트가 직접 접속 가능).
- `npm run inspect` — MCP Inspector UI 자동 기동.
- 컴파일된 dist에 MCP 클라이언트를 직접 붙이려면:
  `claude mcp add ai-action-tracker -- node plugins/claude-code-ai-action-tracker/dist/src/stdio.js`

## Layout

```
/                                                # 루트 = marketplace + monorepo orchestrator
  .claude-plugin/marketplace.json                # Marketplace 카탈로그 (이 리포가 곧 marketplace).
  package.json                                   # private. workspaces ["packages/*", "plugins/*"] + turbo orchestrator.
  turbo.json                                     # task pipeline (build / build:plugin, ^build 의존성).
  .github/workflows/ci.yml                       # multi-plugin dist sync + 15종 hook smoke test.

packages/                                        # 호스트 무관 라이브러리 (워크스페이스 패키지)
  stepup-core/                                   #   step-up MFA 게이트 + 평가 로직의 단일 진실원천
    src/{gate,session,client,store,pending,jwt,config,inspector}.ts  # 기존 stepup 모듈
    src/evaluate.ts                              #   evaluatePreToolUse() — 세 plugin이 호출
    src/messages.ts                              #   formatBlockedSummary 등 사용자 표시 문자열
    src/index.ts                                 #   public surface re-export
    dist/                                        #   git 커밋, npm publish 대상
  danger-patterns/                               #   regex 패턴 + tool-rule 레지스트리 + system data
    data/{danger-patterns,tool-rules}.json       #   system 룰 (이전 hooks/*.json)
    src/{danger-patterns,tool-rules,index}.ts    #   loader + 사용자 룰 CRUD
    dist/                                        #
  mcp-server-core/                               #   MCP server 본체 (createServer + 모든 tool/resource/prompt)
    src/server.ts                                #   createServer() — 모든 capability의 단일 정의처
    src/tools/{members,passcode,rbac,stepup-helper,transcodes-client}.ts
    dist/                                        #
  hook-adapters/                                 #   host별 stdin/stdout JSON contract 격리
    src/{types,claude-code,codex,index}.ts       #   HookAdapter 인터페이스 + claudeCodeAdapter + codexAdapter
    dist/                                        #

plugins/                                         # 호스트별 배포 단위 (얇은 매니페스트 + entry point)
  claude-code-ai-action-tracker/                 #   Claude Code plugin
    .claude-plugin/plugin.json                   #     plugin 매니페스트
    .mcp.json                                    #     MCP 서버 등록 (${CLAUDE_PLUGIN_ROOT})
    hooks/hooks.json                             #     PreToolUse(Bash + matched MCP)/SessionStart/UserPromptSubmit/Stop 매니페스트
    hooks/{pre-tool-use,session-start,user-prompt-submit,stop}.ts  # claudeCodeAdapter thin entrypoint 4종
    src/{stdio,http}.ts                          #     transport entry point (createServer를 mcp-server-core에서 import)
    package.json                                 #     workspace deps + bin entries
    tsconfig.json                                #
    dist/                                        #     git 커밋, 수동 편집 금지
  codex-ai-action-tracker/                       #   OpenAI Codex CLI plugin
    plugin.json                                  #     Codex plugin manifest (hooks → ./hooks/hooks.json, mcpServers → ./.mcp.json)
    .mcp.json                                    #     MCP 서버 등록 (Claude Desktop 포맷 — Codex가 채택)
    hooks/hooks.json                             #     동일 schema (Codex가 Claude Code hook contract 채택)
    hooks/{pre-tool-use,session-start,user-prompt-submit,stop}.ts  # codexAdapter thin entrypoint 4종
    src/stdio.ts                                 #     codex MCP 서버용 stdio entry point
    AGENTS.md                                    #     Codex 자동 로드 — step-up 프로토콜 정적 primer
    README.md                                    #     Codex 설치 / `[features] codex_hooks = true` 활성화 안내
    package.json / tsconfig.json / dist/
  antigravity-ai-action-tracker/                 #   Google Antigravity 2.0 plugin (IDE + agy CLI)
    plugin.json                                  #     최소 manifest ({"name", "version", "description"})
    mcp_config.json                              #     MCP 서버 등록 (Antigravity가 plugin root에서 자동 인식)
    hooks.json                                   #     PreToolUse(run_command) + PreInvocation + Stop — 3종, plugin root 위치
    hooks/{pre-tool-use,pre-invocation,stop}.ts  #     antigravityAdapter thin entrypoint 3종 (PreInvocation이 SessionStart+UserPromptSubmit 통합 대체)
    src/stdio.ts                                 #     transport entry (codex와 동일 패턴)
    rules/STEPUP.md                              #     Antigravity 자동 로드 — step-up 프로토콜 정적 primer
    README.md                                    #     설치 가이드 (global vs workspace), supported surfaces (IDE+CLI), Managed Agents 제외 명시
    package.json / tsconfig.json / dist/

docs/
  architecture.md                                # 설계 의도. 비자명한 변경 전 필독.
  adding-capabilities.md                         # 새 도구/리소스/프롬프트 추가 절차.
  hook-installation.md                           # plugin 미사용 시 수동 hook 등록 절차.
  research/                                      # 외부 리서치 자료 (multi-tool 포팅 전략 포함).
.claude/rules/
  mcp-server.md                                  # packages/mcp-server-core 소스 작업 시 자동 로딩.
  hooks.md                                       # plugins/*-ai-action-tracker/hooks 소스 작업 시 자동 로딩.
```

**구조 정책 (모노레포 정렬):** 코드는 `packages/*/src/` (호스트 무관) + `plugins/*/hooks/` (호스트 thin entry)가 단일 진실원천. plugins/*/dist/와 packages/*/dist/는 모두 `npm run build:plugin` 산출물(git 커밋) — 수동 편집 금지. dev/plugin 채널 모두 동일 source를 빌드해 사용하므로 본질적 중복 없음.

## Must

- Add capabilities **only** by editing `createServer()` in `packages/mcp-server-core/src/server.ts`. Never duplicate registrations in `stdio.ts`/`http.ts` (plugin entries are thin wrappers). Larger tool families live in `packages/mcp-server-core/src/tools/<category>.ts` and expose `register<Category>Tools(server)`; `createServer()` calls those.
- Validate every tool input with `zod`. LLM-supplied arguments are untrusted by default.
- Log via `console.error` (stderr). `console.log` to stdout corrupts JSON-RPC framing in stdio mode and the client will silently disconnect.
- Run `npm run build:plugin` before claiming work complete. `tsc` + multi-plugin dist sync는 CI가 강제하는 정합성 계약.
- After capability changes, verify with `npm run inspect` — the Inspector renders new tools immediately.
- PreToolUse hook의 **asymmetric fail policy**는 `packages/stepup-core/src/evaluate.ts`의 `evaluatePreToolUse`에 내장되어 세 plugin이 공유:
  - *Before* danger match (stdin parse, classify, pattern load) → **fail-open** (decision `kind:"pass"` 반환). hook은 exit 0, no JSON.
  - *After* danger match → **fail-safe** (`deny-*` decision 반환). hook은 stdout JSON에 `permissionDecision: "deny"` emit. `systemMessage` 필드는 프로토콜 instruction; stderr는 1줄 요약.
- Hook orchestra (host event 집합에 따라 다름 — Claude Code/Codex는 4종, Antigravity는 3종): PreToolUse(Bash/run_command + matched MCP) 차단, SessionStart 프로토콜 primer (Antigravity는 PreInvocation에 통합), UserPromptSubmit user "auth done" 감지 (Antigravity는 PreInvocation의 transcript tail에 통합), Stop dangling pending 리마인더. 모든 hook은 단일 shared file `~/.cache/.../stepup-pending.json`을 통해 조정 — see [`docs/architecture.md`](./docs/architecture.md) §5. step-up 용 추가 hook 도입 금지; 기존 orchestra를 재사용.
- 두 trigger source 모두 동일 PreToolUse hook에서 라우팅:
  - **Bash**: `packages/danger-patterns/data/danger-patterns.json` regex + `rm -rf` git semantic check.
  - **MCP tool call**: `packages/danger-patterns/data/tool-rules.json`의 exact `toolName` match. plugin matcher: `Bash|mcp__plugin_ai-action-tracker_ai-action-tracker__.*`. 신규 protected MCP tool → `packages/danger-patterns/data/tool-rules.json` 추가 (system) 또는 `add_tool_rule` MCP tool (user).
- fast-path verified consume diverges by **rule** (kind 아님): `consume_in_hook` 필드로 결정.
  - **Bash**: 항상 hook에서 consume (follow-up handler 없음).
  - **MCP system rule** (`consume_in_hook=false`, default in `data/tool-rules.json`): handler가 `withStepupVerifiedSid`로 consume (sid를 backend `X-Step-Up-Session-Id` 헤더에 사용).
  - **MCP user rule** (`consume_in_hook=true`, default for `add_tool_rule`): hook에서 consume (단발 보장).
- Stop hook orphan reap: turn 종료 시점에 남아 있는 `verified.json`은 "in flight"일 수 없음. Stop이 silently `consumeVerified()`+`clearPending()` — system-rule deferred consume에서 handler가 `withStepupVerifiedSid` 전에 throw한 경우의 backstop, 그리고 false "dangling pending" 리마인더 방지.
- Known limit — **concurrent MCP race**: `verified.json`은 inter-process lock 없는 단일 파일. system rule(`consume_in_hook=false`)의 병렬 hook 두 개가 동시에 `readVerified()`를 통과해 같은 sid로 두 backend call 발생 가능. 권위적 backstop은 Transcodes backend의 sid-replay rejection. client-side fix 없음. 특정 tool이 견디지 못하면 해당 rule을 `consume_in_hook=true`로 재등록 (sid를 backend로 전달하는 기능은 포기).
- Step-up MFA 모듈(`packages/stepup-core/src/`)이 Transcodes backend와 대화하는 유일한 자리. 신규 sensitive feature는 gate를 consume할 것, 재구현 금지. 레이어링: `jwt.ts` → `config.ts` → `client.ts` → `session.ts` (pure) → `gate.ts` (entry) / `inspector.ts` (read-only) → `evaluate.ts` (top-level) / `messages.ts` (사용자 표시 문자열). Shared-state는 `pending.ts`, 단발 verified record는 `store.ts`.
- Diagnostic MCP tool은 hook/step-up debugging용: `inspect_stepup_state` (read-only 구조적 스냅샷, server-computed `age_ms` / `expired` / `ttl_ms`); `simulate_hook_invocation` (PreToolUse hook 바이너리를 subprocess로 spawn해 state diff — **dry run 아님**, verified record를 consume하거나 브라우저 탭을 열 수 있음). state inspection 시 `cat`/`ls` wrap 대신 이 두 tool 우선.
- Hook output channel (각 hook은 해당 host validator가 허용하는 형식 사용; adapter가 격리):
  - **PreToolUse** → stdout JSON, `hookSpecificOutput.permissionDecision` (`"deny"`/`"allow"`) + `systemMessage`.
  - **SessionStart / UserPromptSubmit** → stdout JSON, `hookSpecificOutput.additionalContext`.
  - **Stop** → stdout JSON, top-level `{ decision: "block", reason }`. Claude Code/Codex 모두 Stop은 `hookSpecificOutput.hookEventName` enum에 없으므로 wrapping 금지.
  - stderr는 사람-가독 1줄 요약 전용. exit code `0`이 모든 곳에서 default — deny도 JSON에 들어가므로. `exit 2`는 사용 금지 (legacy stderr-text contract).
- PreToolUse fast-path (verified record consumed)는 explicit `permissionDecision: "allow"` JSON을 emit해야 함. `exit 0`만으로는 Claude Code의 default permission flow로 떨어져 `settings.json` deny rule 또는 built-in safety pattern이 step-up 검증을 덮어쓸 수 있음. explicit allow가 step-up gate를 권위 소스로 만드는 핵심.
- Source 수정 후 반드시 `npm run build:plugin`을 거쳐 ① `packages/*/dist/`, ② `plugins/claude-code-ai-action-tracker/dist/`, ③ `plugins/codex-ai-action-tracker/dist/`, ④ `plugins/antigravity-ai-action-tracker/dist/` **네 곳**을 commit과 함께 동기화. CI가 모두 검증. dist/를 직접 편집하지 말 것 — 다음 빌드에서 덮어쓰여진다.
- 신규 host plugin (Cursor, Antigravity 등) 추가 시:
  1. `packages/hook-adapters/src/<host>.ts`에 새 adapter 구현 (HookAdapter 인터페이스).
  2. `plugins/<host>-ai-action-tracker/`에 매니페스트 + thin hook entry — host event 집합에 맞춰 적정 수 (Claude Code/Codex는 4종, Antigravity는 3종 등).
  3. CI smoke test 3-7종 추가.
  본질적으로 새 stepup-core / mcp-server-core / danger-patterns 코드 추가 없이 plugin만 추가하는 작업.

## Never

- Use the deprecated positional `server.tool(name, desc, schema, cb)` API. Use `server.registerTool(name, { title, description, inputSchema }, cb)` (and the matching `register*` variants for resource and prompt).
- Use the deprecated SSE transport (`/sse` + `/messages`). Streamable HTTP `/mcp` is the only modern target.
- Deploy `http.ts` to a non-loopback host without authentication. The current scaffold has none — see `docs/architecture.md` (Authentication 섹션) before any production exposure.
- Mutate state inside a Resource handler. Resources are read-only context; side effects belong in Tools.
- Duplicate gate/evaluate/format 로직을 plugin의 hook 안에 인라인하지 말 것. 모든 비-adapter 로직은 `packages/stepup-core/`에 있어야 함 — host divergence는 오직 adapter에서만 발생.
- Plugin마다 별개의 MCP server 코드를 두지 말 것. `packages/mcp-server-core/src/server.ts`의 `createServer()`만이 single source. 각 plugin의 `src/stdio.ts`는 import + transport 연결 3-5줄짜리 wrapper.

## See Also

- 설계 의도 (왜 transport 분리, 왜 Streamable HTTP, 인증 미비점) → [`docs/architecture.md`](./docs/architecture.md)
- 능력 추가 step-by-step → [`docs/adding-capabilities.md`](./docs/adding-capabilities.md)
- 다중 호스트 plugin 포팅 전략 + Codex/Antigravity/Cursor 비교 → [`docs/research/multi-tool-hook-plugin-support.md`](./docs/research/multi-tool-hook-plugin-support.md)
- 배포 플랫폼 비교 리서치 → [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md)
- 외부 사용자용 문서 → [`README.md`](./README.md)
- Codex plugin 설치 가이드 → [`plugins/codex-ai-action-tracker/README.md`](./plugins/codex-ai-action-tracker/README.md)
- Antigravity 2.0 plugin 설치 가이드 → [`plugins/antigravity-ai-action-tracker/README.md`](./plugins/antigravity-ai-action-tracker/README.md)
- Antigravity e2e findings (구현 전 unknown 4종 — MCP tool naming / plugin root 변수 / subagent stdin / Stop continue UX) → [`docs/research/antigravity-e2e-findings.md`](./docs/research/antigravity-e2e-findings.md)
- Hook 설치 절차 (Claude Code, plugin 미사용 시) → [`docs/hook-installation.md`](./docs/hook-installation.md)
- 공식 MCP 빌드 가이드 → <https://modelcontextprotocol.io/docs/develop/build-server>
- 공식 Claude Code hooks 문서 → <https://code.claude.com/docs/en/hooks>
- 공식 Codex CLI hooks 문서 → <https://developers.openai.com/codex/hooks>
