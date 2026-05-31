# MCP 서버 / Claude Code 플러그인의 장기 상태 유지 패턴 — 리서치 리포트

**조사일:** 2026-05-29 (KST)
**조사 도구:** Perplexity (high context) + Brave Search + Tavily extract (8 articles + 1 community)

---

## TL;DR

가장 보편적인 패턴은 **"홈 디렉토리 하위 + 임베디드 DB(SQLite/libSQL/Chroma) + 로컬 JSON/Markdown 보조"** 조합이다. 비율로 거칠게 잡으면:

| 전략 | 점유율(체감) | 대표 사례 |
|---|---|---|
| **임베디드 DB (SQLite/libSQL/Chroma)** | **~55%** — 사실상 표준 | claude-mem, mcp-memory-libsql, Engram(SQLite FTS5), Chroma MCP, Anthropic SQLite MCP |
| **로컬 JSON/Markdown 파일** | ~25% — 경량 도구·인간가독성 우선 | Anthropic 공식 Memory(JSONL), Basic Memory(Markdown), 본 리포의 `user-patterns.json` |
| **자사 클라우드 동기화** | ~20% — 멀티디바이스·팀협업 한정 | mem0(cloud, MCP repo는 archived), Zep/Graphiti Cloud, Basic Memory(유료 sync 옵션) |

**핵심 결론:** "로컬 우선(local-first)이 디폴트, 클라우드는 선택적 add-on"이 2026년 현재 MCP 생태계의 컨센서스다. transcodes-guard가 채택한 `~/.claude/ai-action-tracker/user-patterns.json` 방식은 **JSON 파일 기반(25%)** 카테고리에 정확히 들어가며, 이는 메인스트림과 일치한다.

---

## 1. 세 가지 전략의 실제 사용 비교

### 전략 A: 로컬 JSON / Markdown 파일

**언제 쓰나:** 룰셋·설정·소량의 구조화 데이터, 사람이 직접 편집 가능해야 할 때.

| 사례 | 저장 위치 | 포맷 |
|---|---|---|
| **Anthropic 공식 Memory MCP** | 사용자 지정 디렉토리 | JSONL (line-delimited JSON) |
| **Basic Memory** (2.8K stars) | 로컬 디렉토리 | **Markdown 파일** — "human-readable local memory"가 셀링포인트 |
| **transcodes-guard** (본 리포) | `~/.claude/ai-action-tracker/user-patterns.json` | JSON |
| **Claude Code skills/agents** | 플러그인 디렉토리 | Markdown (`SKILL.md`) + YAML frontmatter |

**장점:** zero dependency, git diff 친화적, 사용자가 손으로 수정 가능, 디버깅 쉬움.
**한계:** 검색 속도 O(n), 동시성(파일 락 없음), 대규모 데이터 부적합.

### 전략 B: 임베디드 DB (SQLite / libSQL / Chroma)

**언제 쓰나:** 의미 검색이 필요하거나, 데이터가 수천 row 이상으로 늘어날 때.

| 사례 | DB | 특이점 |
|---|---|---|
| **claude-mem** | SQLite (+ 파일) | `~/.claude-mem` 통합 디렉토리 |
| **Engram** (2.2K stars) | SQLite FTS5 | "코딩 에이전트 세션" 특화, 풀텍스트만 |
| **mcp-memory-libsql** | libSQL (Turso 호환) | **로컬 SQLite + 클라우드 sync 옵션 동시 지원** (`embedded replicas`) |
| **Anthropic SQLite MCP** | SQLite | 레퍼런스 구현, AI에게 SQL 노출 |
| **Chroma MCP** | Chroma 벡터 DB | persistent client (디스크) / HTTP client / Chroma Cloud 3-모드 |
| **MCP 공식 가이드 stateful 예시** | `checkpoint.db` (SQLite) | LangGraph 체크포인터 패턴 |

**장점:** 단일 파일로 배포(`.db`), 트랜잭션, FTS·벡터 검색, 동시성 락 내장.
**한계:** 스키마 마이그레이션 필요, 손으로 못 본다, 의존성 추가.

**서브 패턴 — Chroma의 3-mode 디자인이 흥미롭다:**
```
ephemeral (RAM)  →  persistent (로컬 디스크)  →  HTTP/Cloud
```
하나의 클라이언트 인터페이스로 3단계 영속성을 옵션화 — 많은 MCP 서버가 이 패턴을 따라가는 추세.

### 전략 C: 자사 클라우드 동기화

**언제 쓰나:** 멀티 디바이스, 팀 공유, SaaS 제품화.

| 사례 | 백엔드 | 비고 |
|---|---|---|
| **mem0** | 자사 cloud (free tier + paid) | **MCP 레포는 archived** — cloud SDK로 통합 권장 |
| **Zep/Graphiti** | 자사 cloud OR self-hosted | $25~$475/mo, 엔터프라이즈 temporal memory, Cypher injection CVE-2026-32247 패치 이력 |
| **Basic Memory** | 로컬 Markdown + **유료 cloud sync** | 로컬 우선, 동기화는 옵션 |
| **mcp-memory-service** | 로컬 + optional cloud | hybrid |

**관찰:** 순수 cloud-only는 보안·프라이버시 우려로 쇠퇴 중. **mem0의 MCP 레포 archived**가 상징적 — 사용자들이 "왜 내 채팅 메모리를 외부 서버에 보내?"를 거부하는 정서가 강함. 2026년 4월 OWASP "MCP Top 10"에 **memory poisoning**이 포함되면서 cloud 메모리에 대한 경계심이 더 커짐.

