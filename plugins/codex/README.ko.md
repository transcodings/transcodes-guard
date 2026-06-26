# transcodes-guard — Codex CLI 플러그인

[English](./README.md) | **한국어**

OpenAI Codex CLI용 위험 bash 인터셉터(`PreToolUse` hook) + 감사 MCP 서버.

Claude Code 플러그인과 동일한 스텝업 MFA 게이트 로직(`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`)을 공유하며, Codex에 특화된 부분은 hook 어댑터와 플러그인 매니페스트뿐입니다.

## 사전 요구사항

- **플러그인 + hooks를 지원하는 Codex CLI 빌드**. `codex plugin --help`로 하위 명령 존재를 확인하세요.
- **Node.js ≥ 20**.

## 설치

### 1. 플러그인 설치

플러그인 매니페스트는 `plugins/codex/.codex-plugin/plugin.json`에 있고, 리포지토리는 `.agents/plugins/marketplace.json`에 Codex 마켓플레이스 카탈로그(`./plugins/codex`를 가리키는 `local` 소스)를 함께 제공합니다. 리포지토리를 클론하고, 커밋된 `dist/`를 빌드한 뒤, 저장소 루트를 카탈로그로 등록하고 플러그인을 설치하세요:

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install && npm run build:plugin

codex plugin marketplace add .                 # "bigstrider" 마켓플레이스 등록
codex plugin add transcodes-guard@bigstrider   # 플러그인 설치
# 또는 Codex → /plugins 에서 bigstrider 마켓플레이스의 "transcodes-guard" 설치
```

### 2. 첫 실행 시 hook 신뢰 승인

hook이 처음 발동하려 할 때 Codex가 신뢰 검토를 요청합니다(`/hooks`로 수동 확인). 한 번 승인하면 Codex가 신뢰 결정을 캐시합니다. `--dangerously-bypass-hook-trust`는 **사용하지 마세요** — 게이트의 권위를 무력화합니다.

### 3. 토큰 저장

MCP 서버와 스텝업 hook은 둘 다 멤버 MCP JWT로 Transcodes 백엔드에 인증합니다. **권장** — CLI 컨트롤 플레인을 한 번 설치한 뒤 대시보드에서 토큰을 입력하세요. `~/.transcodes/config.json`에 영구 저장되어 모든 에이전트 세션이 읽습니다(환경 변수 불필요):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # 로컬 대시보드가 열립니다 — 터미널에 URL이 출력됩니다(기본 포트 3847, `--port N`으로 변경 가능)
```

비대화형 대안(같은 저장소): `transcodes set <token> -l <label>`.
토큰이 없으면 hook은 여전히 위험 명령을 **차단**하지만 스텝업 세션을
시작할 수 없습니다 — Codex가 토큰을 제공하라는 사유를 표시합니다.

## 플러그인이 하는 일

