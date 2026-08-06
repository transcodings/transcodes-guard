# transcodes-guard — Cursor IDE 플러그인 (Beta)

[English](./README.md) | **한국어**

> ⚠️ **베타** — Cursor 플러그인은 아직 베타 버전이라 크래시나 버그가 발생할 수 있고, 설치 방법과 API가 바뀔 수 있습니다. 안정적인 사용에는 정식 지원 호스트인 **Claude Code** 또는 **Codex** 플러그인을 권장합니다.

Cursor용 위험 셸 인터셉터(`beforeShellExecution` / `beforeMCPExecution`) + 감사 MCP 서버.

Claude Code / Codex / Antigravity 플러그인과 동일한 스텝업 MFA 게이트 로직(`@transcodes-guard/core/stepup`, `@transcodes-guard/core/server`)을 공유하며, Cursor에 특화된 부분은 hook 어댑터(`cursorAdapter`)뿐입니다. `dist/`가 커밋되어 있어 설치 시 빌드가 필요 없습니다.

## 사전 요구사항

- **Cursor 0.46+** (Hooks 기능 활성화 — Settings → Hooks에서 확인).
- `PATH`에 **Node.js ≥ 20**.
- Cursor **데스크톱** 앱 — 2026-05 기준 Cloud Agent는 `beforeMCPExecution`, `stop`, `sessionStart`, `beforeSubmitPrompt` hook을 실행하지 않습니다.

## 설치

**한 줄**로 설치합니다 — 수동 `cd`, `npm install`, 빌드 불필요:

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/cursor/install.mjs && rm -rf /tmp/tg-install
```

인스톨러가 하는 일:

1. `~/.cursor/plugins/local/transcodes-guard`에 플러그인 복사
2. hook/MCP 설정의 `${CURSOR_PLUGIN_ROOT}`를 절대 경로로 치환
3. `~/.cursor/hooks.json`에 transcodes-guard hook만 merge(다른 hook 유지; 스크립트 경로로 매칭되는 기존 transcodes-guard 항목은 교체)
4. `~/.cursor/mcp.json`의 `transcodes-guard` 항목만 upsert(다른 MCP 서버는 유지)
5. 설정 파일이 있으면 게이트 친화적 Cursor CLI 설정 적용 — 글로벌: `~/.cursor/cli-config.json`; `--local`: `<cwd>/.cursor/cli.json` ([CLI Agent 설정](#cli-agent-설정) 참고)

같은 한 줄을 재실행하면 업데이트됩니다.

**기여자 / 워크스페이스 전용:** 저장소 클론 후 `node plugins/cursor/install.mjs --local` (`<cwd>/.cursor/plugins/transcodes-guard` + `<cwd>/.cursor/hooks.json`).

> **Marketplace 설치만으로는 부족합니다.** Cursor Marketplace / `/add-plugin`은 `.cursor-plugin/plugin.json`을 읽지만, 모든 Agent 실행 경로에서 user-level hook이 등록되지 않을 수 있습니다(CLI `unrestricted`, allowlist 우회, Cloud Agent). 안정적인 게이트 연동을 위해 항상 `install.mjs`를 실행하세요.
>
> **선택 — Teams / Enterprise:** 관리자가 `https://github.com/transcodings/transcodes-guard`를 팀 마켓플레이스로 import해 Required/Optional로 배포할 수 있습니다 — 개발자 PC마다 `install.mjs`도 함께 실행하세요.

### 첫 실행 시 hook 신뢰 승인

hook이 처음 발동할 때 Cursor가 일회성 신뢰 검토를 요청합니다. 한 번 승인하면 Cursor가 결정을 캐시합니다. 명령 팔레트 → **Cursor: Review Hooks**에서 언제든 확인할 수 있습니다.

### 토큰 저장

