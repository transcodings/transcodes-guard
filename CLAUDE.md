# ai-action-tracker-mcp

Model Context Protocol(MCP) 서버 스캐폴드. 단일 `createServer()` 정의를 stdio(로컬)와 Streamable HTTP `/mcp`(원격) 두 전송으로 노출.

## Essential Commands

```bash
npm install            # workspaces hoist (루트에서 한 번만)
npm run dev:stdio      # tsx, stdio transport (로컬 클라이언트용)
npm run dev:http       # tsx, port 3000 /mcp (원격 테스트)
npm run dev:hook       # tsx, PreToolUse hook (stdin JSON으로 단발 실행)
npm run build          # turbo run build (tsc → plugins/ai-action-tracker/dist/)
npm run build:plugin   # turbo run build:plugin (danger-patterns.json 동기화 포함)
npm run inspect        # MCP Inspector UI로 도구·리소스 직접 호출
```

CI(`.github/workflows/ci.yml`)는 PR마다 `build:plugin` 실행 + `git diff --exit-code plugins/ai-action-tracker/dist/`로 빌드 산출물 동기성을 검증. hook smoke test도 함께 검증 (`rm -rf /` → stdout JSON에 `permissionDecision: "deny"`, `ls` → exit 0 + 빈 출력).

## Running locally without installing the plugin

- `npm run dev:stdio` — tsx 핫리로드 stdio (Inspector·외부 MCP 클라이언트가 직접 접속 가능).
- `npm run inspect` — MCP Inspector UI 자동 기동.
- 컴파일된 dist에 MCP 클라이언트를 직접 붙이려면:
  `claude mcp add ai-action-tracker -- node plugins/ai-action-tracker/dist/src/stdio.js`

## Layout

```
/                                       # 루트 = marketplace + monorepo orchestrator
  .claude-plugin/marketplace.json       # Marketplace 카탈로그 (이 리포가 곧 marketplace).
  package.json                          # private. workspaces + turbo orchestrator. 진짜 metadata 없음.
  turbo.json                            # task pipeline (build, build:plugin).
  .github/workflows/ci.yml              # build sync + hook smoke test.
plugins/
  ai-action-tracker/                    # 배포 단위 plugin 패키지 — 단일 진실원천
    .claude-plugin/plugin.json          #   plugin 매니페스트
    .mcp.json                           #   MCP 서버 등록 (${CLAUDE_PLUGIN_ROOT})
    hooks/hooks.json                    #   PreToolUse 매니페스트
    package.json                        #   진짜 npm metadata (name, main, bin, files, deps)
    tsconfig.json                       #   tsc rootDir = plugin root
    src/                                #     MCP 서버 소스
      server.ts                         #       createServer() — 모든 capability의 단일 정의처
      stdio.ts                          #       로컬 진입점. 셰뱅 + npx 배포 가능.
      http.ts                           #       원격 진입점. 단일 /mcp, stateless.
    hooks/                              #     hook orchestra 소스 (4종)
      hooks.json                        #       PreToolUse/SessionStart/UserPromptSubmit/Stop 매니페스트.
      pre-tool-use.ts                   #       위험 Bash 명령 차단 + step-up 핸드오프.
      session-start.ts                  #       프로토콜 사전 주입 + 이월 pending 알림.
      user-prompt-submit.ts             #       사용자 "완료" 신호 감지 → polling 재개 컨텍스트.
      stop.ts                           #       응답 종료 시 dangling step-up 리마인더.
      danger-patterns.json              #       차단 정규식 목록.
    dist/                               #   build:plugin 산출물 (git 커밋, 수동 편집 금지)
docs/
  architecture.md                       # 설계 의도. 비자명한 변경 전 필독.
  adding-capabilities.md                # 새 도구/리소스/프롬프트 추가 절차.
  hook-installation.md                  # plugin 미사용 시 수동 hook 등록 절차.
  research/                             # 외부 리서치 자료 (plugin 변환 전략 포함).
.claude/rules/
  mcp-server.md                         # plugin source 작업 시 자동 로딩되는 룰.
```

**구조 정책 (정리안 2 — 모노리포 정렬):** 코드는 `plugins/ai-action-tracker/src/`, `plugins/ai-action-tracker/hooks/`가 단일 진실원천. 루트는 marketplace catalog + Turborepo orchestrator 역할만 수행. `plugins/ai-action-tracker/dist/`는 `npm run build:plugin` 산출물(git 커밋) — 수동 편집 금지. dev/plugin 채널 모두 plugin 트리 안의 동일 source를 빌드해 사용하므로 본질적 중복 없음.

## Must

