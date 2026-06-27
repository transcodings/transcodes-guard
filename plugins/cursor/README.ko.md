# transcodes-guard — Cursor IDE 플러그인 (Beta)

[English](./README.md) | **한국어**

> ⚠️ **베타** — Cursor 플러그인은 아직 베타 버전이라 크래시나 버그가 발생할 수 있고, 설치 방법과 API가 바뀔 수 있습니다. 안정적인 사용에는 정식 지원 호스트인 **Claude Code** 또는 **Codex** 플러그인을 권장합니다.

Cursor용 위험 셸 인터셉터(`beforeShellExecution` / `beforeMCPExecution`) + 감사 MCP 서버.

Claude Code / Codex / Antigravity 플러그인과 동일한 스텝업 MFA 게이트 로직(`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`)을 공유하며, Cursor에 특화된 부분은 hook 어댑터(`cursorAdapter`)와 아래 설치 레이아웃뿐입니다. 이 플러그인은 Cursor 매니페스트(`.cursor-plugin/plugin.json`)를 제공하고 리포지토리는 마켓플레이스 매니페스트(`.cursor-plugin/marketplace.json`)를 제공하므로, 네이티브 Cursor 플러그인으로 설치됩니다 — `dist/`가 커밋되어 있어 빌드가 필요 없습니다. 아래의 `install.sh` 소스 빌드 경로는 플러그인을 지원하지 않는 구버전 Cursor 빌드를 위한 **legacy fallback**입니다.

## 사전 요구사항

- **Cursor 0.46+** (Hooks 기능 활성화 — Settings → Hooks에서 확인).
- `PATH`에 **Node.js ≥ 20**.
- Cursor 데스크톱 앱 — 2026-05 기준 `beforeMCPExecution`, `stop`, `sessionStart`, `beforeSubmitPrompt`는 Cursor Cloud Agents에서 연결되지 않습니다.

## 설치

Cursor에는 **"URL에서 플러그인 설치" CLI가 없으며**, 플러그인 관리는 에디터와 팀 대시보드에서 합니다. 어떤 경로를 쓸지는 플랜에 따라 다릅니다. 아래 네이티브 경로는 모두 `.cursor-plugin/plugin.json`을 읽어 `${CURSOR_PLUGIN_ROOT}`로 hook + MCP 서버를 연결합니다 — `dist/`가 커밋되어 있어 빌드가 필요 없습니다.

### 개인 / Pro — 마켓플레이스

에디터에서 `/add-plugin`을 실행하거나 **Customize → Plugins → Marketplace**(`cursor.com/marketplace`)를 연 뒤, 목록에 오른 **Transcodes (bigstrider)** 를 설치합니다.

### 로컬 테스트 — 심볼릭 링크 (개발용, 심사 불필요)

이 리포지토리를 대상으로 로컬에서 개발할 때는 플러그인을 Cursor의 로컬 플러그인 디렉터리에 심볼릭 링크하고 리로드합니다(공식 문서가 안내하는 로컬 테스트 경로이며, 일반 설치 방법은 아닙니다):

```bash
git clone https://github.com/transcodings/transcodes-guard.git   # dist/ 커밋됨, 빌드 불필요
ln -s "$PWD/transcodes-guard/plugins/cursor" ~/.cursor/plugins/local/transcodes-guard
# Cursor → 명령 팔레트 → "Developer: Reload Window"
```

### 팀 / 엔터프라이즈 — 팀 마켓플레이스 (일회성 URL)

관리자가 리포지토리를 한 번 임포트하면(Dashboard → Settings → Plugins → Team Marketplaces → **Add Marketplace**, `https://github.com/transcodings/transcodes-guard` 붙여넣기), Cursor가 `.cursor-plugin/marketplace.json`을 파싱합니다. `transcodes-guard`를 **Required** 또는 **Optional**로 표시하면 개발자는 **Customize → Plugins**에서 설치합니다. (팀 마켓플레이스는 Teams/Enterprise 전용 기능 — 개인/Pro에는 없음.)

### 공개 리스팅 — 공식 마켓플레이스

누구나 원클릭으로 설치하게 하려면 `cursor.com/marketplace/publish`에 리포지토리를 심사 제출합니다.

### Legacy fallback — `install.sh` (플러그인을 지원하지 않는 구버전 Cursor 빌드용)

`install.sh`는 `.cursor/hooks.json`과 `.cursor/mcp.json`에 절대 경로를 작성합니다(평범한 프로젝트/사용자 hook은 마켓플레이스 플러그인이 아니라 `${CURSOR_PLUGIN_ROOT}`를 받지 못하므로 `__TRANSCODES_GUARD_ROOT__`를 치환합니다):

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install
npm run build:plugin