MCP 서버와 스텝업 hook은 멤버 MCP JWT로 Transcodes 백엔드에 인증합니다. **권장** — CLI 컨트롤 플레인을 한 번 설치한 뒤 대시보드에서 토큰을 입력하세요. `~/.transcodes/config.json`에 영구 저장되어 모든 에이전트 세션이 읽습니다(환경 변수 불필요):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
# Windows (PowerShell):
# Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

브라우저에서 `transcodes login`으로 로그인하세요.

토큰이 없으면 hook은 여전히 위험 명령을 **차단**하지만 스텝업 세션을 시작할 수 없습니다.

### CLI Agent 설정

다음 경우 Cursor가 `beforeShellExecution` / `beforeMCPExecution` **없이** 도구를 실행할 수 있습니다:

- `"approvalMode": "unrestricted"` (Run Everything)
- `permissions.allow`에 Shell/MCP가 미리 등록된 경우

**`install.mjs`가 자동 적용** (설정 파일이 이미 있을 때):

| 설정 | 동작 |
|---|---|
| `approvalMode: "unrestricted"` | `"allowlist"`로 변경 |
| broad allow 항목 | `Shell(*)`, `Shell(**)`, `Mcp(*)`, `Mcp(*:*)` 제거 |

**자동 제거 안 함:** `Shell(ls)` 같은 좁은 allow 항목 — 해당 명령은 여전히 hook을 우회합니다. 인스톨러가 남은 Shell/Mcp allow 개수를 경고로 출력하므로, 게이트를 타게 하려면 직접 삭제하세요.

설정 파일 경로: `~/.cursor/cli-config.json` (글로벌) 또는 `.cursor/cli.json` (`--local`).

## 플러그인이 하는 일

| Hook 이벤트 | 동작 |
|---|---|
| `beforeShellExecution` | Shell 명령에 대해 2단계 검사(정규식 패턴 + `rm -rf`에 대한 `git ls-files` 의미 검사). 일치 시 `{ permission: "deny", user_message, agent_message }`로 차단하고 스텝업 MFA를 시작합니다. |
| `beforeMCPExecution` | MCP 도구 호출에 대한 정확 일치 tool-rule(시스템 + 정책 번들). `beforeShellExecution`과 동일한 hook 바이너리가 처리하며, classifier는 `Bash` / `run_command`와 함께 `Shell` 도구명을 허용합니다. |
| `sessionStart` | MCP 토큰이 없으면 `{ additional_context }`로 안내. |
| `beforeSubmitPrompt` | 다음 게이트 대상 tool 호출을 위해 현재 프롬프트를 로컬에 캐시한 뒤 필수 응답 `{ continue: true }`를 출력합니다. 캐시 실패는 제출을 막지 않습니다. |
| `stop` | no-op — stdin만 비우고 조용히 종료합니다. 스텝업 상태는 백엔드 SSOT라 회수하거나 상기시킬 로컬 상태가 없으며, 에이전트는 PreToolUse deny + `tc_poll_stepup_session_wait`로 복구합니다. |

게이트 hook 2종(`beforeShellExecution` / `beforeMCPExecution`)은 `failClosed: true`로 선언됩니다. Cursor의 기본값은 fail-open이라 hook이 크래시·타임아웃하거나 잘못된 JSON을 내면 명령이 그대로 통과합니다. 그래서 게이트는 hook 자체가 실패하면 명령을 명시적으로 차단하며, 이는 보안에 민감한 hook에 대한 Cursor 권장사항과 일치합니다. 수명주기 hook(`sessionStart` / `beforeSubmitPrompt` / `stop`)은 차단이 아닌 관찰 역할이므로, 실패가 정상 작업을 가로막지 않도록 fail-open을 유지합니다.

