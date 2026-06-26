# transcodes-guard — Claude Code 플러그인

[English](./README.md) | **한국어**

Claude Code용 위험 셸 인터셉터(`PreToolUse` hook) + 스텝업 MFA 감사 MCP 서버.

에이전트가 위험한 Bash 명령(또는 보호된 MCP 도구 호출)을 실행하려는 순간, `PreToolUse` hook이 이를 가로채 명령 실행 **전에** Transcodes 백엔드를 상대로 WebAuthn 스텝업을 강제합니다. 공유 게이트 로직은 `@transcodes-guard/stepup-core` + `@transcodes-guard/mcp-server-core`에 있으며, Claude Code에 특화된 부분은 hook 어댑터와 플러그인 매니페스트뿐입니다.

## 사전 요구사항

- **Claude Code** (플러그인 지원 버전).
- `PATH`에 **Node.js ≥ 20** (hook과 MCP 서버는 `node` 하위 프로세스로 실행됩니다).
- 스텝업용 **멤버 MCP JWT** — CLI로 저장 권장 (`npm install -g @bigstrider/transcodes-cli` 후 `transcodes`; [토큰 저장](#2-토큰-저장) 참고).

## 설치

### 1. 마켓플레이스 추가 후 설치

```
/plugin marketplace add transcodings/transcodes-guard
/plugin install transcodes-guard@bigstrider
```

Claude Code가 런타임에 `${CLAUDE_PLUGIN_ROOT}`를 설정하고, 매니페스트(`.claude-plugin/`)와 `hooks/hooks.json`이 모든 hook·MCP 서버 경로를 이 변수 기준으로 해석하므로 수동 설정이 필요 없습니다. 설치 즉시 4개 hook과 MCP 서버가 활성화됩니다.

### 2. 토큰 저장

MCP 서버와 스텝업 hook은 둘 다 멤버 MCP JWT로 Transcodes 백엔드에 인증합니다. **권장** — CLI 컨트롤 플레인을 한 번 설치한 뒤 대시보드에서 토큰을 입력하세요. `~/.transcodes/config.json`에 영구 저장되어 모든 에이전트 세션이 읽습니다(환경 변수 불필요):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # 로컬 대시보드가 열립니다 — 터미널에 URL이 출력됩니다(기본 포트 3847, `--port N`으로 변경 가능)
```

비대화형 대안(같은 저장소): `transcodes set <token> -l <label>`.

토큰이 없으면 hook은 여전히 위험 명령을 **차단**하지만 스텝업 세션을 시작할 수 없습니다 — 차단 사유에 토큰을 제공하라는 안내가 표시됩니다.

## 플러그인이 하는 일

| 구성 요소 | 동작 |
|---|---|
| `PreToolUse` hook (matcher `Bash\|mcp__.*`) | Bash에 대해 2단계 검사(정규식 위험 패턴 + `rm -rf`에 대한 `git ls-files` 의미 검사) + MCP 호출에 대한 정확 일치 tool-rule. 일치 시 차단하고 스텝업 MFA 흐름을 시작합니다. |
| MCP 서버 (`transcodes-guard`) | **진단 / 시뮬레이션** 도구(`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **스텝업 수명주기** 도구(`create_stepup_session`, `poll_stepup_session_wait`), **Transcodes 관리** 도구(멤버 / 조직 / RBAC / 멤버십 / passcode / auth-device / 감사 / 프로젝트 관리). |
| `SessionStart` hook | 스텝업 프로토콜 primer(에이전트가 차단에 어떻게 대응할지 알도록)와, 재시작을 넘겨 살아남은 스텝업 세션이 있으면 그 carry-over 알림을 주입합니다. 순수 추가 컨텍스트일 뿐 — 절대 차단하지 않습니다. |
| `UserPromptSubmit` hook | 사용자의 "인증 완료" 프롬프트(`"완료"`, `"done"`, …)를 감지하고 대기 중인 `sid`를 노출해 에이전트가 폴링을 재개하게 합니다. |
| `Stop` hook | 매달린 스텝업 루프를 정리하고, 고아가 된 verified/pending 레코드를 조용히 회수합니다. |

## 트랜스포트

Claude Code는 **두 가지** 트랜스포트를 모두 제공하는 유일한 호스트입니다:

- **stdio** — `node ${CLAUDE_PLUGIN_ROOT}/dist/src/stdio.js` (플러그인 매니페스트가 사용하는 방식).
- **Streamable HTTP** — `POST /mcp`, `PORT`(기본값 `3000`)에서 수신. 외부 MCP 클라이언트 / Inspector에서 사용하려면 `npm run dev:http`로 시작합니다.

## AI 에이전트를 위한 안내

`PreToolUse` 차단이 **Step-up MFA**를 언급하는 사유와 함께 발생하면, 그 명령은 **차단되어 실행되지 않았습니다**. Claude Code는 이 프로토콜을 `SessionStart`에서 자동 주입합니다. 루프를 결정적으로 진행하세요 — 단계 사이에 사용자 확인을 기다리지 마세요:

1. 자동으로 열린 브라우저 탭에서 WebAuthn을 완료하라고 사용자에게 한 줄로 알립니다(탭이 열리지 않았으면 차단 메시지의 URL 사용).
2. 즉시 MCP 도구 **`poll_stepup_session_wait`**를 제공된 `sid`로 호출합니다. verified 되거나 60초 타임아웃까지 블록되며, 한 번 호출이 수동 폴링을 대체합니다. (단발성 `poll_stepup_session`은 진단용입니다.)
3. `outcome: "verified"`면 **동일한** Bash/MCP 호출을 재시도합니다 — hook이 verified 상태를 로컬에서 감지해 허용합니다. `outcome: "timeout"`이면 사용자에게 WebAuthn 재시도를 요청한 뒤 wait 도구를 다시 호출합니다. `outcome: "rejected"`면 사용자가 스텝업을 거부한 것이므로 그 사실을 알리고 **재시도하지 마세요**.

차단된 명령이 실행됐다고 가정하지 마세요. 대체 명령을 임의로 만들지 마세요. 항상 hook이 보고한 대기 중 `sid`에서 이어가세요. 상태가 불확실하면 `inspect_stepup_state`로 읽기 전용 스냅샷을 확인하세요.

## 활성화 / 비활성화

플러그인에는 런타임 킬 스위치가 없습니다. 보호를 끄려면 Claude Code의 플러그인 매니저에서 비활성화하거나 제거하세요. (게이트를 켜는 것은 에이전트에게 안전하지만, 끄는 것은 사람만 할 수 있는 작업입니다 — 이 비대칭성은 의도된 것입니다.)

## 환경 변수

토큰 해석: 토큰은 오직 `~/.transcodes/config.json`(`transcodes` 대시보드 또는 `transcodes set`)에서만 읽습니다.

| 변수 | 필수 여부 | 용도 |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | 아니오 | 기본 백엔드(`https://api.transcodesapis.com`) 재정의. |
| `CLAUDE_PLUGIN_ROOT` | 호스트 설정 | Claude Code가 설정. hook 바이너리 위치 파악 및 `simulate_hook_invocation`에 사용. |

## 호스트 간 상태 공유

로컬 스텝업 상태는 `~/.transcodes/state/` 아래에 있으며, 설계상 **모든 transcodes-guard 플러그인이 공유**합니다 — 모든 호스트가 동일한 Transcodes 백엔드와 통신하므로 한 호스트에서 verified 된 세션이 다른 호스트로 이어집니다. 동시 사용이 지원되며, 같은 순간에 verified 레코드를 두고 벌어지는 경쟁은 알려진 한계로, 백엔드의 sid-replay 보호가 권위 있는 백스톱입니다.

## 알려진 한계

- Bash 매칭은 셸 따옴표를 인식하지 않고 전체 명령 문자열을 대상으로 하므로, 특이한 따옴표 사용이 오탐(false positive)을 유발할 수 있습니다. 또한 패턴이 다루지 않는 동등 명령으로 정규식 계층을 우회할 수 있습니다.
- `rm -rf` git 의미 검사는 cwd에 의존하며 git 작업 트리 밖에서는 건너뛰므로, `simulate_command`는 이에 대한 완전한 oracle이 아닙니다 — 전체 충실도 검사는 `simulate_hook_invocation`을 사용하세요.

## 라이선스

FSL-1.1-ALv2 (리포지토리 루트 참고).
