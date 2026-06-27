# transcodes-guard — Google Antigravity 2.0 플러그인

[English](./README.md) | **한국어**

Google Antigravity 2.0용 위험 셸 인터셉터(`PreToolUse` hook) + 감사 MCP 서버. 데스크톱 앱(Antigravity 2.0)과 `agy` CLI를 지원합니다.

Claude Code 및 Codex 플러그인과 동일한 스텝업 MFA 게이트 로직(`@transcodes-guard/stepup-core`, `@transcodes-guard/mcp-server-core`)을 공유합니다. Antigravity에 특화된 부분은 Antigravity의 PreToolUse / PreInvocation / Stop 와이어 포맷(최상위 `decision`, 중첩된 `toolCall.name`/`toolCall.args` stdin, `hookSpecificOutput` 래퍼 없음)을 구사하는 네이티브 hook 어댑터(`antigravityAdapter`)입니다. codex 플러그인의 claudeCodeAdapter 위임 패턴은 여기에 **적용되지 않습니다**.

## 사전 요구사항

- **Google Antigravity 2.0** (데스크톱 앱 또는 `~/.local/bin/agy`의 `agy` CLI).
- **Node.js ≥ 20**.

## 설치

사전 요구사항: **Node.js ≥ 20**, **Google Antigravity 2.0**(데스크톱 앱 또는 `agy` CLI). CLI가 없으면:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

그다음 **한 줄** (`cd`·`npm install`·빌드 불필요 — `dist/` 커밋됨):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/antigravity/install.mjs && rm -rf /tmp/tg-install
```

`~/.gemini/config/plugins/transcodes-guard`에 복사하고 `hooks.json` / `mcp_config.json`의 `__PLUGIN_DIR__`를 절대 경로로 치환합니다. 업데이트도 같은 한 줄을 재실행하세요.

> **`agy plugin install https://github.com/transcodings/transcodes-guard` 사용 금지** — 모노레포에서 여러 호스트 플러그인을 함께 설치하고 경로 치환을 건너뜁니다.

**기여자 / 워크스페이스 전용:** 저장소 클론 후 `node plugins/antigravity/install.mjs --local`.

### 토큰 저장

MCP 서버와 스텝업 hook은 둘 다 멤버 MCP JWT로 Transcodes 백엔드에 인증합니다. **권장** — CLI 컨트롤 플레인을 한 번 설치한 뒤 대시보드에서 토큰을 입력하세요. `~/.transcodes/config.json`에 영구 저장되어 모든 에이전트 세션이 읽습니다(환경 변수 불필요, 호스트 간 유지):

```bash
npm install -g @bigstrider/transcodes-cli
transcodes   # 로컬 대시보드가 열립니다 — 터미널에 URL이 출력됩니다(기본 포트 3847, `--port N`으로 변경 가능)
```

비대화형 대안(같은 저장소): `transcodes set <token> -l <label>`.

토큰이 없으면 hook은 여전히 위험 명령을 **차단**하지만 스텝업 세션을 시작할 수 없습니다 — Antigravity가 토큰을 제공하라는 사유를 표시합니다.

## 플러그인이 하는 일

| 구성 요소 | 동작 |
|---|---|
| `PreToolUse` hook (matcher: `run_command\|mcp_.*\|call_mcp_tool`) | 셸 명령에 대해 2단계 검사(정규식 패턴 + `rm -rf`에 대한 `git ls-files` 의미 검사) + MCP 호출에 대한 정확 일치 tool-rule. 일치 시 차단하고 스텝업 MFA 흐름을 시작합니다. |
| MCP 서버 (`transcodes-guard`) | **진단 / 시뮬레이션** 도구(`inspect_stepup_state`, `simulate_hook_invocation`, `simulate_command`), **스텝업 수명주기** 도구(`create_stepup_session`, `poll_stepup_session_wait`), **Transcodes 관리** 도구(멤버 / 조직 / RBAC / 멤버십 / passcode / auth-device / 감사 / 프로젝트 관리). |
| `PreInvocation` hook | 두 가지 역할을 합니다(Antigravity에는 SessionStart / UserPromptSubmit이 없음). `invocationNum=1`일 때 정적 스텝업 MFA primer + carry-over 대기 상태를 주입합니다. 모든 invocation에서 `transcript.jsonl`의 가장 최근 사용자 메시지를 tail 하여 완료 패턴과 일치하면 대기 중인 `sid`를 노출해 에이전트가 폴링하게 합니다. |
| `Stop` hook | `{ decision: "continue", reason }`로 리마인더를 주입해 매달린 스텝업 루프를 정리합니다(Antigravity는 reason을 시스템 메시지로 삼아 실행 루프에 재진입). 상태가 깨끗하면 고아 verified/pending 레코드를 조용히 회수합니다. |
| `rules/STEPUP.md` | Antigravity가 모든 대화에 자동 로드하는 정적 스텝업 MFA 프로토콜 primer. |