---

## 2. Claude Code Plugin 공식 가이드

Anthropic은 플러그인이 업데이트 후에도 살아남는 **공식 영속 디렉토리 환경변수**를 제공한다:

```
${CLAUDE_PLUGIN_DATA}
```

플러그인은 이 경로 안에 자유 포맷으로 저장 가능 — JSON, SQLite, Markdown 모두 허용. 즉 **저장 *경로*는 표준화, *포맷*은 개발자 재량**이라는 분업이 공식적인 입장이다.

> transcodes-guard는 `CLAUDE_PLUGIN_DATA` 대신 `os.homedir() + .claude/ai-action-tracker/`를 직접 결정했는데, 이는 **multi-host(Cursor/Codex/Antigravity와 공유)** 의도가 있기 때문에 의식적인 분기다. `CLAUDE_PLUGIN_DATA`를 따랐다면 Claude Code 안에서만 동작했을 것.

---

## 3. 패턴 선택 가이드 (실무 의사결정)

| 조건 | 추천 전략 |
|---|---|
| 데이터 < 1000개, 사용자가 손으로 편집 | **JSON/Markdown** (transcodes-guard 케이스 ✓) |
| 의미 검색·embedding 필요 | **Chroma / libSQL with vector** |
| 풀텍스트 검색만 필요 | **SQLite FTS5** (Engram 패턴) |
| 멀티 디바이스 동기화 필수 | **libSQL embedded replicas** (로컬+클라우드 하이브리드) |
| 팀 공유·SaaS 제품화 | **자사 클라우드** (Zep/mem0 모델) |
| 룰셋·정책 (예: danger-patterns) | **JSON + system/user 2-tier** ← transcodes-guard 패턴은 이 카테고리의 모범 사례 |

---

## 4. transcodes-guard의 현재 패턴 평가

리서치 결과에 비추어 보면, 현재 구조는 **메인스트림과 정합적**이고 **2가지 강점**이 있다:

1. **System/User 2-tier 분리** — 패키지 데이터(`packages/danger-patterns/data/*.json`, immutable) vs 사용자 홈(`~/.claude/ai-action-tracker/user-patterns.json`, mutable). 이건 위 비교표의 어떤 서버도 명시적으로 안 하는 **고급 패턴**이다. 보통 "내 데이터 한 곳"으로 끝나는데, 시스템 룰과 사용자 룰을 id 충돌 검증으로 보호하는 건 정책 도구(policy engine)에 가까운 설계.
2. **Host-agnostic 홈 경로** — `CLAUDE_PLUGIN_DATA` 대신 `os.homedir()/.claude/ai-action-tracker/`를 쓰면 Cursor/Codex/Antigravity 4-host가 같은 파일을 공유. 이건 multi-host MCP 시대의 실용적 디자인.

### 향후 고려할 만한 진화 경로

| 트리거 | 옮겨갈 전략 |
|---|---|
| user-patterns가 수백 개 이상으로 늘면 | SQLite로 마이그레이션 (Engram 스타일 FTS5) |
| 의미 검색(예: "비슷한 위험 명령어 자동 추천") 필요해지면 | Chroma 또는 libSQL with vector |
| 팀 공유 룰셋 요구 등장하면 | Transcodes backend 통합(이미 step-up MFA로 통신 중이므로 자연스러움) |
| Race condition이 실제 문제화되면 | SQLite의 WAL 모드 (파일 락 자동) |

현재 패턴(JSON + 2-tier)을 **유지하는 게 맞는 시점**은 "user 룰이 < 50개, 손으로 편집 가능해야 함, multi-host 호환성이 최우선" 조건이 깨지지 않는 한 — 즉 당분간은 변경 불필요.

---

## 5. 참고 자료

**핵심 비교 리포트**
- ChatForest — [Best Memory & Knowledge MCP Servers in 2026](https://chatforest.com/guides/best-memory-mcp-servers/) (7개 서버 비교표, 보안 CVE 포함)

**임베디드 DB 사례**
- [chroma-core/chroma-mcp](https://github.com/chroma-core/chroma-mcp) — 3-mode 디자인의 정석
- [joleyline/mcp-memory-libsql](https://github.com/joleyline/mcp-memory-libsql) — local + cloud sync 하이브리드
- [aaronsb/memory-graph](https://github.com/aaronsb/memory-graph) — 로컬 지식 그래프
- [PulseMCP — Anthropic SQLite MCP](https://www.pulsemcp.com/servers/modelcontextprotocol-sqlite)
- [PyPI — chroma-mcp-server 0.2.1](https://pypi.org/project/chroma-mcp-server/0.2.1/)

**로컬 파일 사례**
- [claude-mem (PyTorch Korea discuss)](https://discuss.pytorch.kr/t/claude-mem-claude-code-memory/8402) — `~/.claude-mem`
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — `CLAUDE_PLUGIN_DATA`

**커뮤니티 검증**
- [r/LocalLLaMA — local-first memory server discussion](https://www.reddit.com/r/LocalLLaMA/comments/1pofkjk/built_a_localfirst_memory_server_for_mcp_clients/) — "no cloud, SQLite-backed" 정서

**가이드/튜토리얼**
- [MCP Stateful Sessions 가이드 (wavespeed)](https://wavespeed.ai/blog/ko/posts/mcp-model-context-protocol-production/) — `checkpoint.db` SQLite 예시
