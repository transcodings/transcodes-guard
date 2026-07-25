# transcodes-guard

[English](./README.md) | **한국어**

<p align="center">
  <a href="https://transcodes.io"><img src="https://img.shields.io/badge/Website-transcodes.io-7B61FF?style=flat" alt="transcodes.io" /></a>
  <a href="https://x.com/hellotranscodes"><img src="https://img.shields.io/badge/Follow-%40hellotranscodes-000000?style=flat&logo=x&logoColor=white" alt="Follow on X" /></a>
  <a href="https://discord.gg/YA4y3WdBr"><img src="https://img.shields.io/badge/Join-Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Join Discord" /></a>
  <a href="https://www.youtube.com/@hellotranscodes"><img src="https://img.shields.io/badge/Subscribe-YouTube-FF0000?style=flat&logo=youtube&logoColor=white" alt="Subscribe on YouTube" /></a>
</p>

<p align="center">
  <a href="#claude-code"><img src="https://img.shields.io/badge/supports-Claude_Code-CC785C?style=flat&logo=anthropic&logoColor=white" alt="Claude Code" /></a>
  <a href="#cursor-beta"><img src="https://img.shields.io/badge/supports-Cursor-000000?style=flat&logo=cursor&logoColor=white" alt="Cursor" /></a>
  <a href="#antigravity"><img src="https://img.shields.io/badge/supports-Antigravity-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/supports-ChatGPT-412991?style=flat&logo=openai&logoColor=white" alt="ChatGPT (Codex)" /></a>
</p>

## 소개

`transcodes-guard`는 AI 코딩 에이전트가 실행하려는 위험한 셸 명령(그리고 보호 대상 MCP tool 호출)을 *실행 직전에* 가로채, Transcodes 백엔드에 대해 Transcodes Step-up MFA(WebAuthn) 인증을 강제하는 호스트 hook + MCP 서버 게이트입니다. 인증을 통과한 명령만 실행됩니다.

하나의 git 저장소에 하나의 공유 코어(npm workspaces)를 두고, 네 개의 호스트 플러그인(Claude Code, Codex, Cursor, Antigravity)을 각 호스트의 네이티브 방식으로 설치합니다. **Claude Code, Codex, Antigravity는 정식 지원 호스트이고, Cursor는 아직 베타 버전**입니다(크래시·버그 발생 가능). 플러그인은 npm으로 배포되지 않으며, `transcodes` CLI만 npm으로 배포됩니다. 저장소, 제품, 플러그인 모두 `transcodes-guard`라는 이름을 씁니다.

모든 호스트에서 Node.js >= 20이 필요합니다.

## 설치

**순서대로** 진행하세요. 토큰이 없으면 플러그인은 위험 명령을 DENY할 수는 있지만 step-up 세션은 열지 못합니다.

### 빠른 시작 — `transcodes install` (권장)

