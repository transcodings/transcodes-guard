# Claude Code Marketplace & Plugin 제작 — 리서치 + transcodes-guard 발전 전략

**작성일**: 2026-05-09 (Asia/Seoul)
**목적**: Claude Code의 plugin/marketplace 시스템을 조사하고, 본 리포지토리(`ai-action-tracker-mcp` — MCP 서버 + PreToolUse hook 스캐폴드)를 plugin/marketplace로 발전시키는 단계별 전략을 도출.

---

## TL;DR

- 본 프로젝트는 이미 **MCP 서버**(`src/server.ts`)와 **PreToolUse hook**(`hooks/pre-tool-use.ts`)을 갖추고 있어, Claude Code plugin이 정의하는 6대 component(`commands`, `agents`, `skills`, `hooks`, `mcpServers`, `monitors`) 중 2개를 즉시 plugin 자산으로 포장 가능하다. **신규 코드 거의 없이** plugin 1차 출시가 가능.
- 권장 전략은 **단일 GitHub 리포지토리 = 마켓플레이스 1개 + 플러그인 N개** 패턴이다. 1차에는 `transcodes-guard` plugin 1개로 시작 → PRD 4종(`audit-emit`, `secrets-redact`, `file-change-delta`, `policy-yaml`)이 구체화되면 플러그인을 분할하거나 sub-plugin으로 추가.
- Plugin 매니페스트의 `${CLAUDE_PLUGIN_ROOT}` 변수가 핵심이다. 설치 시 플러그인이 캐시 디렉토리로 복사되므로, 현재 `.mcp.json`의 `./dist/src/stdio.js` 같은 상대경로는 그대로 두면 깨진다. 이주 시 반드시 치환.
- 배포는 별도 인프라가 필요 없다. GitHub 리포지토리에 `.claude-plugin/marketplace.json`을 두면 `/plugin marketplace add owner/repo`로 즉시 설치 가능.

---

## 1. Claude Code Plugin 시스템 — 핵심 개념

### 1.1 Plugin이란?

