# Antigravity 2.0 e2e 검증 — 관측 결과 + 추정값

> 상태: **관측 대기**. 작성: 2026-05-26 (Asia/Seoul) | 기준 spec: `antigravity.google/docs/{hooks,plugins,mcp,subagents}` (google-dev-knowledge MCP corpus, 2.0 snapshot 검증 완료 — `multi-tool-hook-plugin-support.md` v3 참고)
>
> 이 문서는 `plugins/antigravity-ai-action-tracker/`의 구현이 공식 spec과 정합하는지 antigravity 2.0 바이너리로 실측해 봉인하는 자리다. 공식 docs가 침묵하는 4가지 unknown을 e2e로 확정하고, 가정에 깔린 fallback을 정확값으로 narrowing 한다.

## 검증해야 할 4가지 unknown

| # | Unknown | 공식 docs 침묵 부분 | 1차 출시 fallback | 정확값 (관측 대기) |
|---|---|---|---|---|
| 1 | **MCP tool naming convention** | antigravity의 MCP tool prefix 명시 없음. Gemini CLI는 `mcp_<server>_<tool>` (underscore 1개), Claude Code는 `mcp__plugin_<server>__<tool>` (underscore 2+2), Codex는 Claude Code 패턴 차용. antigravity는 셋 중 무엇인지 spec 부재. | `hooks.json` matcher에서 `run_command`만 강제. MCP tool 게이트는 1차 출시 scope 외(Q2 사용자 결정). | ⬜ 관측 후 채움 |
| 2 | **`${CLAUDE_PLUGIN_ROOT}` 등가 변수** | plugin-bundled `mcp_config.json`이 자기 디렉토리를 어떻게 참조하는지 spec 미명시. Claude Code의 `${CLAUDE_PLUGIN_ROOT}`, Codex의 `${PLUGIN_ROOT}` 같은 placeholder가 antigravity에 존재하는지 불명. | `command: "node"`, `args: ["./dist/src/stdio.js"]` 상대경로 사용 (antigravity가 plugin dir을 CWD로 spawn한다는 가정). 안 되면 install script로 절대경로 주입. | ⬜ 관측 후 채움 |
| 3 | **Subagent hook stdin의 `conversationId`** | `docs/subagents`가 "subagent inherits parent's safety configurations"는 명시하지만, plugin hook 입장에서 subagent가 spawn될 때 자기 `conversationId`로 hook을 발화하는지 부모와 같은 `conversationId`로 발화하는지 미명시. shared `~/.cache/.../stepup-pending.json` race 빈도에 직결. | README에 "subagent 시나리오는 best-effort, race 발생 시 backend sid-replay rejection이 backstop" 명시 (현행 multi-Claude race 정책 그대로 승계). | ⬜ 관측 후 채움 |
| 4 | **Stop hook `decision: "continue"` UX** | `docs/hooks`가 "Set to `'continue'` to prevent the agent from stopping and re-enter the execution loop. Any other value allows the stop"이라고만 명시. `reason` 필드가 system message로 inject되는지 vs silent 처리되는지 미명시. 우리의 reminder UX 디자인 결정 보류. | 1차 구현은 `{ decision: "continue", reason }` 시도. 관측 결과 UX가 부자연스러우면 fallback으로 빈 `{}` (silent reap)로 전환. CI smoke test에서 두 경로 모두 커버. | ⬜ 관측 후 채움 |

## 실측 절차 (PR 머지 전 1회, 결과 표 채워 commit)

### 환경 준비
1. Antigravity 2.0 desktop app 설치 (https://antigravity.google) **또는** `agy` CLI 설치 (Antigravity CLI installer).
2. 본 리포 클론 + `npm install && npm run build:plugin`.
3. plugin staging:
   - Global: `cp -r plugins/antigravity-ai-action-tracker ~/.gemini/config/plugins/ai-action-tracker`
   - **또는** Workspace: 본 리포 root에서 `.agents/plugins/ai-action-tracker` symlink.

### Probe 1 — MCP tool naming (unknown #1)
1. probe MCP 서버 등록 (plugin-bundled `mcp_config.json`이 자동 로드되는지 검증).
2. antigravity에서 probe MCP의 tool 호출 → PreToolUse hook 발화 → stdin `toolCall.name` 캡처.
3. 캡처된 이름 패턴을 표 #1에 기록. matcher regex 정확화는 follow-up commit.

### Probe 2 — `${CLAUDE_PLUGIN_ROOT}` 등가 변수 (unknown #2)
1. `mcp_config.json`의 `args`에 `./dist/src/stdio.js` 상대경로 + `${...}` 후보들(`PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, `ANTIGRAVITY_PLUGIN_ROOT`, `WORKSPACE_DIR`)을 각각 시도.
2. 어느 placeholder가 expand되는지 / 안 되면 상대경로의 CWD가 무엇인지 stderr log + 실행 성공 여부로 관측.
3. 정확한 변수명 또는 절대경로 install script 패턴을 표 #2에 기록.

### Probe 3 — Subagent hook stdin (unknown #3)
1. agent에게 `define_subagent` + `invoke_subagent`로 subagent spawn 지시.
2. subagent에서 `rm -rf /tmp/probe` 시도 → PreToolUse hook 발화 → stdin `conversationId`가 부모와 같은지 다른지 확인.
3. 같으면 우리 verified state 공유 race 없음. 다르면 race 발생 — README에 명시한 best-effort 정책 그대로 유지 (변경 없음).

### Probe 4 — Stop hook `continue` UX (unknown #4)
1. 더미 step-up pending 상태 만들고 turn 종료.
2. Stop hook이 `{ decision: "continue", reason }` 출력 → UI에 reason이 system message로 표시되는지 / agent가 turn을 재개하는지 / silent하게 종료되는지 관측.
3. 결과에 따라 본 plugin의 `hooks/stop.ts`를 (a) `continue` + `reason` 유지 또는 (b) silent 빈 `{}`로 narrow 변경.

## 관측 결과 (작성자 채움)

### #1 — MCP tool naming
- 캡처된 stdin `toolCall.name` 예시: ⬜
- 결정된 matcher regex: ⬜
- follow-up commit: ⬜

### #2 — Plugin root 변수
- 시도한 placeholder별 expand 결과: ⬜
- 1차 출시 채택안: ⬜ (상대경로 / 절대경로 install script / placeholder 명)

### #3 — Subagent conversationId
- 부모 conversationId: ⬜
- subagent conversationId: ⬜
- race 발생 여부: ⬜
- README 추가 조치 (있다면): ⬜

### #4 — Stop hook continue UX
- `reason` 표시 위치 (UI / system message / stderr): ⬜
- agent의 turn 재개 여부: ⬜
- 채택안: ⬜ (`continue` + `reason` 유지 / silent 빈 `{}`)

## 한계

- 4가지 unknown 모두 spec 부재 영역이라 antigravity가 minor release로 동작을 바꿀 수 있다. 본 관측은 _관측 시점_ 의 동작이며, antigravity changelog 모니터링이 필요하다(`agy --version` 명시 권장).
- Managed Agents in Gemini API는 cloud 환경에서 WebAuthn 브라우저 자동 오픈 불가 → 1차 출시 scope에서 명시 제외. 후속 plan에서 deferred verification 또는 Managed Agents 면제 정책 별도 설계.
- Scheduled Tasks의 hook 발화 동작도 미문서화. 1차 출시는 `schedule` tool 자체를 게이트하지 않으므로 본 plugin의 PreToolUse가 발화하지 않는 시나리오. 후속 plan에서 별도 검증.