| 구성 요소 | 동작 |
|---|---|
| `PreToolUse` hook | Bash에 대해 2단계 검사(정규식 패턴 + `rm -rf`에 대한 `git ls-files` 의미 검사) + MCP 호출에 대한 정확 일치 tool-rule. 일치 시 차단하고 스텝업 MFA 흐름을 시작합니다. |
| MCP 서버 (`transcodes-guard`) | **진단 / 시뮬레이션** 도구(`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **스텝업 수명주기** 도구(`create_stepup_session`, `poll_stepup_session_wait`), **Transcodes 관리** 도구(멤버 / 조직 / RBAC / 멤버십 / passcode / auth-device / 감사 / 프로젝트 관리). |
| `SessionStart` hook | 스텝업 세션이 세션 경계를 넘어 살아남았으면 carry-over 알림을 주입합니다. 정적 프로토콜 primer는 [`AGENTS.md`](./AGENTS.md)에 있습니다. |
| `UserPromptSubmit` hook | 사용자의 "인증 완료" 프롬프트(`"완료"`, `"done"`, …)를 감지하고 대기 중인 `sid`를 노출해 에이전트가 폴링하게 합니다. |
| `Stop` hook | 매달린 스텝업 루프를 정리하고, 고아가 된 verified/pending 레코드를 조용히 회수합니다. |

## 슬래시 명령: `$transcodes`

게이트 룰을 관리하는 단일 "정문"입니다. Codex는 번들 스킬을 **`$` 멘션**( `/` 아님)으로 노출하므로, `$transcodes` 뒤에 평문 요청을 붙이면 에이전트가 맞는 guard 워크플로로 라우팅하고, 빠진 정보는 사용자에게 묻습니다:

```
$transcodes gate the google calendar delete tool behind step-up
$transcodes list the current rules
$transcodes is "git push --force" blocked?
```

스킬은 플러그인 `skills/` 디렉터리에 있고 `.codex-plugin/plugin.json`(`"skills": "./skills/"`)에 선언되어 있어 `codex plugin add`만 하면 자동 로드됩니다 — 수동 복사 불필요.

라우팅 대상: MCP 도구 게이트(`add_tool_rule`), Bash 명령 차단(`add_user_pattern`), 룰 변경(`update_*`), 룰 목록, 차단 여부 확인(`simulate_*`), 스텝업 상태 조회, 프론트엔드 Transcodes SDK 연동(`get_integration_guide`).

## AI 에이전트를 위한 안내

`PreToolUse` 차단 시 에이전트가 따라야 할 스텝업 응답 프로토콜(사용자에게 WebAuthn 완료 요청 → `sid`로 `poll_stepup_session_wait` 호출 → `verified`면 동일 호출 재시도)은 [`AGENTS.md`](./AGENTS.md)에 있으며, Codex가 매 턴 에이전트 컨텍스트에 자동 로드합니다. 런타임 루프의 단일 진실 공급원이므로 그곳에서 확인하세요.

## 활성화 / 비활성화

런타임 킬 스위치는 없습니다. 보호를 끄려면 호스트의 기본 메커니즘으로 플러그인을 비활성화하거나 제거하세요(Codex: 플러그인 제거 또는 플러그인 UI에서 비활성화). 게이트를 켜는 것은 에이전트에게 안전하지만, 끄는 것은 사람만 할 수 있는 작업입니다.

## 환경 변수

토큰 해석: 토큰은 `~/.transcodes/config.json`(`transcodes` 대시보드 또는
`transcodes set`)에서만 읽습니다.

| 변수 | 필수 여부 | 용도 |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | 아니오 | 기본 백엔드(`https://api.transcodesapis.com`) 재정의. |
| `PLUGIN_ROOT` | 호스트 설정 | Codex hook 명령이 플러그인 루트를 찾는 데 사용합니다. MCP 서버는 `cwd: "."`와 상대 경로로 실행됩니다. `simulate_hook_invocation`을 플러그인 밖에서 직접 실행할 때도 이 값을 fallback으로 사용할 수 있습니다. |

## 호스트 간 상태 공유

로컬 스텝업 상태는 `~/.transcodes/state/` 아래에 있으며, 설계상 **모든 transcodes-guard 플러그인이 공유**합니다 — 모든 호스트가 동일한 Transcodes 백엔드와 통신하므로 한 호스트에서 verified 된 세션이 다른 호스트로 이어집니다. 동시 사용이 지원되지만, 같은 순간에 verified 레코드를 두고 벌어지는 경쟁은 알려진 한계입니다(백엔드의 sid-replay 보호가 권위 있는 백스톱).

## 문제 해결

- **hook이 발동하지 않음.** 플러그인이 설치/활성화되어 있는지 확인한 뒤, `codex` → `/hooks`로 신뢰를 확인하세요.
- **`$transcodes`를 사용할 수 없음.** `codex plugin list`에서 플러그인이 설치/활성화되어 있는지 확인하세요. Codex는 번들 스킬을 `/skills`와 `$` 멘션으로 노출합니다.
- **`permissionDecision: deny`인데 스텝업 URL이 없음.** hook이 토큰 없이 차단 중입니다 — CLI를 설치(`npm install -g @bigstrider/transcodes-cli`)한 뒤 `transcodes`로 대시보드에서 토큰을 저장하세요(또는 `transcodes set <token> -l <label>`).
- **`simulate_hook_invocation`이 "CLAUDE_PLUGIN_ROOT (or PLUGIN_ROOT for Codex) must be set"을 보고함.** `PLUGIN_ROOT`가 설정되지 않은 경우입니다 — MCP 서버를 플러그인 밖에서 실행할 때(예: 절대 경로로 `codex mcp add`) 발생합니다. 실행 전에 `PLUGIN_ROOT`를 플러그인 디렉터리로 내보내세요.

## 라이선스

FSL-1.1-ALv2 (리포지토리 루트 참고).