Plugin은 Claude Code의 6가지 확장 자원을 묶은 **공유 가능한 패키지**다 ([공식 문서: Create plugins](https://code.claude.com/docs/en/plugins)).

| Component | 디렉토리 | 정의 파일 | 설명 |
|-----------|---------|----------|------|
| Slash commands | `commands/` | `<name>.md` (flat) | 사용자가 `/<name>` 으로 호출하는 프롬프트 템플릿 |
| Skills | `skills/` | `<name>/SKILL.md` | 모델이 자동으로 트리거하는 능력 단위 (신규 plugin은 commands보다 skills 권장) |
| Agents | `agents/` | YAML/MD | 서브에이전트 정의 (전용 컨텍스트, 도구 제한) |
| Hooks | `hooks/` | `hooks.json` + 스크립트 | `PreToolUse`, `PostToolUse` 등 수명주기 이벤트 핸들러 |
| MCP servers | `.mcp.json` | (단일 파일) | Model Context Protocol 서버 등록 |
| LSP servers | `.lsp.json` | (단일 파일) | 코드 인텔리전스용 LSP |
| Monitors | `monitors/` | `monitors.json` | 백그라운드 모니터 |
| `bin/` | `bin/` | 실행 가능 파일 | plugin 활성화 동안 PATH에 추가되는 실행 파일 |

이 중 **하나만 있어도 valid plugin**이다. 본 프로젝트는 `mcpServers` + `hooks` 두 카테고리를 이미 보유.

### 1.2 Plugin 매니페스트 (`plugin.json`)

```jsonc
// .claude-plugin/plugin.json
{
  "name": "transcodes-guard",                // kebab-case 필수
  "description": "Risky-bash interceptor + MCP audit server for Claude Code",
  "version": "0.1.0",
  "author": { "name": "bigstrider" },
  "mcpServers": {                             // .mcp.json 내용을 인라인 가능
    "transcodes-guard": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/src/stdio.js"]
    }
  },
  "hooks": {                                  // hooks/hooks.json 내용을 인라인 가능
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-tool-use.js"
      }]
    }]
  }
}
```

핵심: 모든 component는 **plugin.json에 인라인으로 선언**할 수 있고, 동시에 **별도 디렉토리 파일**(예: `hooks/hooks.json`)로도 분리 가능. 어느 쪽이 권위적인지는 `strict` 모드가 결정 (1.4 참조).

### 1.3 환경 변수 — 이주 시 핵심 함정

| 변수 | 의미 | 사용처 |
|------|------|--------|
| `${CLAUDE_PLUGIN_ROOT}` | 플러그인이 **설치된 캐시 디렉토리**의 절대경로 | `.mcp.json`, `hooks/hooks.json` 안의 모든 명령·경로 |
| `${CLAUDE_PLUGIN_DATA}` | 플러그인 업데이트 시에도 살아남는 영속 디렉토리 | 사용자 설정, 학습 모델, 로컬 캐시 |

**왜 중요한가**: `/plugin install`을 실행하면 Claude Code는 플러그인을 사용자별 캐시 위치(예: `~/.claude/plugins/cache/...`)로 복사한다. 따라서 본 프로젝트의 `.mcp.json`에 있는 `"args": ["./dist/src/stdio.js"]` 같은 **상대경로는 설치 후 깨진다**. plugin 변환 시 **반드시** `${CLAUDE_PLUGIN_ROOT}/dist/src/stdio.js`로 치환해야 한다.

### 1.4 Strict mode — 매니페스트 권위 선택

```jsonc
// marketplace.json 내 plugin entry
{ "name": "transcodes-guard", "source": "./plugins/ai-action-tracker", "strict": true }
```

- `strict: true` (권장): plugin 디렉토리의 `plugin.json`이 단일 진실원천. marketplace는 이름·source만 가리킴.
- `strict: false`: marketplace.json이 모든 component를 정의. plugin.json은 선택. 매우 작은 plugin에는 편리하지만 plugin 단독 실행/공유가 어려움.

→ transcodes-guard처럼 `mcpServers`, `hooks`를 모두 갖는 plugin은 **`strict: true`로 시작**해 plugin 디렉토리만 떼어내도 단독 설치 가능하게 유지하는 것이 표준.

---

## 2. Marketplace 시스템

### 2.1 Marketplace란?

Marketplace는 plugin들을 묶은 **카탈로그 메타데이터**다. 별도 서버나 호스팅이 필요 없으며, GitHub 리포지토리 자체가 marketplace가 된다.

```
my-marketplace/                         ← GitHub 리포지토리
├── .claude-plugin/
│   └── marketplace.json                ← 카탈로그 (필수)
└── plugins/
    ├── ai-action-tracker/              ← plugin #1
    │   ├── .claude-plugin/plugin.json
    │   ├── dist/                       ← 빌드 산출물
    │   └── ...
    └── (future-plugin)/                ← plugin #2, #3...
```

### 2.2 `marketplace.json` 스키마

```jsonc
{
  "name": "transcodes-guard",       // kebab-case, 전역 식별자
  "owner": {
    "name": "bigstrider"
  },
  "description": "AI safety & action-tracking tooling for Claude Code",
  "version": "1.0.0",
  "plugins": [
    {
      "name": "transcodes-guard",
      "source": "./plugins/ai-action-tracker",  // 모노리포 내부 상대경로
      "description": "Risky-bash interceptor + audit MCP",
      "category": "security",
      "tags": ["safety", "hook", "mcp", "audit"],
      "strict": true
    }
    // ... 추가 plugin들
  ]
}
```

### 2.3 Source 타입 3가지

| Source 형식 | 사용 케이스 |
|------------|------------|
| `"./plugins/foo"` (string) | 같은 마켓플레이스 리포 내부 plugin (모노리포) |
| `{ "source": "github", "repo": "owner/plugin-repo" }` | 외부 GitHub 리포 plugin을 큐레이션 |
| `{ "source": "git", "url": "https://gitlab.com/..." }` | GitLab 등 임의 git 호스트 |

transcodes-guard는 **모노리포 패턴**으로 시작해 추후 plugin이 늘어나면 외부 리포 큐레이션도 가능.

### 2.4 사용자 측 설치 흐름

```bash
# 1) 마켓플레이스 등록 (1회)
/plugin marketplace add transcodings/ai-action-tracker-mcp

# 2) plugin 설치
/plugin install transcodes-guard@transcodes-guard

# 3) 활성화 / 비활성화
/plugin enable transcodes-guard
/plugin disable transcodes-guard

# 4) 업데이트
/plugin marketplace update transcodes-guard
```

팀 단위 자동 설치는 `.claude/settings.json`에 다음을 추가하면 된다:

```json
{
  "extraKnownMarketplaces": [{ "source": "github", "repo": "transcodings/ai-action-tracker-mcp" }],
  "enabledPlugins": ["transcodes-guard@transcodes-guard"]
}
```

---

## 3. transcodes-guard → Plugin 이주 전략

### 3.1 현 자산 매핑

| 기존 자산 | Plugin 분류 | 이주 작업 |
|----------|------------|-----------|
| `src/server.ts` (MCP server) | `mcpServers` | `.mcp.json` 또는 `plugin.json`에 등록. 경로를 `${CLAUDE_PLUGIN_ROOT}` 기반으로 치환. |
| `hooks/pre-tool-use.ts` (PreToolUse) | `hooks` | `hooks/hooks.json` 신규 작성. matcher=`Bash`, command=`node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-tool-use.js`. |
| `hooks/danger-patterns.json` | hook 데이터 자산 | 그대로 유지. `pre-tool-use.ts`의 후보 경로 탐색이 이미 두 위치를 지원하므로 별도 수정 불필요. |
| `dist/` (tsc 산출물) | 런타임 자산 | npm publish 모델 대신 plugin은 **빌드 산출물을 git에 커밋**해야 한다 (사용자가 npm install을 돌릴 거라는 보장이 없음). 4.3 참조. |
| `docs/prd/0001-audit-emit.md` 등 4종 PRD | 미래 plugin 후보 | 각각 별개 plugin으로 분할 가능. 1차 출시에는 포함하지 않음. |
| `docs/architecture.md`, `hook-installation.md` | 사용자 문서 | plugin README로 이주 (수동 hook 설치 안내는 plugin 사용자에게 불필요). |

### 3.2 권장 디렉토리 구조 (목표 상태)

```
ai-action-tracker/                      ← GitHub 리포지토리 (현재 위치)
├── .claude-plugin/
│   └── marketplace.json                ← 신규
├── plugins/
│   └── ai-action-tracker/              ← plugin 모노리포 패턴
│       ├── .claude-plugin/
│       │   └── plugin.json             ← 신규
│       ├── .mcp.json                   ← 신규 (또는 plugin.json에 인라인)
│       ├── hooks/
│       │   ├── hooks.json              ← 신규
│       │   └── danger-patterns.json    ← 이동
│       ├── dist/                       ← 빌드 산출물 커밋
│       │   ├── src/stdio.js
│       │   └── hooks/pre-tool-use.js
│       └── README.md                   ← plugin 단독 문서
├── src/                                ← 소스 (개발용 — plugin 외부)
├── hooks/                              ← 소스 (개발용)
├── package.json                        ← 루트 빌드 스크립트
├── tsconfig.json
├── CLAUDE.md, README.md
└── docs/
```

이 배치는 **소스 = 루트, plugin 산출물 = `plugins/ai-action-tracker/`** 분리를 명시한다. 빌드 스크립트가 `dist/`를 plugin 디렉토리로 복사하는 단계를 추가하면 된다.

### 3.3 3단계 마이그레이션 플랜

각 단계는 **검증 기준**과 함께 정의 — `npm run build` 통과 + `claude --plugin-dir` 로컬 검증 + `/plugin install`로 설치 검증.

**단계 1 — 단일 plugin 골격 (반나절)**
1. `plugins/ai-action-tracker/.claude-plugin/plugin.json` 작성 (1.2 예시 그대로).
2. `plugins/ai-action-tracker/hooks/hooks.json` 작성:
   ```json
   {
     "PreToolUse": [{
       "matcher": "Bash",
       "hooks": [{
         "type": "command",
         "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-tool-use.js"
       }]
     }]
   }
   ```
3. `plugins/ai-action-tracker/.mcp.json` 작성 (또는 plugin.json에 인라인).
4. `package.json`에 `"build:plugin": "tsc && cp -r dist plugins/ai-action-tracker/ && cp hooks/danger-patterns.json plugins/ai-action-tracker/hooks/"` 추가.
5. **검증**: `claude --plugin-dir ./plugins/ai-action-tracker` 실행 → echo tool, hello 리소스 호출 확인. Bash로 `rm -rf src` 시도 → 차단 확인.

**단계 2 — Marketplace 추가 + 첫 릴리스 (1시간)**
1. `.claude-plugin/marketplace.json` 작성 (2.2 예시).
2. plugin 디렉토리에 README 추가 (설치 명령 1줄, 기능 요약, 라이선스).
3. `dist/`를 git에 커밋 (.gitignore에서 `plugins/ai-action-tracker/dist/`만 화이트리스트).
4. push.
5. **검증**: 다른 머신/사용자 계정에서 `/plugin marketplace add transcodings/ai-action-tracker-mcp` → `/plugin install transcodes-guard@...` → 설치 후 정상 작동.

**단계 3 — 다중 plugin으로 확장 (PRD 진척에 따라)**
- `docs/prd/0001-audit-emit.md` 구현 → `plugins/audit-emit/` 추가, marketplace.json에 entry 추가.
- 같은 패턴으로 `secrets-redact`, `file-change-delta`, `policy-yaml`을 점진적으로 등록.
- 공통 코드(MCP 서버 코어)는 npm workspace 또는 단순 심볼릭 링크로 공유.

### 3.4 트레이드오프: "단일 plugin" vs "다수 plugin"

| 선택 | 장점 | 단점 | 적합한 시점 |
|------|------|------|------------|
| 단일 plugin (`transcodes-guard` 하나에 모두 포함) | 사용자 설치 단순, 컴포넌트 간 결합 자유 | hook과 MCP를 분리 사용하려는 사용자에게 강제 결합 | 컴포넌트 수 ≤ 3, 기능이 한 도메인(보안)에 집중될 때 |
| 다수 plugin (PRD별 분리) | 사용자가 필요 plugin만 활성화, 권한 경계 명확 | marketplace.json 복잡도, 공통 코드 공유 비용 | PRD 4종이 각각 안정화되어 독립적 가치 제공 가능할 때 |

**권장**: 1차 출시는 **단일 plugin**(`transcodes-guard` = 현재의 hook + MCP). PRD가 구현되어 안정 단계에 도달할 때마다 다음 plugin으로 분리.

### 3.5 현 코드에 필요한 미세 수정

1. **`hooks/pre-tool-use.ts`의 후보 경로 탐색 로직** (file:src/hooks/pre-tool-use.ts:57-72)에 `${CLAUDE_PLUGIN_ROOT}/hooks/danger-patterns.json` 후보를 추가하거나, plugin 빌드 시 `danger-patterns.json`을 `dist/hooks/` 옆에 복사해 첫 후보가 매칭되도록 한다. 후자가 단순.
2. `src/http.ts`는 plugin에서 거의 사용되지 않으므로 plugin 매니페스트에서 제외. 별도 배포 채널(npm + Docker)로 유지.
3. `.mcp.json` (현재 `node ./dist/src/stdio.js`)은 **plugin 매니페스트가 우선시되므로 그대로 둘 수 있다** — 단, plugin 설치 사용자에게 혼동을 주지 않도록 README에 "이 `.mcp.json`은 리포지토리 내 개발 테스트용"임을 명시.

---

## 4. 배포·운영상 함정

### 4.1 빌드 산출물 정책

Claude Code plugin은 사용자에게 `npm install`을 강제하지 않는다. 따라서:

- **`dist/`를 git에 커밋해야 한다** (plugin 디렉토리 한정).
- 루트의 `.gitignore`에서 `dist/`를 무시하지 말고, plugin 경로만 화이트리스트:
  ```gitignore
  dist/
  !plugins/*/dist/
  ```
- CI에서 `npm run build:plugin` 후 변경 사항이 있으면 자동 커밋하는 GitHub Action을 추가하면 휴먼 에러 방지.

### 4.2 보안 — `commands/`가 임의 코드를 들고 옴

slash command와 hook은 **로컬 셸을 호출**한다. 마켓플레이스에서 임의 plugin을 받는 사용자는 `${CLAUDE_PLUGIN_ROOT}/...` 명령이 무엇이든 실행된다는 점을 인지해야 한다. transcodes-guard처럼 보안 도구를 자칭하는 plugin은 특히:

- 매 릴리스마다 `dist/` 산출물의 SHA256을 README에 게시.
- (선택) GitHub Releases에 sigstore 또는 cosign 서명 첨부.
- hook 로직이 **fail-open**임을 README에 명시 (CLAUDE.md에 이미 있는 정책 — plugin 사용자에게 동일하게 알려야 함).

### 4.3 호환성 — Claude Code 버전 락

plugin manifest는 현재 minimum Claude Code 버전 명시 필드를 갖는다. 이주 시 `engines` 또는 manifest의 `requires` 필드(공식 문서 확인 필요)를 사용해 사용자가 구버전에서 설치할 때 명확한 에러를 내도록 한다.

### 4.4 PreToolUse hook의 matcher 설계

현재 `hooks/pre-tool-use.ts`는 stdin payload에서 `tool_name === "Bash"`만 처리하고 그 외에는 `exit 0`로 통과한다. plugin의 `hooks.json`에서도 `matcher: "Bash"`로 한정해서 등록하면 다른 도구 호출에서 노드 프로세스를 띄우는 비용을 절약할 수 있다 — **이미 코드와 일치하므로 추가 작업 없음**.

---

## 5. 경쟁 마켓플레이스 — 벤치마크

| 마켓플레이스 | 운영주체 | 특징 | transcodes-guard가 배울 점 |
|-------------|---------|------|----------------------------|
| `anthropics/claude-plugins-official` | Anthropic | 공식 큐레이션 디렉토리. 외부 plugin 제출 가능. 품질·보안 심사. | 등재 시 독점 가시성. 단계 2 완료 후 등재 신청 고려. |
| `anthropics/claude-code` (`.claude-plugin/marketplace.json`) | Anthropic | 7개 expert skill (hook, MCP, command, agent, best practice). 자기참조 마켓플레이스. | "plugin 개발자용 plugin" 패턴 — 메타 plugin이 가능. |
| `modu-ai/cc-plugins` | Modu AI | 도메인별 plugin 모음 (Auth0, MFA, 토큰 보안, 컴플라이언스). project scope 설치 권장. | 보안 도메인 분류 — transcodes-guard도 `category: "security"` 태깅. |
| `Dev-GOM/claude-code-marketplace` | 개인 | 개발자 생산성 hook/command/agent 종합. Apache 2.0. | 단일 maintainer가 운영하는 종합 marketplace의 표준 구조 참고. |
| `paddo.dev / claude-tools` | 개인 | "Slash command → Agent → Subagent → External CLI" 패턴. **MCP를 일부러 쓰지 않음** (CLI/스크립트 통합만). | 모든 통합이 MCP일 필요 없음 — Bash 호출 + agent 조합도 강력. |

---

## 6. 영상·인터랙티브 자료

| 제목 | URL | 활용 |
|------|-----|------|
| How to use Plugins in Claude Code (튜토리얼) | https://www.youtube.com/watch?v=c_VFCuiOqds | plugin 시스템 개요 |
| Agentic Dev #1: Setting Up a Claude Code Plugin Marketplace | https://www.youtube.com/watch?v=xlnsWvk3D4A | marketplace 구축 시연 |
| You Need a Private Claude Plugin Marketplace (Cowork) | https://www.youtube.com/watch?v=P7TCL9kNmEE | 프라이빗(팀) 마켓플레이스 |

---

## 7. 즉시 실행 가능한 다음 단계 (체크리스트)

- [ ] `plugins/ai-action-tracker/.claude-plugin/plugin.json` 생성 (예시: §1.2)
- [ ] `plugins/ai-action-tracker/hooks/hooks.json` 생성 (예시: §3.3)
- [ ] `package.json`에 `build:plugin` 스크립트 추가 (`tsc` 후 산출물 복사)
- [ ] `claude --plugin-dir ./plugins/ai-action-tracker`로 로컬 검증 (echo tool 호출 + Bash 차단 시나리오)
- [ ] `.gitignore` 수정 — plugin dist 화이트리스트
- [ ] `.claude-plugin/marketplace.json` 생성 (예시: §2.2)
- [ ] plugin README 작성 (설치 명령, 기능, fail-open 정책 명시)
- [ ] 다른 머신에서 `/plugin marketplace add transcodings/ai-action-tracker-mcp` 검증
- [ ] (선택) `anthropics/claude-plugins-official` 디렉토리 제출 검토

---

## 8. 참고 자료

### 공식 문서
- [Plugin marketplaces — 공식 가이드](https://code.claude.com/docs/en/plugin-marketplaces)
- [Create plugins — 공식 가이드](https://code.claude.com/docs/en/plugins)
- [Discover and install prebuilt plugins](https://code.claude.com/docs/en/discover-plugins)
- [한국어 문서: 플러그인 마켓플레이스](https://code.claude.com/docs/ko/plugin-marketplaces)
- [한국어 문서: 플러그인](https://code.claude.com/docs/ko/plugins)

### 튜토리얼·블로그
- [DataCamp: How to Build Claude Code Plugins](https://www.datacamp.com/tutorial/how-to-build-claude-code-plugins)
- [daleseo.com: Claude Code 플러그인 마켓플레이스](https://daleseo.com/claude-code-plugin-marketplaces/)
- [paddo.dev: claude-tools 마켓플레이스 사례](https://paddo.dev/blog/claude-tools-plugin-marketplace/)

### 레퍼런스 리포지토리
- [anthropics/claude-plugins-official — 공식 디렉토리](https://github.com/anthropics/claude-plugins-official)
- [anthropics/claude-code 의 marketplace.json](https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json)
- [ivan-magda/claude-code-plugin-template — 스타터 템플릿 + CI](https://github.com/ivan-magda/claude-code-plugin-template)
- [modu-ai/cc-plugins — 보안 도메인 marketplace](https://github.com/modu-ai/cc-plugins)
- [Dev-GOM/claude-code-marketplace](https://github.com/Dev-GOM/claude-code-marketplace)

### 디렉토리·검색
- [claudemarketplaces.com — plugin·MCP 디렉토리](https://claudemarketplaces.com/)
- [aitmpl.com — plugin 카탈로그](https://www.aitmpl.com/plugins/)
- [buildwithclaude.com — plugin 마켓플레이스](https://buildwithclaude.com/)

---

## 부록 A — 추출 커버리지

| 카테고리 | URL 수 | 추출 성공 | 실패 |
|----------|--------|----------|------|
| 공식 문서 | 3 | 3 | 0 |
| 한국어 블로그 | 1 | 1 | 0 |
| 영문 튜토리얼 | 1 | 1 | 0 |
| GitHub 레퍼런스 | 3 | 3 | 0 |
| Reddit (커뮤니티) | 1 | 0 | 1 (Tavily fetch 실패) |
| **합계** | **9** | **8** | **1** |

Reddit 추출 실패는 보고서 결론에 영향이 없다 — 핵심 기술 사실은 공식 문서 + 5개 외부 소스에서 일관되게 교차검증됨.
