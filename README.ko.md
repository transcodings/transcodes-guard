# transcodes-guard

[English](./README.md) | **한국어**

## 소개

`transcodes-guard`는 AI 코딩 에이전트가 실행하려는 위험한 셸 명령(그리고 보호 대상 MCP tool 호출)을 *실행 직전에* 가로채, Transcodes 백엔드에 대해 Transcodes Step-up MFA(WebAuthn) 인증을 강제하는 PreToolUse hook + MCP 서버 게이트입니다. 인증을 통과한 명령만 실행됩니다.

하나의 git 저장소에 하나의 공유 코어(npm workspaces)를 두고, 네 개의 호스트 플러그인(Claude Code, Codex, Cursor, Antigravity)을 각 호스트의 네이티브 방식으로 설치합니다. 플러그인은 npm으로 배포되지 않으며, `transcodes` CLI만 npm으로 배포됩니다. 저장소, 제품, 플러그인 모두 `transcodes-guard`라는 이름을 씁니다.

모든 호스트에서 Node.js >= 20이 필요합니다.

## 설치

### Claude Code

Claude Code가 기본 호스트입니다. 이 저장소가 곧 마켓플레이스이므로, Claude Code 세션에서 다음 두 줄만 실행하면 됩니다.

```
/plugin marketplace add transcodings/transcodes-guard
/plugin install transcodes-guard@bigstrider
```

`dist/`가 커밋되어 있어 클론한 상태에서 바로 설치됩니다(빌드 단계 불필요). 비활성화는 네이티브 명령 `/plugin disable transcodes-guard`로 합니다.

팀 단위 자동 등록은 프로젝트의 `.claude/settings.json`에 다음을 추가하세요.

```json
{
  "extraKnownMarketplaces": [{ "source": "github", "repo": "transcodings/transcodes-guard" }],
  "enabledPlugins": ["transcodes-guard@bigstrider"]
}
```

### Codex

사전 요구사항: 플러그인 + hooks를 지원하는 Codex CLI 빌드(`codex plugin --help`가 동작해야 함), Node >= 20.

**1단계 — Codex 마켓플레이스로 설치.** 저장소는 `./plugins/codex`를 가리키는 Codex 카탈로그인 `.agents/plugins/marketplace.json`을 제공합니다. `codex plugin marketplace add`는 GitHub 저장소를 직접 받습니다(Codex가 알아서 클론). `dist/`가 커밋돼 있어 수동 클론·빌드가 필요 없습니다.

```bash
codex plugin marketplace add transcodings/transcodes-guard   # "bigstrider" 마켓플레이스 등록
codex plugin add transcodes-guard@bigstrider                 # 플러그인 설치
# 또는 Codex에서 /plugins → bigstrider 마켓플레이스의 "transcodes-guard" 설치
```

Codex는 legacy `.claude-plugin/marketplace.json`보다 `.agents/plugins/marketplace.json`을 **우선** 해석하므로, 항상 Claude용이 아닌 Codex 플러그인(`./plugins/codex`)을 설치합니다. 재현 가능한 설치가 필요하면 GitHub 릴리스에서 원하는 태그를 골라 `--ref`로 넘기세요. 위의 기본 명령은 고정 없이 현재 마켓플레이스 소스를 따라갑니다.

**2단계 — 최초 실행.** Codex가 일회성 hook 신뢰 검토(trust review)를 띄웁니다(`/hooks`로 확인). 한 번 승인하세요. `--dangerously-bypass-hook-trust`는 사용하지 **마세요**.

**3단계 — 토큰 저장**(멤버 MCP JWT). 권장: `npm install -g @bigstrider/transcodes-cli` 후 `transcodes`를 실행하면 로컬 대시보드가 열립니다(터미널에 URL 출력, 기본 포트 3847) — 거기에 토큰을 붙여넣으세요(`~/.transcodes/config.json`에 저장되어 모든 세션이 읽음). 비대화형: `transcodes set <token> -l <label>`. 토큰이 없으면 hook은 위험 명령을 여전히 DENY 하지만 step-up 세션은 열지 못합니다.

### Antigravity (Beta Version)

> Antigravity 플러그인 지원은 **베타** 중입니다 — 설치 방법과 API가 바뀔 수 있습니다.

사전 요구사항: **Node >= 20**, **Google Antigravity 2.0**(데스크톱 앱 또는 `agy` CLI). CLI가 없으면 먼저 설치하세요:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