가장 빠른 방법은 대화형 설치 마법사입니다. 플러그인 → 토큰 → 대시보드까지 한 번에 진행합니다.
이 단계에서는 Node가 없어도 됩니다. 부트스트랩 스크립트가 없으면 LTS를 설치합니다.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash && transcodes install
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install
```

이미 Node ≥ 20이 있다면 `npm install -g @bigstrider/transcodes-cli`도 됩니다.

`transcodes install`이 하는 일:

1. **사전 요구사항** — **Node.js LTS(>= 20)** 가 있는지 확인하고, 없으면 설치합니다.
2. **플랫폼 선택** — Claude Code / ChatGPT (Codex) / Cursor / Antigravity를 화살표 체크리스트로 고릅니다.
   - `↑`/`↓` 이동 · `space` 선택 · `a` 전체/해제 · `enter` 선택분 설치 · `Next Step →` 다음 · `q` 종료
   - 이미 설치된 호스트는 `[Installed ✓]`로 표시됩니다. 다시 선택하면 in-place 업데이트입니다.
   - 선택한 각 호스트에 대해 호스트 CLI(`claude` / `codex` / `cursor-agent` / `agy`)를 확인하고, 없으면 공식 원라이너로 설치한 뒤 플러그인을 설치합니다(Claude·Codex는 네이티브 CLI, Cursor·Antigravity는 임시 저장소 클론).
3. **토큰 설정** — 세 가지 선택지:
   - **Yes** — Member Access Token(MAT) + label을 붙여넣어 저장(`~/.transcodes/config.json`)
   - **No** — ENTER로 [app.transcodes.io](https://app.transcodes.io)를 열고, 프로젝트/멤버·MAT 발급 후 터미널에 다시 붙여넣기
   - **Skip — token already configured** — 이미 저장된 토큰을 쓰고 계속 진행
4. **완료** — 토큰 저장 후 CLI/데스크톱 앱을 재시작해 플러그인이 반영되게 한 다음, ENTER로 로컬 대시보드(`transcodes`)를 엽니다.

비대화형: `transcodes install --all` 또는 `transcodes install claude codex cursor antigravity`.

대시보드가 열리면 **Quick Demo**로 step-up을 바로 시험하거나, **Steps**를 펼쳐 RBAC / 패스키 / 감사 로그 / Slack·Discord webhook 안내를 따라가면 됩니다.

### 업데이트 — `transcodes update`

이미 설치된 항목을 갱신합니다(감지된 호스트 플러그인 + npm CLI):

```bash
transcodes update
```

- 설치된 플러그인을 감지한 뒤 각 호스트의 설치 경로를 다시 실행합니다(Cursor/Antigravity 원라이너·Claude·Codex 마켓플레이스 설치와 동일, in-place 업데이트).
- 이어서 `npm install -g @bigstrider/transcodes-cli@latest`를 실행합니다.

유용한 플래그: `--cli-only`, `--plugins-only`, `--all`(미감지 플랫폼까지 전부), 또는 플랫폼 지정: `transcodes update claude cursor`.

### 수동 설치

단계별로 직접 하려면 아래 §1–§3을 따르세요. 위 대화형 설치는 선택 사항입니다.

### 1. CLI 설치

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex
```

그다음 `transcodes` — 로컬 대시보드를 엽니다(기본 포트 3847; 사용 중이면 다음 빈 포트를 찾고, 구간이 모두 차면 한 번 정리 후 재시도).

이미 Node ≥ 20이 있다면: `npm install -g @bigstrider/transcodes-cli` 또는 `npx @bigstrider/transcodes-cli`.

### 2. Transcodes Console에서 프로젝트 생성 후 토큰 입력

