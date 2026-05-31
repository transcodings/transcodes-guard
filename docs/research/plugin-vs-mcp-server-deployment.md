# Claude Code 플러그인 + MCP 서버 배포 전략 — 리서치 리포트

> 날짜: 2026-05-31 | 키워드: Claude Code plugin + MCP server 배포 전략
> 생성: /web-research (Perplexity + Brave + Tavily 멀티소스 종합)

## 한줄 요약

Claude Code 플러그인은 MCP 서버를 **번들(bundle)** 하거나 외부 발행 패키지를 **참조(reference)** 할 수 있으며, `${CLAUDE_PLUGIN_ROOT}` 상대 경로로 로컬 stdio 명령을 가리키도록 번들하면 **마켓플레이스 배포 한 번으로 MCP 서버까지 함께 배포**된다. 별도 npm publish는 "비-플러그인 MCP 클라이언트가 npx로 쓰거나, 원격 HTTP 호스팅하거나, MCP Registry 등재"하려는 경우에만 필요한 **선택 사항**이다.

## 핵심 발견사항

| # | 발견사항 | 소스 유형 | 신뢰도 |
|---|---------|----------|--------|
| 1 | 플러그인은 MCP 서버를 번들하거나 외부 패키지를 참조 가능; Claude Code는 단일 전략을 강제하지 않음 | 공식문서/기사 | 높음 |
| 2 | `.mcp.json`은 ① 번들 바이너리(`${CLAUDE_PLUGIN_ROOT}` 로컬 stdio), ② `npx @org/pkg`, ③ 원격 HTTP url 세 방식 모두 지원 | 공식문서 | 높음 |
| 3 | 플러그인 내부 경로는 프로젝트 루트가 아니라 **플러그인 캐시 위치**(`${CLAUDE_PLUGIN_ROOT}`) 기준 해석 | 공식문서/기사 | 높음 |
| 4 | "Plugins can bundle MCP servers, automatically providing tools when the plugin is enabled" — 번들 서버는 별도 발행 없이 함께 설치 | 공식문서 | 높음 |
| 5 | 코드 호스팅(npm/Docker)과 메타데이터/디스커버리(MCP Registry/마켓플레이스)는 **분리된 레이어** | 공식문서/기사 | 높음 |
| 6 | 마켓플레이스 `marketplace.json`은 git/github/npm source 타입 지원 | 공식문서 | 높음 |
| 7 | MCP Registry는 **공개** 설치 경로/원격 서버만 등재 — 사설 서버 제외 | 공식문서 | 높음 |
| 8 | 플러그인을 npm으로 *발행*하는 publisher 측 공식 가이드 부재 (미해결 이슈) | 커뮤니티 | 보통 |

## 상세 분석

### 합의점
- **플러그인 = 배포 단위, MCP 서버 = 구성요소.** 모든 소스 일치. 공식문서는 플러그인이 skills/hooks/agents/commands/**mcpServers**/lspServers를 묶는 번들임을 명시.
- **`.mcp.json`은 코드 번들이 아니라 "연결 매니페스트".** command/args/env 또는 type:http+url만 기술하고 코드 자체는 안 담음.
- **번들 서버는 마켓플레이스 배포에 무임승차.** `${CLAUDE_PLUGIN_ROOT}` 상대 command를 쓰면 코드가 플러그인 캐시에 함께 깔려 별도 발행 불필요.
- **세 등록 방식 공존.** 공식 예시 하나에 번들 바이너리와 `npx @company/mcp-server`가 같은 `.mcp.json`에 나란히 등장.

### 논쟁점 / 의견 분화
- **번들 vs 별도 발행 — "정답" 없음.** 트레이드오프이지 우열이 아님. 번들=로컬개발/통제된 롤아웃 유리, 별도 발행=버전 관리·재사용 유리. (신뢰도 보통)
- **내부(사설) 배포 경로.** 이슈 #37093: 마켓플레이스가 npm source를 *소비*하는 문서는 있으나 플러그인을 npm으로 *발행*하는 문서 부재. git source는 소비자에게 repo 자격증명을 요구. (신뢰도 보통)

