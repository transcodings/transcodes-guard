# ai-action-tracker-mcp

Claude Code가 실행하려는 위험한 Bash 명령을 *실행 직전에* 가로채 차단하는 PreToolUse hook + MCP 서버 스캐폴드. 향후 인증 기반 게이트로 진화 예정.

> 이 프로젝트가 답하는 질문: **"Claude Code가 `rm -rf` 같은 위험 명령을 실행하기 전에 어떻게 멈추지?"**

> 📦 **Claude Code Plugin으로 배포 중** — `/plugin install` 두 줄로 설치 끝. 아래 [빠른 시작](#-빠른-시작--plugin-설치--5분-튜토리얼) 참고.

세 가지 활용 트랙이 있고 각각 독립적으로 도입 가능합니다.

---

## 🚀 빠른 시작 — Plugin 설치 + 5분 튜토리얼

이 프로젝트는 **Claude Code plugin**으로 패키징되어 있습니다. 리포지토리 자체가 marketplace 역할을 하며, 별도 인증·호스팅 없이 GitHub만으로 배포됩니다.

### 설치 (두 줄)

Claude Code 세션 안에서:

```
/plugin marketplace add huskyhoochu/ai-action-tracker
/plugin install ai-action-tracker@ai-action-tracker-mp
```

설치 즉시 PreToolUse hook + MCP 서버가 활성됩니다. 추가 설정 불필요.

### 5분 튜토리얼

**1단계 — 마켓플레이스 등록** *(머신당 1회)*
```
/plugin marketplace add huskyhoochu/ai-action-tracker
```
GitHub의 `huskyhoochu/ai-action-tracker` 리포지토리를 marketplace 카탈로그로 등록. `~/.claude`에 메타데이터만 캐시되고 plugin 본체는 아직 다운로드되지 않습니다.

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

→ Claude가 `echo` MCP tool을 호출하고 `Echo: hello plugin` 응답을 받습니다. `hello://world` 리소스, `greeting` 프롬프트도 동일하게 사용 가능.

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
    { "source": "github", "repo": "huskyhoochu/ai-action-tracker" }
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

`hooks/danger-patterns.json`을 직접 편집하면 즉시 반영됩니다 (런타임에 매번 read).

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

리포지토리에 [`.mcp.json`](./.mcp.json)이 포함돼 있어, 클론 후 빌드만 하면 이 디렉터리에서 Claude Code 세션을 열었을 때 `ai-action-tracker` MCP 서버가 **자동 연결**됩니다.

```bash
git clone <repo>
cd ai-action-tracker
npm install && npm run build
claude   # 새 세션 시작 — MCP 서버 자동 등록
```

세션에서 호출 가능한 capability:

| 종류 | 이름 | 설명 |
|------|------|------|
| Tool | `echo` | 입력 메시지를 그대로 돌려줌 (placeholder) |
| Resource | `hello://world` | "Hello, World!" 텍스트 반환 |
| Prompt | `greeting` | `name`을 받아 인사 템플릿 생성 |

> **참고**: 현재 hello-world 수준입니다. 향후 이 자리에 secrets 검사·MCP 서버 위험 프로파일 같은 보안 advisory tool들이 추가될 예정 — [`docs/prd/`](./docs/prd/) 참고.

### 브라우저 UI로 직접 호출 (Inspector)

```bash
npm run inspect
```

MCP Inspector가 떠서 도구·리소스·프롬프트를 폼으로 호출해볼 수 있습니다.

### 다른 위치에서 등록 (전역 / 데스크톱)

`.mcp.json` 외에도 다음 방식으로 등록 가능:

**Claude Code CLI 전역 등록:**
```bash
claude mcp add --transport stdio ai-action-tracker -- node /ABS/PATH/dist/src/stdio.js
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ai-action-tracker": {
      "command": "node",
      "args": ["/ABS/PATH/dist/src/stdio.js"]
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

이 리포지토리는 transport-agnostic MCP 서버 스캐폴드를 제공합니다 — 모든 capability(tool/resource/prompt)는 `src/server.ts` 한 파일에서 관리되며, stdio·HTTP 양쪽으로 동시에 노출됩니다.

step-by-step 가이드: [`docs/adding-capabilities.md`](./docs/adding-capabilities.md)

설계 의도(왜 transport 분리, 왜 Streamable HTTP, 인증 미비점): [`docs/architecture.md`](./docs/architecture.md)

---

## 실행 명령 cheat sheet

```bash
npm install            # 의존성 설치
npm run build          # tsc → dist/
npm run build:plugin   # tsc + plugins/ai-action-tracker/dist/ 동기화 (plugin 배포 빌드)

# MCP 서버 (stdio, 로컬)
npm run dev:stdio      # tsx로 즉시 실행
npm run start:stdio    # 빌드된 산출물 실행

# MCP 서버 (Streamable HTTP, 원격)
npm run dev:http       # localhost:3000/mcp
PORT=8080 npm run start:http

# Hook (단발 실행 — stdin JSON 필요)
npm run dev:hook       # 개발용
npm run start:hook     # 빌드된 산출물

# Inspector (디버그 UI)
npm run inspect
```

요구 사항: Node.js >= 20. lint·test 스크립트는 아직 없으며 `npm run build`(tsc 통과)가 사실상 유일한 정합성 체크.

---

## 디렉터리 구조

```
.claude-plugin/
  marketplace.json           # Marketplace 카탈로그 — 이 리포가 곧 marketplace
plugins/
  ai-action-tracker/         # 배포 단위 plugin 패키지
    .claude-plugin/plugin.json
    .mcp.json                #   MCP 서버 등록 (${CLAUDE_PLUGIN_ROOT})
    hooks/
      hooks.json             #   PreToolUse Bash matcher
      danger-patterns.json   #   패턴 사본 (build:plugin 시 동기화)
    dist/                    #   빌드 산출물 (커밋 대상 — npm install 불필요)
    README.md                #   plugin 단독 사용자 문서
src/                         # MCP 서버 소스 (transport-agnostic)
  server.ts                  #   createServer() — 모든 capability 정의처
  stdio.ts                   #   로컬 진입점
  http.ts                    #   원격 진입점 (단일 /mcp, stateless)
hooks/                       # PreToolUse hook 소스 — 단일 진실원천
  pre-tool-use.ts            #   진입점 (regex + git semantic 두 단계 검사)
  danger-patterns.json       #   차단 정규식 (8개)
docs/
  architecture.md            #   설계 의도 (트랜스포트·인증·자기검증)
  adding-capabilities.md     #   새 tool/resource/prompt 추가 절차
  hook-installation.md       #   plugin 미사용 시 수동 hook 등록 가이드
  research/
    claude-code-plugin-marketplace-strategy.md   # plugin 변환 전략·근거
    ai-security-mcp-competitive-landscape.md
    mcp-server-creation-and-deployment.md
  prd/                       #   향후 기능 PRD (4건)
.mcp.json                    # 리포지토리 내 dev 테스트용 (plugin과 독립)
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
- **Hook은 fail-open**. hook 자체 버그(JSON 파싱 실패, 패턴 파일 부재)는 exit 0으로 통과 — 버그가 사용자 워크플로 전체를 막지 않습니다. 차단 결정 신뢰성보다 사용자 보호가 우선.
- **Hook 종료 코드**: `0` 허용 / `2` 차단(stderr가 Claude에게 피드백). `1`은 차단되지 않음 — 정책 강제용으로 쓰지 말 것.

---

## 참고

- Claude Code 공식 hooks 문서 — <https://code.claude.com/docs/en/hooks>
- MCP 공식 빌드 가이드 — <https://modelcontextprotocol.io/docs/develop/build-server>
- MCP 사양 (Streamable HTTP, 2025-03-26) — <https://modelcontextprotocol.io/specification/2025-03-26>

## 라이선스

MIT (필요 시 추가).