# 프로젝트 범위 (워크스페이스별):
cd /path/to/your/project
/path/to/transcodes-guard/plugins/cursor/install.sh

# 사용자 범위 (모든 워크스페이스): install.sh --user
# 사용자 지정 대상:                install.sh --target /path/to/workspace
```

`mcp.json`은 **병합 인식(merge-aware)** 방식입니다: `<target>/.cursor/mcp.json`이 아직 없을 때만 작성하며, 이미 존재하면 `install.sh`가 덮어쓰기를 거부하고 `mcpServers` 아래에 수동으로 추가할 `transcodes-guard` 항목을 출력합니다(다른 MCP 서버를 보존하기 위함). 이 수동 단계를 건너뛰면 MCP 서버는 등록되지 않습니다.

### 첫 실행 시 hook 신뢰 승인

hook이 처음 발동할 때 Cursor가 일회성 신뢰 검토를 요청합니다. 한 번 승인하면 Cursor가 결정을 캐시합니다. 명령 팔레트 → "Cursor: Review Hooks"에서 언제든 확인할 수 있습니다.

### 토큰 저장

MCP 서버와 스텝업 hook은 멤버 MCP JWT로 Transcodes 백엔드에 인증합니다. **권장** — CLI 컨트롤 플레인을 한 번 설치한 뒤 대시보드에서 토큰을 입력하세요. `~/.transcodes/config.json`에 영구 저장되어 모든 에이전트 세션이 읽습니다(환경 변수 불필요):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # 로컬 대시보드가 열립니다 — 터미널에 URL이 출력됩니다(기본 포트 3847, `--port N`으로 변경 가능)
```

비대화형 대안(같은 저장소): `transcodes set <token> -l <label>`.

토큰이 없으면 hook은 여전히 위험 명령을 **차단**하지만 스텝업 세션을 시작할 수 없습니다.

## 플러그인이 하는 일

| Hook 이벤트 | 동작 |
|---|---|
| `beforeShellExecution` | Shell 명령에 대해 2단계 검사(정규식 패턴 + `rm -rf`에 대한 `git ls-files` 의미 검사). 일치 시 `{ permission: "deny", user_message, agent_message }`로 차단하고 스텝업 MFA를 시작합니다. |
| `beforeMCPExecution` | MCP 도구 호출에 대한 정확 일치 tool-rule(시스템 + 정책 번들). `beforeShellExecution`과 동일한 hook 바이너리가 처리하며, classifier는 `Bash` / `run_command`와 함께 `Shell` 도구명을 허용합니다. |
| `sessionStart` | 이전 세션에서 넘어온 carry-over 스텝업 상태를 `additional_context`로 노출합니다. |
| `beforeSubmitPrompt` | 사용자의 "인증 완료" 프롬프트(`완료` / `done` / …)를 감지합니다. Cursor는 이 이벤트에 `additional_context` 채널이 없으므로, hook이 `consumeVerified` + `clearPending`를 부수 효과로 수행하고 `{ continue: true }`를 내보냅니다. |
| `stop` | `followup_message`로 매달린 스텝업 세션을 모델에 상기시키고, 고아 verified/pending 레코드를 조용히 회수합니다. |

게이트 hook 2종(`beforeShellExecution` / `beforeMCPExecution`)은 `failClosed: true`로 선언됩니다. Cursor의 기본값은 fail-open이라 hook이 크래시·타임아웃하거나 잘못된 JSON을 내면 명령이 그대로 통과합니다. 그래서 게이트는 hook 자체가 실패하면 명령을 명시적으로 차단하며, 이는 보안에 민감한 hook에 대한 Cursor 권장사항과 일치합니다. 수명주기 hook(`sessionStart` / `beforeSubmitPrompt` / `stop`)은 차단이 아닌 관찰 역할이므로, 실패가 정상 작업을 가로막지 않도록 fail-open을 유지합니다.