## 지원 표면 (1차 출시)

- ✅ **Antigravity 2.0 데스크톱 앱** — 전역 설치 스크립트가 플러그인을 `~/.gemini/config/plugins/transcodes-guard`에 복사하고, Antigravity가 이를 자동 로드합니다.
- ✅ **Antigravity CLI (`agy`)** — 데스크톱 앱과 동일한 `~/.gemini/config/plugins/transcodes-guard` 디렉토리를 공유합니다(CLI v1.0 이후). 설치 후 `agy plugin list`에 `transcodes-guard`가 표시됩니다.
- ❌ **Gemini API의 Managed Agents** — 클라우드 호스팅이라 WebAuthn용 사용자 브라우저에 접근할 수 없습니다. 1차 출시 미지원.
- ❌ **Scheduled Tasks (`schedule` 도구)** — cron 형태 invocation에서의 hook 발동 동작이 문서화되지 않았습니다. 1차 출시 미지원.
- ❌ **Antigravity SDK (Python)** — 별도 언어·패키징 채널(`pip install google-antigravity`)로 이 모노레포 범위 밖입니다.

## 도구 matcher 범위

PreToolUse hook matcher는 `run_command|mcp_.*|call_mcp_tool`이므로 셸 실행(`run_command`) **및** MCP 도구 호출(`mcp_*`)을 게이트합니다. `call_mcp_tool` arm은 Antigravity가 범용 래퍼로 dispatch하는 lazy-loaded MCP 호출을 잡아냅니다 — 어댑터가 `args.ToolName`에서 실제 tool 이름을 언래핑해 tool-rule이 여전히 매칭되도록 합니다. 파일 편집 도구(`write_to_file`, `replace_file_content`, `multi_replace_file_content`)는 게이트되지 **않습니다**. 범위를 넓히려면 `hooks.json`의 matcher 정규식을 확장하고 `packages/danger-patterns/`에 해당 tool-rule을 등록하세요.

## AI 에이전트를 위한 안내

`PreToolUse` 차단 시 에이전트가 따라야 할 스텝업 응답 프로토콜(사용자에게 WebAuthn 완료 요청 → `sid`로 `poll_stepup_session_wait` 호출 → `verified`면 동일 호출 재시도)은 [`rules/STEPUP.md`](./rules/STEPUP.md)에 있으며, Antigravity가 에이전트 작업 컨텍스트에 자동 로드합니다(모든 플러그인의 `rules/` 디렉터리를 스캔). 런타임 루프의 단일 진실 공급원이므로 그곳에서 확인하세요.

## 활성화 / 비활성화

런타임 킬 스위치는 없습니다. 보호를 끄려면 Antigravity의 기본 메커니즘으로 플러그인을 비활성화하거나 제거하세요(`agy plugin uninstall` 등). 게이트를 켜는 것은 에이전트에게 안전하지만, 끄는 것은 사람만 할 수 있는 작업입니다.

## 환경 변수

토큰 해석: 토큰은 오직 `~/.transcodes/config.json`(`transcodes` 대시보드 또는 `transcodes set`)에서만 읽습니다.

| 변수 | 필수 여부 | 용도 |
|---|---|---|
| `TRANSCODES_BACKEND_URL` | 아니오 | 기본 백엔드(`https://api.transcodesapis.com`) 재정의. |

## 호스트 간 상태 공유

로컬 스텝업 상태는 `~/.transcodes/state/` 아래에 있으며, 설계상 **모든 transcodes-guard 플러그인이 공유**합니다 — 모든 호스트가 동일한 Transcodes 백엔드와 통신하므로 한 호스트에서 verified 된 세션이 다른 호스트로 이어집니다. 동시 사용이 지원되지만, 같은 순간에 verified 레코드를 두고 벌어지는 경쟁은 알려진 한계입니다(백엔드의 sid-replay 보호가 권위 있는 백스톱).

## 알려진 한계

- **서브에이전트 상태 공유**는 최선 노력(best-effort)입니다. 서브에이전트의 PreToolUse hook은 별개의 `conversationId`를 받을 수 있으며, 공유 상태 파일이 여전히 조정 지점이고 백엔드 sid-replay가 백스톱입니다.
- **Stop hook UX** — `decision: "continue"`(턴 종료를 막음 — Claude Code의 `decision: "block"`과 동사가 반대)는 더 넓은 e2e 검증이 진행 중입니다.

## 라이선스

FSL-1.1-ALv2 (리포지토리 루트 참고).