1. [Transcodes Console](https://app.transcodes.io)에서 프로젝트를 만들고, auth cluster·멤버를 설정한 뒤 멤버 상세 페이지에서 access token(멤버 MCP JWT / MAT)을 발급합니다. 대시보드 **Getting Started**(**Quick Demo** + **Steps**)가 설치 이후 흐름을 안내합니다.
2. 대시보드 **Tokens** 탭에 토큰을 붙여넣고, 필수 label(예: `transcodes-{project}-{env}`)을 입력한 뒤 **Save**합니다. 또는 **Console** 버튼 / `transcodes console`로 로그인 후 step-up용 패스키·생체인증을 등록합니다.

토큰은 `~/.transcodes/config.json`에 저장되며 모든 호스트 플러그인이 공유합니다. 비대화형: `transcodes set <token> -l <label>`.

### 3. 플러그인 설치

#### Claude Code

Claude Code가 기본 호스트입니다. 이 저장소가 곧 마켓플레이스입니다. 터미널에서 비대화형 CLI로 설치할 수 있습니다(Claude Code 1.0.33 이상 필요).

```bash
claude plugin marketplace add transcodings/transcodes-guard
claude plugin install transcodes-guard@bigstrider --scope user
```

또는 Claude Code 세션 안에서:

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

#### Codex

사전 요구사항: 플러그인 + hooks를 지원하는 Codex CLI 빌드(`codex plugin --help`가 동작해야 함), Node >= 20. 먼저 [§1](#1-cli-설치)–[§2](#2-transcodes-console에서-프로젝트-생성-후-토큰-입력)을 완료하세요.

**1단계 — Codex 마켓플레이스로 설치.** 저장소는 `./plugins/codex`를 가리키는 Codex 카탈로그인 `.agents/plugins/marketplace.json`을 제공합니다. `codex plugin marketplace add`는 GitHub 저장소를 직접 받습니다(Codex가 알아서 클론). `dist/`가 커밋돼 있어 수동 클론·빌드가 필요 없습니다.

```bash
codex plugin marketplace add transcodings/transcodes-guard   # "bigstrider" 마켓플레이스 등록
codex plugin add transcodes-guard@bigstrider                 # 플러그인 설치
# 또는 Codex에서 /plugins → bigstrider 마켓플레이스의 "transcodes-guard" 설치
```

Codex는 legacy `.claude-plugin/marketplace.json`보다 `.agents/plugins/marketplace.json`을 **우선** 해석하므로, 항상 Claude용이 아닌 Codex 플러그인(`./plugins/codex`)을 설치합니다.

**2단계 — 최초 실행.** Codex가 일회성 hook 신뢰 검토(trust review)를 띄웁니다(`/hooks`로 확인). 한 번 승인하세요. `--dangerously-bypass-hook-trust`는 사용하지 **마세요**.

#### Antigravity

사전 요구사항: **Node >= 20**, **Google Antigravity 2.0**(데스크톱 앱 또는 `agy` CLI), 그리고 [§2](#2-transcodes-console에서-프로젝트-생성-후-토큰-입력)에서 저장한 토큰. Antigravity CLI가 없으면 먼저 설치하세요:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

그다음 **한 줄**이면 됩니다 — `cd` 불필요, `npm install`·빌드 불필요(`dist/`는 커밋됨):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/antigravity/install.mjs && rm -rf /tmp/tg-install
```

번들 인스톨러는 Antigravity 플러그인을 `~/.gemini/config/plugins/transcodes-guard`에 복사합니다(CLI v1.0 이후 데스크톱 앱과 `agy` CLI가 공유). `hooks.json` / `mcp_config.json`의 `__PLUGIN_DIR__` 플레이스홀더를 그 디렉터리의 절대 경로로 치환합니다. Antigravity는 플러그인 루트 경로 변수를 제공하지 않으므로 설치 시점에 절대 경로를 주입해야 합니다. `transcodes-guard` 플러그인 디렉터리만 갱신하며 `~/.gemini/config/plugins/`의 다른 플러그인은 유지됩니다. `~/.transcodes/`(토큰·step-up 상태·policy cache)는 **지우지 않습니다**.

같은 한 줄을 재실행하면 in-place 업데이트됩니다.

> **`agy plugin install https://github.com/transcodings/transcodes-guard`는 사용하지 마세요.** 이 명령은 저장소를 bulk 멀티플러그인 카탈로그로 보고 Antigravity용뿐 아니라 Claude Code 어댑터까지 함께 설치합니다(와이어 포맷 불일치). `__PLUGIN_DIR__` 경로 치환도 건너뛰어 hook/MCP가 런타임에 실패합니다. 위 한 줄 명령을 사용하세요.
>
> **기여자 / 워크스페이스 전용:** 저장소를 클론한 뒤 `node plugins/antigravity/install.mjs --local` (`<cwd>/.agents/plugins/transcodes-guard`에 복사).

> 참고: Antigravity의 hook matcher는 `run_command|mcp_.*|call_mcp_tool`로, 셸 실행 **및** MCP tool 호출을 게이트합니다 — Antigravity가 범용 `call_mcp_tool` 래퍼로 dispatch하는 lazy-loaded 호출까지 포함합니다(어댑터가 `args.ToolName`에서 실제 tool 이름을 언래핑). 파일 편집 도구(`write_to_file` 등)는 게이트되지 않습니다.

#### Cursor (Beta)

> ⚠️ **베타** — Cursor 플러그인은 아직 베타 버전이라 크래시나 버그가 발생할 수 있고, 설치 방법과 API가 바뀔 수 있습니다. 안정적인 사용에는 **Claude Code** 또는 **Codex** 플러그인을 권장합니다.

사전 요구사항: **Node >= 20**, Hooks가 켜진 Cursor **데스크톱**(Settings → Hooks), 그리고 [§2](#2-transcodes-console에서-프로젝트-생성-후-토큰-입력)에서 저장한 토큰. 2026-05 기준 Cloud Agent는 `beforeShellExecution` / `beforeMCPExecution` hook을 실행하지 않습니다.

**한 줄**로 설치합니다 — 수동 `cd`, `npm install`, 빌드 불필요(`dist/` 커밋됨):

```bash
git clone https://github.com/transcodings/transcodes-guard.git /tmp/tg-install && node /tmp/tg-install/plugins/cursor/install.mjs && rm -rf /tmp/tg-install
```

인스톨러는 `~/.cursor/plugins/local/transcodes-guard`에 플러그인을 복사하고, hook/MCP 설정의 `${CURSOR_PLUGIN_ROOT}`를 절대 경로로 치환한 뒤 `~/.cursor/hooks.json`에 transcodes-guard hook만 merge(다른 hook 유지)하고 `~/.cursor/mcp.json`의 `transcodes-guard` 항목만 upsert합니다(다른 MCP 서버 유지). 같은 한 줄을 재실행하면 업데이트됩니다. `~/.transcodes/`(토큰·step-up 상태·policy cache)는 **지우지 않습니다**.

**첫 실행:** 일회성 hook 신뢰 검토를 승인합니다(커맨드 팔레트 → **Cursor: Review Hooks**).

**CLI Agent 참고:** `~/.cursor/cli-config.json`에 `"approvalMode": "unrestricted"`(Run Everything)이거나 Shell/MCP가 allowlist에 미리 등록돼 있으면, Cursor가 gate hook 없이 도구를 실행할 수 있습니다. 게이트를 타게 하려면 `"approvalMode": "allowlist"`로 바꾸고 allowlist에서 해당 항목을 제거하세요.

> **기여자 / 워크스페이스 전용:** 저장소를 클론한 뒤 `node plugins/cursor/install.mjs --local` (`<cwd>/.cursor/plugins/transcodes-guard` + `<cwd>/.cursor/hooks.json`).

> **선택 — Team Marketplace:** Teams/Enterprise 관리자는 `https://github.com/transcodings/transcodes-guard`를 팀 마켓플레이스로 import해 Required/Optional로 배포할 수 있습니다. Marketplace만으로는 user-level hook이 항상 등록되지 않을 수 있으므로, 안정적인 게이트 연동을 위해 위 `install.mjs` one-liner를 함께 실행하세요.


## 주요 기능

### Step-up auth

핵심 게이트입니다. 흐름:

1. 에이전트가 Bash 명령(또는 보호 대상 MCP tool 호출)을 시도합니다.
2. 게이트 hook이 danger 패턴(정규식 + `rm -rf` git-tracked 시맨틱 체크)이나 보호 대상 tool을 감지하면 → DENY 하고 WebAuthn step-up URL을 노출합니다.
3. 사용자가 브라우저에서 WebAuthn을 완료하면 → 에이전트가 MCP tool `poll_stepup_session_wait`(서버 측 long-poll)로 확인합니다.
4. 검증 레코드가 생기면, **같은 명령을 다시 실행**하면 hook을 통과합니다. 단발성(single-shot)이라, 다음 danger 명령은 다시 인증을 요구합니다.

**비대칭 fail 정책**(보안의 핵심): danger 매치 *이전* 단계(stdin 파싱, 분류, 패턴 로드)에서는 FAIL-OPEN — 크래시가 안전한 명령을 막는 일은 없습니다. danger 매치 *이후*에는 FAIL-SAFE — 크래시가 위험한 명령을 조용히 허용하는 일은 없습니다. 차단은 fail-safe입니다.

진단용 MCP tools:

- `inspect_stepup_state` — `age_ms` / `expired` / `ttl_ms`를 담은 읽기 전용 스냅샷.
- `simulate_command`
- `simulate_hook_invocation` — **실제** hook 바이너리를 실행합니다(드라이런이 아니며, 검증 레코드를 소모하거나 브라우저를 열 수 있습니다).

step-up이 실제로 시작되려면 토큰(멤버 MCP JWT)이 필요합니다 — 게이트를 쓰려면 먼저 [§1](#1-cli-설치)–[§2](#2-transcodes-console에서-프로젝트-생성-후-토큰-입력)을 완료하세요.

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

## 커뮤니티 & 지원

- **Discord:** 문의·지원은 **[Discord](https://discord.gg/YA4y3WdBr)**로 연락해 주세요.
- **Twitter / X:** 문의·소식은 **[X (@hellotranscodes)](https://x.com/hellotranscodes)**로 연락해 주세요.
- **YouTube:** 튜토리얼과 공지는 **[YouTube (@hellotranscodes)](https://www.youtube.com/@hellotranscodes)**에서 확인하세요.
- **Feedback & Support:** **[GitHub Issue](https://github.com/transcodings/transcodes-guard/issues)**를 생성해 주세요.

## License

Functional Source License, Version 1.1, ALv2 Future License (`FSL-1.1-ALv2`) — 2년 후 Apache 2.0으로 전환됩니다. [./LICENSE.md](./LICENSE.md) 참고.