그다음 **한 줄**이면 됩니다 — `cd` 불필요, `npm install`·빌드 불필요(`dist/`는 커밋됨):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/antigravity/install.mjs && rm -rf /tmp/tg-install
```

번들 인스톨러는 Antigravity 플러그인을 `~/.gemini/config/plugins/transcodes-guard`에 복사합니다(CLI v1.0 이후 데스크톱 앱과 `agy` CLI가 공유). `hooks.json` / `mcp_config.json`의 `__PLUGIN_DIR__` 플레이스홀더를 그 디렉터리의 절대 경로로 치환합니다. Antigravity는 플러그인 루트 경로 변수를 제공하지 않으므로 설치 시점에 절대 경로를 주입해야 합니다.

업데이트도 같은 한 줄을 다시 실행하면 기존 설치 위에 덮어씁니다.

토큰도 저장하세요 — 권장: `npm install -g @bigstrider/transcodes-cli` 후 `transcodes`(대시보드). 비대화형: `transcodes set <token> -l <label>`.

> **`agy plugin install https://github.com/transcodings/transcodes-guard`는 사용하지 마세요.** 이 명령은 저장소를 bulk 멀티플러그인 카탈로그로 보고 Antigravity용뿐 아니라 Claude Code 어댑터까지 함께 설치합니다(와이어 포맷 불일치). `__PLUGIN_DIR__` 경로 치환도 건너뛰어 hook/MCP가 런타임에 실패합니다. 위 한 줄 명령을 사용하세요.
>
> **기여자 / 워크스페이스 전용:** 저장소를 클론한 뒤 `node plugins/antigravity/install.mjs --local` (`<cwd>/.agents/plugins/transcodes-guard`에 복사).

> 참고: Antigravity의 PreToolUse matcher는 `run_command|mcp_.*|call_mcp_tool`로, 셸 실행 **및** MCP tool 호출을 게이트합니다 — Antigravity가 범용 `call_mcp_tool` 래퍼로 dispatch하는 lazy-loaded 호출까지 포함합니다(어댑터가 `args.ToolName`에서 실제 tool 이름을 언래핑). 파일 편집 도구(`write_to_file` 등)는 게이트되지 않습니다.

### Cursor (Beta Version)

> Cursor 플러그인 지원은 **베타** 중입니다 — 설치 방법과 API가 바뀔 수 있습니다.

사전 요구사항: **Node >= 20**, Hooks가 켜진 Cursor **데스크톱**(Settings → Hooks). 클라우드 에이전트는 2026-05 기준 미연동.

**1단계 — Cursor Agent CLI(`cursor-agent`) 설치:**

```bash
curl https://cursor.com/install -fsS | bash
```

**2단계 — Marketplace에서 설치.** `cursor-agent` CLI(또는 Cursor → Customize → Plugins → **Marketplace**)에서 **Plugins → Marketplace**를 연 뒤 아래 URL을 붙여넣습니다:

```
https://github.com/transcodings/transcodes-guard
```

**Transcodes (bigstrider)** 를 선택하고 **Install**:

![Cursor Marketplace에서 transcodes-guard 설치 — GitHub repo URL 붙여넣기](./docs/images/cursor-marketplace-install.png)

`.cursor-plugin/marketplace.json`이 `plugins/cursor`를 가리킵니다. `dist/`는 커밋돼 있어 clone·빌드가 필요 없고, hook과 MCP 서버는 `${CURSOR_PLUGIN_ROOT}`로 자동 연결됩니다.

**3단계 — 첫 실행.** 일회성 hook 신뢰 검토를 승인합니다(커맨드 팔레트 → **Cursor: Review Hooks**).

**4단계 — 토큰 저장.** 권장: `npm install -g @bigstrider/transcodes-cli` 후 `transcodes`(대시보드). 비대화형: `transcodes set <token> -l <label>`.

**업데이트**는 Marketplace에서 재설치(또는 Customize → Plugins에서 업데이트) 후 **Developer: Reload Window**.

## CLI 설치

`@bigstrider/transcodes-cli`(bin: `transcodes`)는 사람이 다루는 컨트롤 플레인입니다. hooks와 MCP 서버가 읽는 멤버 토큰을 저장하고 `~/.transcodes/`를 소유하며, 플러그인이 아닌 토큰·대시보드 도구이므로 플러그인과 달리 npm에 **배포됩니다**.

```bash
npx @bigstrider/transcodes-cli            # 설치 없이 대시보드 실행
npm install -g @bigstrider/transcodes-cli # 또는 전역 설치 → `transcodes` 명령
```

명령:

- `transcodes status` — 활성 토큰 소스 + 만료
- `transcodes tokens` — 저장된 토큰 목록
- `transcodes set <token> -l <label>` — 토큰 저장
- `transcodes` (인자 없음) — GUI 대시보드

멤버 토큰은 `~/.transcodes/config.json`에 저장되며, hooks와 MCP 서버가 공유 resolver를 통해 읽습니다. CLI에는 게이트 on/off 토글이 **없습니다** — 보호를 끄려면 호스트의 네이티브 방식으로 플러그인을 비활성화하거나 제거하세요.

