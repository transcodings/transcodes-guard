# ai-action-tracker-mcp

Claude Code가 실행하려는 위험한 Bash 명령을 *실행 직전에* 가로채 Transcodes **Step-up MFA** 인증을 요구하는 PreToolUse hook + MCP 서버. WebAuthn 인증을 완료한 명령만 통과합니다.

> 이 프로젝트가 답하는 질문: **"Claude Code가 `rm -rf` 같은 위험 명령을 실행하기 전에 어떻게 멈추지?"**

> 📦 **Claude Code Plugin으로 배포 중** — `/plugin install` 두 줄로 설치 끝. 아래 [빠른 시작](#-빠른-시작--plugin-설치--5분-튜토리얼) 참고.

세 가지 활용 트랙이 있고 각각 독립적으로 도입 가능합니다.

---

## 🚀 빠른 시작 — Plugin 설치 + 5분 튜토리얼

이 프로젝트는 **Claude Code plugin**으로 패키징되어 있습니다. 리포지토리 자체가 marketplace 역할을 하며, 별도 인증·호스팅 없이 GitHub만으로 배포됩니다.

### 설치 (두 줄)

Claude Code 세션 안에서:

```
/plugin marketplace add transcodings/ai-action-tracker-mcp
/plugin install ai-action-tracker@ai-action-tracker-mp
```

설치 즉시 PreToolUse hook + MCP 서버가 활성됩니다. 추가 설정 불필요.

### 5분 튜토리얼

**1단계 — 마켓플레이스 등록** *(머신당 1회)*
```
/plugin marketplace add transcodings/ai-action-tracker-mcp
```
GitHub의 `transcodings/ai-action-tracker-mcp` 리포지토리를 marketplace 카탈로그로 등록. `~/.claude`에 메타데이터만 캐시되고 plugin 본체는 아직 다운로드되지 않습니다.

**2단계 — plugin 설치**
```
/plugin install ai-action-tracker@ai-action-tracker-mp
```
plugin 본체가 `~/.claude/plugins/cache/...`로 복사되고 hook + MCP 서버가 자동 활성. `/plugin list`로 설치 상태 확인 가능.

**3단계 — 위험 명령 차단 동작 확인**

테스트용 임시 디렉터리에서 Claude에게 시켜봅니다:
> "src 폴더를 지워봐"

Claude가 `rm -rf src`를 시도하면 hook이 즉시 가로챕니다:

```
⛔ ai-action-tracker: BLOCKED dangerous command

Reason: rm -rf would delete 3 file(s) tracked in git

Affected:
  - src — 3 tracked file(s): src/http.ts, src/server.ts, src/stdio.ts

Command: rm -rf src
```

명령은 실행되지 않고 stderr가 Claude에게 피드백되어, 모델이 "차단됐다"는 사실을 인지합니다.

**4단계 — MCP tool 호출**

같은 세션에서:
> "echo tool로 'hello plugin' 보내봐"

→ Claude가 `echo` MCP tool을 호출하고 `Echo: hello plugin` 응답을 받습니다. `danger-patterns://list` 리소스(현재 차단 패턴 목록), `greeting` 프롬프트도 동일하게 사용 가능.

**5단계 — 비활성화 / 제거**

```
/plugin disable ai-action-tracker      # 일시 비활성화
/plugin uninstall ai-action-tracker@ai-action-tracker-mp   # 완전 제거
```

### 팀 단위 자동 설치

프로젝트 `.claude/settings.json`에 다음을 커밋하면 팀원이 클론할 때 자동 등록됩니다:

```json
{
  "extraKnownMarketplaces": [
    { "source": "github", "repo": "transcodings/ai-action-tracker-mcp" }
  ],
  "enabledPlugins": ["ai-action-tracker@ai-action-tracker-mp"]
}
```

### Plugin을 사용하지 않는 경우 (수동 설치)

plugin 시스템 없이 hook만 직접 등록하려면 [`docs/hook-installation.md`](./docs/hook-installation.md) 참고. plugin 변환의 설계 근거는 [`docs/research/claude-code-plugin-marketplace-strategy.md`](./docs/research/claude-code-plugin-marketplace-strategy.md).

---

## 트랙 A. Claude Code를 더 안전하게 (⭐ 메인 기능)

PreToolUse hook을 등록하면 위험 Bash 명령이 *실행 직전에* 차단됩니다. `--dangerously-skip-permissions` 모드에서도 작동.

### 차단되는 명령 (8개 정규식 패턴 + git tracked 의미 분석)

| 종류 | 차단 예시 |
|------|----------|
| 절대경로/HOME 재귀 삭제 | `rm -rf /etc`, `rm -rf ~/Documents`, `rm -rf $HOME/data` |
| Bare glob 재귀 삭제 | `rm -rf *` |
| 디스크 직접 쓰기 | `dd if=/dev/zero of=/dev/sda` |
| 파일시스템 생성 | `mkfs.ext4 /dev/sdz` |
| 원격 스크립트 셸 실행 | `curl https://... \| bash`, `wget ... \| sh` |
| Fork bomb | `:(){ :\|:& };:` |
| 절대경로 재귀 chmod | `chmod -R 777 ~/.ssh` |
| 보호 브랜치 force push | `git push --force origin main` |
| **Git tracked 파일 재귀 삭제** | `rm -rf src` (의미 분석으로 차단 — 정규식엔 안 걸림) |

### Step-up MFA 게이트

위험 명령이 매칭되면 hook은 즉시 거부하지 않고 Transcodes 백엔드에 step-up 세션을 만든 다음 stderr에 인증 URL을 출력하고 60초간 폴링합니다:

```
🔐 ai-action-tracker: Step-up MFA required to run this command.

Reason : rm -rf would delete 3 file(s) tracked in git
Command: rm -rf src

Open in your browser to authenticate:
  https://api.transcodesapis.com/.../session/mcpup_...

Waiting up to 60s for verification...
```

브라우저에서 WebAuthn(passkey)을 완료하면 hook이 그 명령을 통과시킵니다. 인증을 안 하면 60초 후 기존처럼 BLOCKED. **검증은 1회용** — 다음 위험 명령에는 또 새 MFA가 요구됩니다.

필요 환경변수:

| 변수 | 필수 | 기본값 |
|------|------|--------|
| `TRANSCODES_TOKEN` | ✅ | Member MCP JWT. 미설정 시 hook은 기존처럼 즉시 BLOCKED (fail-safe). |
| `TRANSCODES_BACKEND_URL` | – | `https://api.transcodesapis.com` |

같은 흐름을 MCP tool로도 호출할 수 있습니다 — `create_stepup_session` / `poll_stepup_session`. Claude가 사전에 한 번 MFA를 통과시켜두는 워크플로우가 가능합니다.

### 차단 시 보이는 메시지

```
⛔ ai-action-tracker: BLOCKED dangerous command

Reason: rm -rf would delete 3 file(s) tracked in git

Affected:
  - src — 3 tracked file(s): src/http.ts, src/server.ts, src/stdio.ts

Command: rm -rf src
```

정규식 차단 시:
```
⛔ ai-action-tracker: BLOCKED dangerous command

Reason: matched pattern `dd-disk` — Direct write to block device

Command: dd if=/dev/zero of=/dev/sda
```

### 설치

권장: 위 [빠른 시작](#-빠른-시작--plugin-설치--5분-튜토리얼)의 plugin 설치(두 줄). 수동 hook 등록은 [`docs/hook-installation.md`](./docs/hook-installation.md).

### Hook 두 단계 검사

```
모델이 Bash 호출
    ↓
1차: 정규식 패턴 (hooks/danger-patterns.json)
    ↓ 매칭 안 됨
2차: rm -rf 의미 분석 (cwd 기준 절대경로 + git ls-files)
    ↓ 둘 다 통과
명령 실행 허용
```

- **1차 (regex)**: `rm -rf /`, `dd`, `curl|bash` 등 *형태가 명백히 위험*한 명령. 빠르고 결정적.
- **2차 (semantic)**: `rm -rf src` 같은 상대경로를 cwd 기준 절대경로로 정규화 후 git이 추적하는 파일이 포함되면 차단. 정규식이 못 잡는 사각지대 보강.

### 패턴 커스터마이징 (재빌드 불필요)

`plugins/ai-action-tracker/hooks/danger-patterns.json`을 직접 편집하면 즉시 반영됩니다 (런타임에 매번 read). plugin dist에도 반영하려면 `npm run build:plugin` 실행.

```json
{
  "patterns": [
    {
      "id": "no-sudo",
      "regex": "\\bsudo\\b",
      "reason": "sudo invocation requires manual review"
    }
  ]
}
```

### 알려진 한계

- Shell quoting 미인식 — `echo "rm -rf /"` 같은 *문자열 안 패턴*도 차단됨(false positive 가능).
- 정규식 우회(quote 분할, 변수 치환) 일부 가능 — 1차 방어선 한계.
- 비-git 디렉터리에서는 의미 분석 skip.

---

## 트랙 B. MCP 서버 즉시 체험

Plugin을 설치하지 않고 dev 모드로 MCP 서버를 띄우려면 다음 두 명령으로 충분합니다.

```bash
git clone <repo>
cd ai-action-tracker
npm install              # workspaces hoist
npm run dev:stdio        # tsx 핫리로드 — Inspector/외부 클라이언트가 stdio로 직접 접속
```

또는 컴파일된 dist를 직접 MCP 클라이언트에 등록:

```bash
npm run build:plugin
claude mcp add ai-action-tracker -- node plugins/ai-action-tracker/dist/src/stdio.js
```

세션에서 호출 가능한 capability:

| 종류 | 이름 | 설명 |
|------|------|------|
| Tool | `echo` | 입력 메시지를 그대로 돌려줌 (placeholder) |
| Tool | `create_stepup_session` | Transcodes step-up 세션 시작 (TRANSCODES_TOKEN 필요) |
| Tool | `poll_stepup_session` | step-up 세션 상태 확인 — verified 시 cross-platform 캐시에 기록 |
| Resource | `danger-patterns://list` | 현재 차단 패턴 8개를 markdown 표로 반환 (`hooks/danger-patterns.json` 런타임 read) |
| Prompt | `greeting` | `name`을 받아 인사 템플릿 생성 |

> **참고**: `echo` tool과 `greeting` prompt는 아직 placeholder입니다. `danger-patterns://list` resource는 hook 정책을 그대로 노출하는 첫 "진짜" capability. 향후 secrets 검사·MCP 서버 위험 프로파일 같은 보안 advisory tool들이 추가될 예정 — [`docs/prd/`](./docs/prd/) 참고.

### 브라우저 UI로 직접 호출 (Inspector)

```bash
npm run inspect
```

MCP Inspector가 떠서 도구·리소스·프롬프트를 폼으로 호출해볼 수 있습니다.

### 다른 위치에서 등록 (전역 / 데스크톱)

`.mcp.json` 외에도 다음 방식으로 등록 가능:

**Claude Code CLI 전역 등록:**
```bash
claude mcp add --transport stdio ai-action-tracker -- node /ABS/PATH/plugins/ai-action-tracker/dist/src/stdio.js
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ai-action-tracker": {
      "command": "node",
      "args": ["/ABS/PATH/plugins/ai-action-tracker/dist/src/stdio.js"]
    }
  }
}
```

**원격 Streamable HTTP** (배포 후):
```bash
claude mcp add --transport http ai-action-tracker https://your-host.example.com/mcp
```

---

## 트랙 C. 자신만의 도구 추가하기

이 리포지토리는 transport-agnostic MCP 서버 스캐폴드를 제공합니다 — 모든 capability(tool/resource/prompt)는 `plugins/ai-action-tracker/src/server.ts` 한 파일에서 관리되며, stdio·HTTP 양쪽으로 동시에 노출됩니다.

step-by-step 가이드: [`docs/adding-capabilities.md`](./docs/adding-capabilities.md)

설계 의도(왜 transport 분리, 왜 Streamable HTTP, 인증 미비점): [`docs/architecture.md`](./docs/architecture.md)

---

## 실행 명령 cheat sheet

루트에서 모든 명령 실행 가능. `build:*`는 Turborepo, `dev:*`/`inspect`는 npm workspaces로 dispatch.

```bash
npm install            # workspaces hoist (루트에서 한 번)
npm run build          # turbo run build → plugins/ai-action-tracker/dist/
npm run build:plugin   # turbo run build:plugin (danger-patterns.json 동기화 포함)

# MCP 서버 (stdio, 로컬)
npm run dev:stdio      # tsx로 즉시 실행
npm -w plugins/ai-action-tracker run start:stdio   # 빌드된 산출물

# MCP 서버 (Streamable HTTP, 원격)
npm run dev:http       # localhost:3000/mcp

# Hook (단발 실행 — stdin JSON 필요)
npm run dev:hook       # 개발용

# Inspector (디버그 UI)
npm run inspect
```

요구 사항: Node.js >= 20. CI(`.github/workflows/ci.yml`)는 `build:plugin` 후 `git diff --exit-code plugins/ai-action-tracker/dist/`로 dist 동기성 + hook smoke test로 정합성을 검증.

---

## 디렉터리 구조

```
/                            # 루트 = marketplace + monorepo orchestrator
  .claude-plugin/
    marketplace.json         #   Marketplace 카탈로그 — 이 리포가 곧 marketplace
  package.json               #   private. workspaces + turbo orchestrator
  turbo.json                 #   task pipeline (build, build:plugin)
  .github/workflows/ci.yml   #   build sync + hook smoke test
plugins/
  ai-action-tracker/         # 배포 단위 plugin 패키지 — 단일 진실원천
    .claude-plugin/plugin.json   # plugin 매니페스트
    .mcp.json                #   MCP 서버 등록 (${CLAUDE_PLUGIN_ROOT})
    package.json             #   진짜 npm metadata (name, main, bin, files, deps)
    tsconfig.json            #   tsc rootDir = plugin root
    src/                     #   MCP 서버 소스 (transport-agnostic)
      server.ts              #     createServer() — 모든 capability 정의처
      stdio.ts               #     로컬 진입점
      http.ts                #     원격 진입점 (단일 /mcp, stateless)
    hooks/                   #   PreToolUse hook 소스
      hooks.json             #     PreToolUse Bash matcher
      pre-tool-use.ts        #     진입점 (regex + git semantic 두 단계 검사)
      danger-patterns.json   #     차단 정규식 (8개)
    dist/                    #   빌드 산출물 (git 커밋 — npm install 불필요)
    README.md                #   plugin 단독 사용자 문서
docs/
  architecture.md            #   설계 의도 (트랜스포트·인증·자기검증)
  adding-capabilities.md     #   새 tool/resource/prompt 추가 절차
  hook-installation.md       #   plugin 미사용 시 수동 hook 등록 가이드
  research/
    claude-code-plugin-marketplace-strategy.md   # plugin 변환 전략·근거
    ai-security-mcp-competitive-landscape.md
    mcp-server-creation-and-deployment.md
  prd/                       #   향후 기능 PRD (4건)
```

---

## 로드맵 — PRD 4건

[`docs/prd/`](./docs/prd/)에 다음 4개 부가 기능 PRD가 작성돼 있습니다 (의존 그래프와 우선순위 포함):

| ID | 기능 | 위치 | 우선순위 / 노력 |
|----|------|------|----------------|
| [0001](./docs/prd/0001-audit-emit.md) | `audit-emit` — JSON-Lines 감사 로그 emit | PostToolUse hook 신설 | P1 / M |
| [0002](./docs/prd/0002-secrets-redact.md) | `secrets-redact` — AWS key·JWT·PEM 등 secret 차단 | PreToolUse hook 확장 | P1 / S |
| [0003](./docs/prd/0003-file-change-delta.md) | `file-change-delta` — 예측 vs 실제 변경 비교 | PostToolUse hook | P1 / S |
| [0004](./docs/prd/0004-policy-yaml.md) | `policy-yaml` — 정책 YAML 통합 + 시한부 override | PreToolUse hook | P2 / M |

작성 배경(경쟁 환경 분석): [`docs/research/ai-security-mcp-competitive-landscape.md`](./docs/research/ai-security-mcp-competitive-landscape.md)

---

## 배포

원격 Streamable HTTP 서버를 외부에 노출하려면 인증을 먼저 추가해야 합니다 (현재 스캐폴드 미포함).

플랫폼 비교 + 셋업 가이드: [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md)

빠른 옵션:
- **Cloudflare Workers** — `McpAgent` + Durable Objects가 OAuth·세션 자동 처리.
- **Google Cloud Run** — `gcloud run deploy --source .` (Dockerfile 별도 작성 필요).
- 그 외 AWS ECS Fargate / Vercel / Fly.io / Render — 리서치 리포트 4번 섹션 참고.

---

## 주의 사항

- **stdio 모드에서 `console.log`/`stdout` 쓰기 금지.** JSON-RPC 프레임이 손상돼 클라이언트가 silently 끊깁니다. 로깅은 모두 `console.error`(stderr) 사용.
- **원격 배포 시 인증 필요.** `src/http.ts`에는 인증이 없습니다 — 프로덕션 전 OAuth 2.1 또는 Bearer 토큰 추가 필수.
- **Hook fail-policy는 비대칭**: 위험 패턴 *매칭 전*(JSON 파싱, 패턴 파일 부재)은 fail-open(exit 0)으로 사용자 워크플로를 보호. 위험 패턴 *매칭 후*의 step-up 단계 오류(백엔드 다운, 타임아웃 등)는 fail-safe(exit 2)로 차단 — 인증을 증명하지 못하면 절대 통과시키지 않습니다.
- **Hook 종료 코드**: `0` 허용 / `2` 차단(stderr가 Claude에게 피드백). `1`은 차단되지 않음 — 정책 강제용으로 쓰지 말 것.

---

## 참고

- Claude Code 공식 hooks 문서 — <https://code.claude.com/docs/en/hooks>
- MCP 공식 빌드 가이드 — <https://modelcontextprotocol.io/docs/develop/build-server>
- MCP 사양 (Streamable HTTP, 2025-03-26) — <https://modelcontextprotocol.io/specification/2025-03-26>

## 라이선스

MIT (필요 시 추가).