- Add capabilities **only** by editing `createServer()` in `plugins/ai-action-tracker/src/server.ts`. Never duplicate registrations in `stdio.ts` or `http.ts`.
- Validate every tool input with `zod`. LLM-supplied arguments are untrusted by default.
- Log via `console.error` (stderr). `console.log` to stdout corrupts JSON-RPC framing in stdio mode and the client will silently disconnect.
- Run `npm run build:plugin` before claiming work complete. No tests exist; `tsc` + dist sync는 CI가 강제하는 정합성 계약.
- After capability changes, verify with `npm run inspect` — the Inspector renders new tools immediately.
- The PreToolUse hook (`plugins/ai-action-tracker/hooks/pre-tool-use.ts`) uses **asymmetric fail policy**:
  - *Before* a danger pattern match (stdin parse, pattern file load, etc.) → **fail-open** (exit 0, no JSON). A buggy hook must not brick the workflow.
  - *After* a danger match → **fail-safe** (exit 0 + stdout JSON `permissionDecision: "deny"`). If we cannot prove the user authorised the command via MFA, we deny. The `systemMessage` field carries the protocol instructions to the model; stderr keeps a 1-line human-readable summary.
- Hook orchestra: PreToolUse(Bash) denies the call; SessionStart injects the protocol primer; UserPromptSubmit detects user "auth done" messages; Stop catches dangling pending state. The four hooks coordinate through a single shared file `~/.cache/.../stepup-pending.json` — see [`docs/architecture.md`](./docs/architecture.md) §5. Never add a new hook for step-up; consume the orchestra instead.
- Step-up MFA module (`plugins/ai-action-tracker/src/stepup/`) is the only place that talks to the Transcodes backend. New sensitive features should consume the gate, not re-create it. Layered as `jwt.ts` → `config.ts` → `client.ts` → `session.ts` (pure, MCP-agnostic) → `gate.ts` (hook-facing) / `inspector.ts` (read-only snapshot). Shared-state helpers live in `pending.ts`; the single-shot verified record in `store.ts`.
- Diagnostic MCP tools for hook/step-up debugging: `inspect_stepup_state` (read-only structured snapshot of `verified` / `pending` / `browser_lock` files, with server-computed `age_ms` / `expired` / `ttl_ms`); `simulate_hook_invocation` (spawns the actual PreToolUse hook binary in a subprocess and diffs state before/after — **not** a dry run, may consume verified record or open a browser tab). Prefer these over wrapping `cat`/`ls` for state inspection.
- Hook output channels (each hook uses what the Claude Code validator accepts for *that* hook type):
  - **PreToolUse** → stdout JSON, v2 `hookSpecificOutput.permissionDecision` (`"deny"` or `"allow"`) + `systemMessage`.
  - **SessionStart / UserPromptSubmit** → stdout JSON, `hookSpecificOutput.additionalContext`.
  - **Stop** → stdout JSON, top-level `{ decision: "block", reason }`. Stop is **excluded** from the `hookSpecificOutput.hookEventName` enum, so wrapping the same payload in `hookSpecificOutput` makes the validator reject it.
  - stderr is for human-readable 1-line summaries only. Exit code `0` everywhere — even on deny, because the deny lives in the JSON. Never use `exit 2` in the new code paths.
- PreToolUse fast-path (verified record consumed) MUST emit an explicit `permissionDecision: "allow"` JSON, **not** plain exit 0. Exit 0 alone falls through to Claude Code's default permission flow, where `settings.json` deny rules or built-in safety patterns can override the step-up verification. The explicit allow is what makes the step-up gate an authority source, not merely an extra safety net.
- Source 수정 후 반드시 `npm run build:plugin`을 거쳐 `plugins/ai-action-tracker/dist/`를 commit과 함께 동기화. CI(`git diff --exit-code`)가 dist 누락 시 fail. plugin 트리 안의 `dist/`를 직접 편집하지 말 것 — 다음 빌드에서 덮어쓰여진다.

## Never

- Use the deprecated positional `server.tool(name, desc, schema, cb)` API. Use `server.registerTool(name, { title, description, inputSchema }, cb)` (and the matching `register*` variants for resource and prompt).
- Use the deprecated SSE transport (`/sse` + `/messages`). Streamable HTTP `/mcp` is the only modern target.
- Deploy `http.ts` to a non-loopback host without authentication. The current scaffold has none — see `docs/architecture.md` (Authentication 섹션) before any production exposure.
- Mutate state inside a Resource handler. Resources are read-only context; side effects belong in Tools.

## See Also

- 설계 의도 (왜 transport 분리, 왜 Streamable HTTP, 인증 미비점) → [`docs/architecture.md`](./docs/architecture.md)
- 능력 추가 step-by-step → [`docs/adding-capabilities.md`](./docs/adding-capabilities.md)
- 배포 플랫폼 비교 리서치 → [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md)
- 외부 사용자용 문서 → [`README.md`](./README.md)
- Hook 설치 절차 → [`docs/hook-installation.md`](./docs/hook-installation.md)
- 공식 MCP 빌드 가이드 → <https://modelcontextprotocol.io/docs/develop/build-server>
- 공식 Claude Code hooks 문서 → <https://code.claude.com/docs/en/hooks>