MCP 서버 자체(`mcp.json`에 `transcodes-guard`로 등록)는 다른 플러그인과 동일한 도구를 제공합니다: **진단 / 시뮬레이션**(`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **스텝업 수명주기**(`create_stepup_session`, `poll_stepup_session_wait`), **Transcodes 관리**(멤버 / 조직 / RBAC / 멤버십 / passcode / auth-device / 감사 / 프로젝트 관리).

## 슬래시 명령: `/transcodes`

게이트 룰을 관리하는 단일 "정문"입니다. `/transcodes` 뒤에 평문 요청을 붙이면 에이전트가 맞는 guard 워크플로로 라우팅하고, 빠진 정보는 사용자에게 묻습니다:

```
/transcodes gate the google calendar delete tool behind step-up
/transcodes list the current rules
/transcodes is "git push --force" blocked?
```

이 명령은 플러그인의 `.cursor/commands/` 디렉터리에 있으며, `plugin.json`이 이를 선언(`"commands": "./.cursor/commands/"`)하므로 네이티브 플러그인 설치 시 자동으로 로드됩니다. legacy `install.sh`는 대신 `<workspace>/.cursor/commands/transcodes.md`로 복사합니다. 어느 경로든 Agent 입력창에서 `/`를 입력하면 나타납니다. 라우팅 대상: MCP 도구 게이트(`add_tool_rule`), Bash 명령 차단(`add_user_pattern`), 룰 변경(`update_*`), 룰 목록, 차단 여부 확인(`simulate_*`), 스텝업 상태 조회, 프론트엔드 Transcodes SDK 연동(`get_integration_guide`).

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

1. **평면형(flat) PreToolUse 출력** — `hookSpecificOutput.permissionDecision` 대신 `{ permission, user_message?, agent_message?, updated_input? }`를 씁니다.
2. **Stop이 `followup_message` 사용** — Claude Code의 `{ decision: "block", reason }`과 의미는 같고 키 이름만 다릅니다.

둘 다 게이트 로직에는 영향을 주지 않으며, 전부 `packages/hook-adapters/src/cursor.ts`에 있습니다.

## 호스트 간 상태 공유

로컬 스텝업 상태는 `~/.transcodes/state/` 아래에 있으며, **모든 transcodes-guard 플러그인이 공유**합니다 — Claude Code에서 verified 된 스텝업이 Cursor로, 그리고 그 반대로도 이어집니다. 같은 순간에 verified 레코드를 두고 벌어지는 경쟁은 알려진 한계입니다(백엔드의 sid-replay 보호가 권위 있는 백스톱).

## 알려진 한계 / 미검증 항목

다음 네 항목은 출시 전 실제 Cursor 빌드로 검증되지 않았습니다. 환경에서 다른 형태가 드러나면 이슈를 등록하세요:

1. **정확한 `tool_name` 값** — Cursor 문서는 matcher 이름(`Shell`, MCP 도구 접두사)은 문서화하지만 실제 stdin `tool_name` 문자열은 문서화하지 않습니다. classifier는 안전을 위해 `Shell`, `Bash`, `run_command`를 허용합니다.
2. **`beforeMCPExecution` 페이로드 형태** — Cursor가 MCP 호출에 내보내는 실제 stdin `tool_name` 문자열은 느슨하게만 문서화돼 있습니다. 엄격한 tool-rule을 작성하기 전에 실제 이벤트 페이로드로 확인하세요.
3. **`stop.followup_message` UX** — Cursor가 리마인더를 모델에 보이게 렌더링하지 않으면, `hooks/stop.ts`를 편집해 `cursorAdapter.emitStop` 호출을 건너뛰어 조용한 회수로 전환하세요.
4. **`__TRANSCODES_GUARD_ROOT__` 치환** — `install.sh`가 이 자리표시자를 절대 경로로 치환합니다. 이후 `.cursor/hooks.json`을 직접 편집할 때는 절대 경로를 유지하세요(Cursor는 `command` 문자열 안에서 `$CURSOR_PROJECT_DIR`를 확장하지 않습니다).

## 문제 해결

- **hook이 발동하지 않음.** Settings → Hooks를 열어 `.cursor/hooks.json`의 경로가 절대 경로이고 `node`가 Cursor의 `PATH`에 있는지 확인하세요(Cursor는 macOS에서 터미널로 실행했을 때만 로그인 셸 환경을 상속합니다).
- **`permission: deny`인데 스텝업 URL이 없음.** hook이 토큰 없이 차단 중입니다 — CLI를 설치(`npm install -g @bigstrider/transcodes-cli`)한 뒤 `transcodes`로 대시보드에서 토큰을 저장하세요(또는 `transcodes set <token> -l <label>`).
- **MCP 도구 호출이 멈춤.** `~/.cursor/mcp.json`이 작성됐고 `dist/src/stdio.js`가 존재하는지 확인하세요. Cursor는 MCP 실패를 Output 패널에 기록합니다.

## 라이선스

FSL-1.1-ALv2 (리포지토리 루트 참고).
