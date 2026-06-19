# transcodes-guard — Cursor IDE 플러그인

[English](./README.md) | **한국어**

Cursor용 위험 셸 인터셉터(`beforeShellExecution` / `beforeMCPExecution`) + 감사 MCP 서버.

Claude Code / Codex / Antigravity 플러그인과 동일한 스텝업 MFA 게이트 로직(`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`)을 공유하며, Cursor에 특화된 부분은 hook 어댑터(`cursorAdapter`)와 아래 설치 레이아웃뿐입니다. Cursor에는 `plugin.json` 개념이 없으므로(마켓플레이스 번들 스펙이 비공개) 설치는 GitHub 릴리스 tarball + `install.sh` 방식입니다.

## 사전 요구사항

- **Cursor 0.46+** (Hooks 기능 활성화 — Settings → Hooks에서 확인).
- `PATH`에 **Node.js ≥ 20**.
- Cursor 데스크톱 앱 — 2026-05 기준 `beforeMCPExecution`, `stop`, `sessionStart`, `beforeSubmitPrompt`는 Cursor Cloud Agents에서 연결되지 않습니다.

## 설치

### 프로젝트 범위 (워크스페이스별)

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install
npm run build:plugin

# 대상 워크스페이스에서:
cd /path/to/your/project
/path/to/transcodes-guard/plugins/cursor/install.sh
```

`<project>/.cursor/hooks.json`을 플러그인 `dist/`에 대한 절대 경로로 작성합니다. `mcp.json`은 **병합 인식(merge-aware)** 방식입니다: `<project>/.cursor/mcp.json`이 아직 없을 때만 작성하며, 이미 존재하면 `install.sh`가 덮어쓰기를 거부하고 `mcpServers` 아래에 수동으로 추가할 `transcodes-guard` 항목을 출력합니다(다른 MCP 서버를 보존하기 위함). 이 수동 단계를 건너뛰면 MCP 서버는 등록되지 않습니다.

### 사용자 범위 (모든 워크스페이스)

```bash
/path/to/transcodes-guard/plugins/cursor/install.sh --user
```

`~/.cursor/hooks.json`(그리고 동일한 병합 인식 규칙이 적용되는 `~/.cursor/mcp.json`)을 작성합니다. 모든 Cursor 워크스페이스에서 게이트를 활성화하려는 경우 유용합니다. 사용자 지정 대상도 지원됩니다: `install.sh --target /path/to/workspace`.

### 첫 실행 시 hook 신뢰 승인

hook이 처음 발동할 때 Cursor가 일회성 신뢰 검토를 요청합니다. 한 번 승인하면 Cursor가 결정을 캐시합니다. 명령 팔레트 → "Cursor: Review Hooks"에서 언제든 확인할 수 있습니다.

### `TRANSCODES_TOKEN`

MCP 서버와 스텝업 hook은 멤버 MCP JWT로 Transcodes 백엔드에 인증합니다:

```bash
export TRANSCODES_TOKEN="$(read-your-token-here)"
```

Cursor를 실행하는 셸(또는 셸 rc)에 설정하세요. 토큰이 없으면 hook은 여전히 위험 명령을 **차단**하지만 스텝업 세션을 시작할 수 없습니다.

## 플러그인이 하는 일

| Hook 이벤트 | 동작 |
|---|---|
| `beforeShellExecution` | Shell 명령에 대해 2단계 검사(정규식 패턴 + `rm -rf`에 대한 `git ls-files` 의미 검사). 일치 시 `{ permission: "deny", user_message, agent_message }`로 차단하고 스텝업 MFA를 시작합니다. |
| `beforeMCPExecution` | MCP 도구 호출에 대한 정확 일치 tool-rule(시스템 + 정책 번들). `beforeShellExecution`과 동일한 hook 바이너리가 처리하며, classifier는 `Bash` / `run_command`와 함께 `Shell` 도구명을 허용합니다. |
| `sessionStart` | 이전 세션에서 넘어온 carry-over 스텝업 상태를 `additional_context`로 노출합니다. |
| `beforeSubmitPrompt` | 사용자의 "인증 완료" 프롬프트(`완료` / `done` / …)를 감지합니다. Cursor는 이 이벤트에 `additional_context` 채널이 없으므로, hook이 `consumeVerified` + `clearPending`를 부수 효과로 수행하고 `{ continue: true }`를 내보냅니다. |
| `stop` | `followup_message`로 매달린 스텝업 세션을 모델에 상기시키고, 고아 verified/pending 레코드를 조용히 회수합니다. |

MCP 서버 자체(`mcp.json`에 `transcodes-guard`로 등록)는 다른 플러그인과 동일한 도구를 제공합니다: **진단 / 시뮬레이션**(`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **스텝업 수명주기**(`create_stepup_session`, `poll_stepup_session_wait`), **Transcodes 관리**(멤버 / 조직 / RBAC / 멤버십 / passcode / auth-device / 감사 / 프로젝트 관리).

## AI 에이전트를 위한 안내

`beforeShellExecution` / `beforeMCPExecution` hook이 **Step-up MFA**를 언급하는 사유와 함께 차단하면, 그 명령은 **차단되어 실행되지 않았습니다**. 차단 메시지 자체가 이 스텝업 지침을 담고 있습니다(`sessionStart` hook은 프로토콜이 아니라 carry-over 상태만 노출합니다). 루프를 결정적으로 진행하세요 — 단계 사이에 사용자 확인을 기다리지 마세요:

1. 자동으로 열린 브라우저 탭에서 WebAuthn을 완료하라고 사용자에게 한 줄로 알립니다(탭이 열리지 않았으면 차단 메시지의 URL 사용).
2. 즉시 MCP 도구 **`poll_stepup_session_wait`**를 제공된 `sid`로 호출합니다. verified 되거나 60초 타임아웃까지 블록됩니다.
3. `outcome: "verified"`면 **원래 차단된 명령**을 재시도합니다 — hook이 verified 상태를 로컬에서 감지해 허용합니다. `outcome: "timeout"`이면 사용자에게 WebAuthn 재시도를 요청한 뒤 wait 도구를 다시 호출합니다. `outcome: "rejected"`면 사용자가 스텝업을 거부한 것이므로 그 사실을 알리고 **재시도하지 마세요**.

차단된 명령이 실행됐다고 가정하지 마세요. 대체 명령을 임의로 만들지 마세요. 항상 대기 중 `sid`에서 이어가세요. `inspect_stepup_state`로 읽기 전용 스냅샷을 확인하세요. 참고: Cursor에서는 `beforeSubmitPrompt`에 컨텍스트 채널이 없어 사용자의 "완료" 메시지가 조용히 처리되므로, 프롬프트 측 확인을 기대하기보다 `poll_stepup_session_wait` 루프에 의존하세요.

## 활성화 / 비활성화

런타임 킬 스위치는 없습니다. 보호를 끄려면 호스트의 기본 메커니즘으로 플러그인을 비활성화하거나 제거하세요(예: Cursor는 `hooks.json` / `mcp.json`에서 제거, Claude Code는 `/plugin disable transcodes-guard`). 게이트를 켜는 것은 에이전트에게 안전하지만, 끄는 것은 사람만 할 수 있는 작업입니다.

## Claude Code 대비 와이어 포맷 차이

Cursor의 hook 계약은 어댑터가 캡슐화하는 두 가지 면에서 Claude Code와 다릅니다:

1. **Flat PreToolUse 출력** — `hookSpecificOutput.permissionDecision` 대신 `{ permission, user_message?, agent_message?, updated_input? }`.
2. **Stop이 `followup_message` 사용** — Claude Code의 `{ decision: "block", reason }`과 의미는 같고 키 이름만 다릅니다.

둘 다 게이트 로직에는 영향을 주지 않으며, 전부 `packages/hook-adapters/src/cursor.ts`에 있습니다.

## 호스트 간 상태 공유

로컬 스텝업 상태는 `~/.transcodes/state/` 아래에 있으며, **모든 transcodes-guard 플러그인이 공유**합니다 — Claude Code에서 verified 된 스텝업이 Cursor로, 그리고 그 반대로도 이어집니다. verified 레코드에 대한 같은-초 경쟁은 알려진 한계입니다(백엔드의 sid-replay 보호가 권위 있는 백스톱).

## 알려진 한계 / 미검증 항목

다음 네 항목은 출시 전 실제 Cursor 빌드로 검증되지 않았습니다. 환경에서 다른 형태가 드러나면 이슈를 등록하세요:

1. **정확한 `tool_name` 값** — Cursor 문서는 matcher 이름(`Shell`, MCP 도구 접두사)은 문서화하지만 실제 stdin `tool_name` 문자열은 문서화하지 않습니다. classifier는 안전을 위해 `Shell`, `Bash`, `run_command`를 허용합니다.
2. **`beforeMCPExecution` 페이로드 형태** — Cursor가 MCP 호출에 내보내는 실제 stdin `tool_name` 문자열은 느슨하게만 문서화돼 있습니다. 엄격한 tool-rule을 작성하기 전에 실제 이벤트 페이로드로 확인하세요.
3. **`stop.followup_message` UX** — Cursor가 리마인더를 모델에 보이게 렌더링하지 않으면, `hooks/stop.ts`를 편집해 `cursorAdapter.emitStop` 호출을 건너뛰어 조용한 회수로 전환하세요.
4. **`__TRANSCODES_GUARD_ROOT__` 치환** — `install.sh`가 이 자리표시자를 절대 경로로 치환합니다. 이후 `.cursor/hooks.json`을 직접 편집할 때는 절대 경로를 유지하세요(Cursor는 `command` 문자열 안에서 `$CURSOR_PROJECT_DIR`를 확장하지 않습니다).

## 문제 해결

- **hook이 발동하지 않음.** Settings → Hooks를 열어 `.cursor/hooks.json`의 경로가 절대 경로이고 `node`가 Cursor의 `PATH`에 있는지 확인하세요(Cursor는 macOS에서 터미널로 실행했을 때만 로그인 셸 환경을 상속합니다).
- **`permission: deny`인데 스텝업 URL이 없음.** hook이 토큰 없이 차단 중입니다 — `TRANSCODES_TOKEN`을 설정하고 Cursor를 재시작하세요.
- **MCP 도구 호출이 멈춤.** `~/.cursor/mcp.json`이 작성됐고 `dist/src/stdio.js`가 존재하는지 확인하세요. Cursor는 MCP 실패를 Output 패널에 기록합니다.

## 라이선스

FSL-1.1-ALv2 (리포지토리 루트 참고).