### 정량 데이터
- `.mcp.json` 변수 3종: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`(=`~/.claude/plugins/data/{id}/`), `${CLAUDE_PROJECT_DIR}`.
- MCP 전송 2종: stdio(로컬 프로세스) / Streamable HTTP(원격). SSE는 레거시.

## 소스 상세

### 기사 및 문서

| # | 제목 | 유형 | 핵심 기여 |
|---|------|------|----------|
| 1 | [Connect Claude Code via MCP](https://code.claude.com/docs/en/mcp) | 공식문서 | "플러그인이 MCP 서버 번들, enable 시 자동 제공"; `${CLAUDE_PLUGIN_ROOT}` 예시 |
| 2 | [Plugins Reference](https://code.claude.com/docs/en/plugins-reference) | 공식문서 | `.mcp.json`이 번들 바이너리 + npx 패키지 동시 지원; `${CLAUDE_PLUGIN_DATA}` |
| 3 | [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) | 공식문서 | git/github/npm source 타입; mcpServers 필드 |
| 4 | [claudefa.st — Plugins Distribution](https://claudefa.st/blog/tools/mcp-extensions/plugins-distribution) | 기사 | 플러그인=배포 단위, 경로는 플러그인 캐시 기준 해석 |
| 5 | [MCP Registry — about](https://modelcontextprotocol.io/registry/about) | 공식문서 | 코드 호스팅 vs 메타데이터 레이어 분리; 공개 서버만 등재 |
| 6 | [mcpbundles — .mcpb files](https://www.mcpbundles.com/docs/concepts/mcpb-files) | 기사 | node/python/binary/uv 패키징; .mcpb 대안 포맷 |
| 7 | [FastMCP — MCP JSON Configuration](https://gofastmcp.com/integrations/mcp-json-configuration) | 기사 | `mcpServers` 포맷이 Claude/Cursor/VS Code 공통 표준 |
| 8 | [classmethod — 외부 repo 마켓플레이스 배포](https://dev.classmethod.jp/en/articles/claude-code-marketplace-source-external-repo/) | 기사 | 마켓플레이스로 skill+MCP 서버 팀 단위 일괄 배포 |

### 커뮤니티 토론

| # | 출처 | 유형 | 핵심 |
|---|------|------|------|
| 1 | [anthropics/claude-code#37093](https://github.com/anthropics/claude-code/issues/37093) | 커뮤니티 | 플러그인을 npm으로 *발행*하는 publisher 측 공식 문서 부재 — 사내 배포 수요 |

*영상: source_matrix에 6건 존재하나 모두 "MCP 서버 추가/설정" 입문 튜토리얼로, 본 주제(번들 vs 별도 발행 전략)에 직접 기여하는 영상이 없어 표 생략.*

## 미비점 및 추가 조사 필요 영역
- **publisher 측 npm 발행 가이드 부재** (이슈 #37093). 플러그인을 npm 패키지로 구조화·발행하는 공식 절차 미문서화. (보통)
- **번들 vs 별도 발행 트레이드오프의 정량 근거 약함.** 성능/유지보수 비용 데이터 없음. (낮음)
- *추출 실패 2건: medium(페이월), reddit(봇 차단) — 부차적 기술 각주로 리서치 공백 아님.*

## 전체 출처

**공식문서**
1. https://code.claude.com/docs/en/mcp
2. https://code.claude.com/docs/en/plugins-reference
3. https://code.claude.com/docs/en/plugin-marketplaces
4. https://modelcontextprotocol.io/registry/about

**기사**
5. https://claudefa.st/blog/tools/mcp-extensions/plugins-distribution
6. https://www.mcpbundles.com/docs/concepts/mcpb-files
7. https://gofastmcp.com/integrations/mcp-json-configuration
8. https://dev.classmethod.jp/en/articles/claude-code-marketplace-source-external-repo/
9. https://www.speakeasy.com/mcp/distributing-mcp-servers
10. https://www.truefoundry.com/blog/how-to-add-an-mcp-server-to-claude-code

**커뮤니티**
11. https://github.com/anthropics/claude-code/issues/37093

---

## 이 프로젝트(ai-action-tracker)에의 적용

**질문: "MCP 서버와 plugin을 각각 따로 배포해야 하는가, 하나만 배포하면 되는가?"**

**답: 하나만 배포하면 된다. `mcp-server-core`를 별도로 npm publish할 필요는 없다. (신뢰도 높음)**

1. **이 프로젝트는 정확히 "번들(bundle)" 패턴이다.** 각 플러그인의 `.mcp.json`은 서버를 `node ${CLAUDE_PLUGIN_ROOT}/dist/src/stdio.js`라는 **로컬 stdio command**로 등록한다 — 공식문서가 보여준 `${CLAUDE_PLUGIN_ROOT}` 상대 번들 바이너리 방식과 동일하다. npx도 registry도 아니다. 컴파일된 서버 `dist/`가 각 플러그인에 **커밋되어 함께 들어가므로** 서버 코드가 플러그인 페이로드의 일부다.

2. **따라서 마켓플레이스 배포 = MCP 서버 배포.** 이 repo 루트가 곧 마켓플레이스(`.claude-plugin/marketplace.json`)이고, 마켓플레이스가 플러그인을 배포하면 그 안의 `dist/`(=MCP 서버)도 같이 깔린다. `mcp-server-core`가 내부 워크스페이스 패키지로만 남고 npm에 발행되지 않는 현재 상태는 **올바르며, 별도 발행은 불필요**하다.

3. **`@bigstrider/transcodes-cli`의 별도 npm 발행은 이 질문과 무관하다.** 그것은 플러그인의 MCP 서버가 아니라 독립 실행형 토큰 관리 CLI다. CLI를 npm에 올린 것이 "MCP 서버도 따로 올려야 한다"는 신호로 오해되어선 안 된다.

4. **별도 MCP 서버 발행이 타당해질 미래 조건(현재는 선택 사항):**
   - 플러그인을 쓰지 않는 외부 MCP 클라이언트(Claude Desktop·Cursor·VS Code 등)가 `npx @org/mcp-server-core`로 직접 설치하게 하고 싶을 때 → npm 발행 + `.mcp.json`을 npx 참조로 전환.
   - 서버를 원격 HTTP(`type: http` + url)로 호스팅해 중앙 게이트웨이로 운영하고 싶을 때 (`http.ts` 스캐폴드는 존재하나 인증 미비 — 노출 전 `docs/architecture.md` 인증 섹션 선행 필요).
   - **공개** MCP Registry(`server.json`, `io.github.user/...` 네임스페이스)에 등재해 디스커버리를 노릴 때 — 단 Registry는 공개 설치 경로만 등재하므로 사설 백엔드 전제와 상충 가능.

   이 세 가지는 모두 **현재 요구가 아닌 미래 옵션**이다. 지금 구조(번들 + 마켓플레이스 단일 배포)는 4개 호스트 플러그인 시나리오에 그대로 적합하며, `mcp-server-core`를 별도 발행하면 오히려 CI가 강제하는 dist 동기화 계약(5곳 `git diff --exit-code`)과 버전 관리만 이중화된다.