## 주요 기능

### Step-up auth

핵심 게이트입니다. 흐름:

1. 에이전트가 Bash 명령(또는 보호 대상 MCP tool 호출)을 시도합니다.
2. PreToolUse hook이 danger 패턴(정규식 + `rm -rf` git-tracked 시맨틱 체크)이나 보호 대상 tool을 감지하면 → DENY 하고 WebAuthn step-up URL을 노출합니다.
3. 사용자가 브라우저에서 WebAuthn을 완료하면 → 에이전트가 MCP tool `poll_stepup_session_wait`(서버 측 long-poll)로 확인합니다.
4. 검증 레코드가 생기면, **같은 명령을 다시 실행**하면 hook을 통과합니다. 단발성(single-shot)이라, 다음 danger 명령은 다시 인증을 요구합니다.

**비대칭 fail 정책**(보안의 핵심): danger 매치 *이전* 단계(stdin 파싱, 분류, 패턴 로드)에서는 FAIL-OPEN — 크래시가 안전한 명령을 막는 일은 없습니다. danger 매치 *이후*에는 FAIL-SAFE — 크래시가 위험한 명령을 조용히 허용하는 일은 없습니다. 차단은 fail-safe입니다.

진단용 MCP tools:

- `inspect_stepup_state` — `age_ms` / `expired` / `ttl_ms`를 담은 읽기 전용 스냅샷.
- `simulate_command`
- `simulate_hook_invocation` — **실제** hook 바이너리를 실행합니다(드라이런이 아니며, 검증 레코드를 소모하거나 브라우저를 열 수 있습니다).

step-up이 실제로 시작되려면 토큰(멤버 MCP JWT)이 필요합니다. 권장: CLI 설치(`npm install -g @bigstrider/transcodes-cli`) 후 `transcodes`를 실행해 대시보드에서 입력하세요. 비대화형: `transcodes set <token> -l <label>`.

### tool_rules (보호 대상 MCP tools)

tool-rule 레지스트리에 대한 exact/glob `toolName` 매치가 민감한 MCP tool 호출(예: 멤버 탈퇴 처리, 역할/권한 변경, 패스코드 발급)에 step-up을 발동합니다. 두 계층:

- **SYSTEM 규칙** — Transcodes 전용 보호 대상 tool → `stepupAction` / `stepupResource` 정책 매핑으로, 정책 데이터로 함께 배포됩니다(tool 목록은 정책 표면이라 비공개로 유지). SYSTEM 규칙 id는 예약되어 있으며 덮어쓸 수 없습니다.
- **USER 규칙** — MCP tool `add_tool_rule`로 런타임에 추가합니다(백엔드 API를 통해 기록; `type:'mcp'`). 기본값은 `consume_in_hook=true`(단발성, hook에서 소모).

USER 규칙 추가에는 재빌드가 필요 없습니다.

### user_patterns (커스텀 Bash 패턴)

Bash danger 감지는 전체 명령 문자열에 대한 정규식 매치입니다. 두 계층:

- **SYSTEM 패턴** — 일반적인 위험 셸: 절대 경로 / HOME 대상 `rm -rf`, bare-glob `rm -rf`, `dd of=/dev/...`, `mkfs`, `curl ... | bash`, fork bomb, HOME 대상 재귀 `chmod`, 보호 브랜치 force-push. 빌드 시점에 임베드됩니다. 더불어 `rm -rf <상대 경로>` **시맨틱** 체크: 대상을 cwd 기준으로 해석해 git-tracked 파일을 포함하면 차단합니다(정규식이 놓치는 경우를 잡아냄).
- **USER 패턴** — MCP tool `add_user_pattern`으로 런타임에 추가합니다(백엔드 API를 통해 기록; `type:'bash'`, 정규식은 규칙의 `name`에 들어감). 로컬 `user-patterns.json` 작성 파일은 **없습니다** — 작성은 백엔드 API로만 합니다.

매칭은 컴파일된 각 정규식을 전체 명령 문자열에 대해 실행합니다(주석, 따옴표 안의 인자, heredoc 모두 매치되며, 토큰 추출은 하지 않음) — 먼저 매치된 것이 이기며, SYSTEM이 USER보다 앞섭니다.

알려진 한계(간단히): 셸 따옴표를 이해하지 못합니다(`echo "rm -rf /"`가 매치될 수 있음 → 오탐 가능). 정규식 우회가 부분적으로 가능합니다(1차 방어선임). 시맨틱 체크는 git 디렉터리가 아닌 곳에서는 생략됩니다.

## License

Functional Source License, Version 1.1, ALv2 Future License (`FSL-1.1-ALv2`) — 2년 후 Apache 2.0으로 전환됩니다. [./LICENSE.md](./LICENSE.md) 참고.
