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

사전 요구사항: 플러그인 + hooks를 지원하는 Codex CLI 빌드(`codex plugin` 하위 명령과 `codex_hooks` 기능 플래그 — `codex plugin --help`로 확인), Node >= 20.

**1단계 — hooks 기능 활성화.** `~/.codex/config.toml`에 다음을 추가합니다.

```toml
[features]
codex_hooks = true
```

이 플래그가 없으면 Codex는 플러그인의 hooks를 조용히 무시하고 게이트가 동작하지 않습니다.

**2단계 — Codex 마켓플레이스로 설치.** 저장소는 `../plugins/codex`를 가리키는 `local` 카탈로그인 `.codex-plugin/marketplace.json`을 제공합니다. 저장소를 클론하고 커밋된 `dist/`를 빌드한 뒤, 카탈로그를 등록하고 설치하세요.

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install && npm run build:plugin

codex plugin marketplace add ./.codex-plugin   # "bigstrider" 마켓플레이스 등록
codex plugin add transcodes-guard@bigstrider   # 플러그인 설치
# 또는 Codex에서 /plugins → bigstrider 마켓플레이스의 "transcodes-guard" 설치
```

**3단계 — 최초 실행.** Codex가 일회성 hook 신뢰 검토(trust review)를 띄웁니다(`/hooks`로 확인). 한 번 승인하세요. `--dangerously-bypass-hook-trust`는 사용하지 **마세요**.

**4단계 — `TRANSCODES_TOKEN`**(멤버 MCP JWT)을 export 하세요. 이 토큰이 있어야 step-up을 시작할 수 있습니다. 없으면 hook이 위험 명령을 여전히 DENY 하지만 step-up 세션은 열지 못합니다.

### Cursor

사전 요구사항: Hooks가 활성화된 Cursor 0.46+ (Settings → Hooks), PATH 상의 Node >= 20, 그리고 Cursor **데스크톱** 앱(클라우드 에이전트는 2026-05 기준 미연동).

Cursor에는 `plugin.json` 개념이 없으므로, 설치는 git clone + 빌드 + `install.sh`로 이뤄집니다. `install.sh`가 `.cursor/hooks.json`과 `.cursor/mcp.json`에 절대 경로를 기록합니다.

프로젝트 스코프(워크스페이스 단위):

```bash
git clone https://github.com/transcodings/transcodes-guard.git
cd transcodes-guard
npm install
npm run build:plugin
cd /path/to/your/project
/path/to/transcodes-guard/plugins/cursor/install.sh
```

사용자 스코프(모든 워크스페이스)는 `~/.cursor/hooks.json`과 `~/.cursor/mcp.json`을 기록합니다.

```bash
/path/to/transcodes-guard/plugins/cursor/install.sh --user
```

최초 실행 시 Cursor가 일회성 hook 신뢰 검토를 띄웁니다(커맨드 팔레트 → "Cursor: Review Hooks"). Cursor를 실행하는 셸에서도 `TRANSCODES_TOKEN`을 export 하세요.

### Antigravity

사전 요구사항: Google Antigravity 2.0 (데스크톱 앱 또는 `agy` CLI), Node >= 20.

번들된 Node 인스톨러로 설치합니다. 이 인스톨러는 플러그인을 IDE/데스크톱 플러그인 디렉터리(`~/.gemini/config/plugins/transcodes-guard`)와 CLI 디렉터리(`~/.gemini/antigravity-cli/plugins/transcodes-guard`) **양쪽 모두**에 복사하고, 복사된 `hooks.json` / `mcp_config.json` 안의 `__PLUGIN_DIR__` 플레이스홀더를 설치 디렉터리의 절대 경로로 치환합니다. (Antigravity는 플러그인 루트 경로 변수를 지원하지 않으므로, 설치 시점에 절대 경로를 주입합니다.)

저장소를 클론한 뒤:

```bash
# 전역(Desktop App / IDE + CLI):
node plugins/antigravity/install.mjs

# 워크스페이스 전용(.agents/plugins/transcodes-guard):
node plugins/antigravity/install.mjs --local
```

CLI에서 `agy plugin list`를 실행하면 `transcodes-guard`가 표시됩니다. `TRANSCODES_TOKEN`도 export 하세요.

> 참고: Antigravity의 PreToolUse matcher는 `run_command|mcp_.*`로, 셸 실행 **및** MCP tool 호출을 게이트합니다. 파일 편집 도구(`write_to_file` 등)는 게이트되지 않습니다.

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

step-up이 실제로 시작되려면 `TRANSCODES_TOKEN`(멤버 MCP JWT)이 필요합니다.

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