MCP 서버 자체(`mcp.json`에 `transcodes-guard`로 등록)는 다른 플러그인과 동일한 도구를 제공합니다: **진단 / 시뮬레이션**(`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **스텝업 수명주기**(`create_stepup_session`, `poll_stepup_session_wait`), **Transcodes 관리**(멤버 / 조직 / RBAC / 멤버십 / passcode / auth-device / 감사 / 프로젝트 관리).

## 슬래시 명령: `/transcodes`

게이트 룰을 관리하는 단일 "정문"입니다. `/transcodes` 뒤에 평문 요청을 붙이면 에이전트가 맞는 guard 워크플로로 라우팅하고, 빠진 정보는 사용자에게 묻습니다:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

`install.mjs`가 `.cursor/commands/`를 `~/.cursor/commands/`로 복사합니다. Agent 입력창에서 `/`를 입력하면 나타납니다. 라우팅 대상: MCP 도구 게이트(`add_tool_rule`), Bash 명령 차단(`add_user_pattern`), 룰 변경(`update_*`), 룰 목록, 차단 여부 확인(`simulate_*`), 스텝업 상태 조회, 프론트엔드 Transcodes SDK 연동(`get_integration_guide`).

## AI 에이전트를 위한 안내

오픈 소스: [transcodes-guard](https://github.com/transcodings/transcodes-guard)

`beforeShellExecution` / `beforeMCPExecution` hook이 **Step-up MFA**를 언급하는 사유와 함께 차단하면, 그 명령은 **차단되어 실행되지 않았습니다**. 차단 메시지 자체가 이 스텝업 지침을 담고 있습니다(`sessionStart` hook은 프로토콜이 아니라 carry-over 상태만 노출합니다). wait tool 호출 전까지 사용자 확인을 기다리지 말고 루프를 결정적으로 진행하세요:

1. 자동으로 열린 브라우저 탭에서 WebAuthn을 완료하라고 사용자에게 한 줄로 알립니다(탭이 열리지 않았으면 차단 메시지의 URL 사용).
2. 즉시 MCP 도구 **`tc_poll_stepup_session_wait`**를 제공된 `sid`로 호출합니다. verified 되거나 최대 약 5분(session TTL) 타임아웃까지 블록됩니다.
3. **`outcome: "verified"`**면 **원래 차단된 명령**을 재시도합니다. **`outcome: "timeout"`**, **`rejected`**, 또는 **`not_found`**이면 사용자에게 한 줄로 이 명령이 실행되지 않았다고 알리고, **차단된 명령은 skip**한 뒤 **나머지 작업을 계속**하세요. 사용자가 다시 인증·재시도를 명시적으로 요청하기 전까지 같은 차단 명령을 재시도하거나 재폴링·auth 탭 재오픈을 하지 마세요. 차단된 동작을 우회하는 대체 명령을 만들지 마세요.

차단된 명령이 실행됐다고 가정하지 마세요. 대체 명령을 임의로 만들지 마세요. 항상 대기 중 `sid`에서 이어가세요. `tc_inspect_stepup_state`로 읽기 전용 스냅샷을 확인하세요. Cursor에서는 `beforeSubmitPrompt`에 컨텍스트 채널이 없고 스텝업 완료를 ack하지 않으므로, 사용자 "완료" 메시지가 아니라 `tc_poll_stepup_session_wait`에 의존하세요.

## 활성화 / 비활성화

런타임 킬 스위치는 없습니다. 보호를 끄려면 호스트의 기본 메커니즘으로 플러그인을 비활성화하거나 제거하세요(예: Cursor는 `~/.cursor/hooks.json` / `mcp.json`에서 제거). 게이트를 켜는 것은 에이전트에게 안전하지만, 끄는 것은 사람만 할 수 있는 작업입니다.

## Claude Code 대비 와이어 포맷 차이

Cursor hook 계약은 어댑터가 캡슐화합니다(`packages/core/src/hosts/cursor.ts`):

1. **평면형(flat) 게이트 출력** — `beforeShellExecution` / `beforeMCPExecution`이 공유하는 `dist/hooks/pre-tool-use.js`가 stdout에 `{ permission: "allow"|"deny", user_message?, agent_message?, updated_input? }`를 쓰고 `exit 0`. Claude Code의 `hookSpecificOutput.permissionDecision`이나 exit code `2`가 아님.
2. **Stop이 `followup_message` 사용** — Claude Code의 `{ decision: "block", reason }`과 의미는 같고 키 이름만 다름.
3. **이벤트명 vs 스크립트 파일명** — Cursor 이벤트는 camelCase(`beforeSubmitPrompt`, `sessionStart`); 스크립트는 kebab-case. Claude Code의 `user-prompt-submit` 명명과 다름.

| Cursor hook 이벤트 | 스크립트 (`dist/hooks/`) |
|---|---|
| `beforeShellExecution`, `beforeMCPExecution` | `pre-tool-use.js` |
| `sessionStart` | `session-start.js` |
| `beforeSubmitPrompt` | `before-submit-prompt.js` |
| `stop` | `stop.js` |

템플릿: `.cursor/hooks.json`. `install.mjs`가 `${CURSOR_PLUGIN_ROOT}`를 설치 경로로 치환.

## 호스트 간 상태 공유

로컬 스텝업 상태는 `~/.transcodes/state/` 아래에 있으며, **모든 transcodes-guard 플러그인이 공유**합니다 — Claude Code에서 verified 된 스텝업이 Cursor로, 그리고 그 반대로도 이어집니다. 같은 순간에 verified 레코드를 두고 벌어지는 경쟁은 알려진 한계입니다(백엔드의 sid-replay 보호가 권위 있는 백스톱).

## 알려진 한계

**게이트 커버리지**

- `beforeShellExecution`과 `beforeMCPExecution`만 게이트됩니다. 내장 file-edit 등 다른 이벤트는 가로채지 않습니다.
- Cloud Agent는 [사전 요구사항](#사전-요구사항)에 적힌 lifecycle hook을 실행하지 않습니다.
- 좁은 `permissions.allow` Shell/Mcp 항목은 `install.mjs` 실행 후에도 hook을 우회합니다.

**실제 Cursor e2e (빌드가 다르면 이슈 등록)**

1. **stdin `tool_name` 정확한 값** — 문서는 matcher(`Shell`, MCP 접두사)만 느슨하게 기술. classifier는 `Shell`, `Bash`, `run_command`를 방어적으로 허용.
2. **`beforeMCPExecution` 페이로드 형태** — 엄격한 tool-rule 작성 전 실제 MCP hook 페이로드 캡처 권장.
3. **`stop.followup_message` UX** — 리마인더가 모델에 보이지 않으면 `hooks/stop.ts`에서 `cursorAdapter.emitStop`을 건너뛰어 조용한 회수만 수행.

## 문제 해결

- **hook이 발동하지 않음.** `install.mjs` 실행(`~/.cursor/hooks.json` merge + `cli-config.json` 자동 수정). Settings → Hooks → transcodes-guard trust. `~/.cursor/cli-config.json` 재확인: 인스톨러가 `allowlist`와 broad allow는 처리하지만 좁은 Shell/Mcp allow는 남을 수 있음. **로컬 IDE Agent**로 테스트(Cloud Agent 아님). `node`가 Cursor `PATH`에 있는지 확인.
- **`permission: deny`인데 스텝업 URL이 없음.** hook이 토큰 없이 차단 중입니다 — CLI 설치(`curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash` 또는 Windows: `Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex`) 후 `transcodes`로 토큰 저장.
- **MCP 도구 호출이 멈춤.** `~/.cursor/mcp.json`에 `transcodes-guard`가 있고 `~/.cursor/plugins/local/transcodes-guard/dist/src/stdio.js`가 존재하는지 확인. Cursor는 MCP 실패를 Output 패널에 기록합니다.

## 라이선스

FSL-1.1-ALv2 (리포지토리 루트 참고).
