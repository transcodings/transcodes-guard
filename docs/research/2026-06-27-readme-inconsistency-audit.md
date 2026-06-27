# README 불일치 점검 + 외부 권위 재검증

- **작성일**: 2026-06-27
- **범위**: 13개 README — 루트(`README.md`/`README.ko.md`), `cli/README.md`, `mcp/README.md`/`README.ko.md`, 플러그인 4종(`claude-code`/`codex`/`cursor`/`antigravity`) × EN/KO
- **방법**: ① 7개 차원 병렬 스캔 + 후보 17건 적대적 검증(24개 서브에이전트) → ② 외부 1차 권위(호스트 공식 docs)로 재판정
- **상태**: 점검·재검증 완료. 코드/문서 수정은 미진행(별도 작업 대기).

---

## 0. 한 줄 요약

외부 권위에 비추면 루트 README는 대체로 정확했고, **일부 플러그인 README가 낡아 있었다(stale)**. 정작 손봐야 할 핵심은 둘이다. **(1) `cursor` README의 `plugin.json` 부정**(공식 문서가 반증), **(2) `codex` README의 빌드 강제 설치 절차**(공식 권장은 빌드가 필요 없는 원격 경로). 그 밖에 `mcp/README`의 standalone 발행 서술은 추후 발표 예정인 패키지를 미리 적은 것이라 시제만 조정하면 된다(아래 §3 L-3).

---

## 1. 방법론 — 외부 권위로 내부 판정을 재검증

1차 점검은 README끼리, 그리고 README와 레포 내부 신호(`package.json`·release 설정)를 대조하는 데 그쳤다. 그러나 `git clone+install.sh`(Cursor)나 `marketplace add <repo>`(Codex) 같은 명령이 *지금도 유효한 호스트 문법인지*는 레포가 알려주지 않는다 — 호스트 공식 문서만이 권위를 가진다. 그래서 2차로 호스트 공식 docs를 직접 조회해 재판정했고, 그 결과 §2~§3의 cursor·codex 판정이 확정됐다.

> **부수 사항 — mcp standalone 발행 시점.** 현재 프로젝트의 standalone MCP 패키지는 **추후 발표 예정**이라 지금은 사용 대상이 아니다(레지스트리에 동명의 옛 패키지가 남아 있으나 stale하므로 활용하지 않는다). 따라서 루트 README가 mcp를 따로 안내하지 않는 것은 정상이며, `mcp/README`의 현재형 "발행됨" 서술만 시제를 맞추면 된다(§3 L-3).

---

## 2. 신뢰 판정표 — 무엇을 믿어야 하는가

| 쟁점 | 결론 | 근거 권위 |
|---|---|---|
| **Cursor `plugin.json` 존재** | **루트 README 옳음 / `cursor` 플러그인 README stale** | `cursor.com/docs/reference/plugins`: "`.cursor-plugin/plugin.json` **# Required: plugin manifest**", 마켓플레이스 매니페스트 = `.cursor-plugin/marketplace.json`(repo root) — 우리 레포 구조와 정확히 일치 |
| **Codex 설치 명령** | **루트 README 옳음(원격·빌드불필요) / `codex` 플러그인 README는 저자용 로컬 경로** | `developers.openai.com/codex/plugins/build`: `codex plugin marketplace add owner/repo [--ref main]` + `$REPO_ROOT/.agents/plugins/marketplace.json` 공식화 |
| **`mcp` standalone 발행** | **루트가 현 시점 옳음 / `mcp/README`는 추후 발표 예정 패키지를 미리 서술** | standalone mcp는 아직 발표 전(§1 부수 사항) |
| **Antigravity 설치 경로** | 우리 README 정합 | `antigravity.google/docs/cli-features`: `~/.gemini/antigravity-cli/plugins/<name>/` staging 확인 |

### 인용한 외부 1차 권위
- Cursor 공식: `https://cursor.com/docs/plugins`, `https://cursor.com/docs/reference/plugins`
- Codex 공식: `https://developers.openai.com/codex/plugins`, `https://developers.openai.com/codex/plugins/build`
- Antigravity 공식: `https://antigravity.google/docs/plugins`, `https://antigravity.google/docs/cli-features`

---

## 3. 실제 수정이 필요한 불일치

### 🔴 HIGH — 공식 문서가 명백히 반증하는 stale 서술

**H-1. `plugins/cursor/README.md` + `README.ko.md` (line 7)**
"Cursor has no `plugin.json` concept (Marketplace bundle spec is non-public)"는 **공식 문서가 반증하는 거짓**이다. 실제로 `plugin.json`은 *Required*이고, 레포에 `plugins/cursor/.cursor-plugin/plugin.json`이 존재하며 version train에도 들어 있다. 루트 README와도 직접 충돌한다.
→ cursor README를 "plugin.json + 마켓플레이스 기반 설치(`install.sh`는 legacy fallback)"로 다시 쓴다.

### 🟡 MEDIUM — 사용자가 헛수고하게 만드는 절차 불일치

**M-1. `plugins/codex/README.md` + `README.ko.md`**
`git clone + npm run build:plugin + codex plugin marketplace add .`를 *유일한* 설치법으로 제시한다. 그러나 `dist/`가 커밋된 레포에서는 빌드가 필요 없고, 공식 권장도 원격 `codex plugin marketplace add transcodings/transcodes-guard`다. 이대로면 사용자가 불필요한 clone과 build를 거치게 된다.
→ 루트 README처럼 빌드가 필요 없는 원격 경로를 1순위로 둔다.

**M-2. `cli/README.md` (line 27)**
`transcodes status`가 "token source (env vs file)"를 보여준다고 하나, env 토큰 fallback은 이미 제거됐다(config.json 단일 소스).
→ "env vs file" 표현을 삭제한다.

### 🟢 LOW — 경미

**L-1. 루트 README CLI 명령 목록 불완전**
실제 9개(`set`/`reset`/`status`/`tokens`/`console`/`policy refresh`/`version`/`help` + dashboard) 중 4개만 나열. `cli/README`도 `console`·`version` 누락. 단, 모든 *나열된* 명령은 정확하고 `transcodes help`가 런타임에 전체를 보여줌 → 위험 낮음.

**L-2. `plugins/codex/README` 헤딩**
"Slash command: `$transcodes`" — Codex는 `/`가 아닌 `$`-mention. 본문이 즉시 교정하므로 오인 위험 작음.

**L-3. `mcp/README.md` + `README.ko.md` (line 5)**
standalone MCP 패키지를 "발행됨" 현재형으로 적었으나 추후 발표 예정이다. → "발행 예정" 시제로 조정하거나, 실제 발표 시점에 맞춰 문서를 갱신한다.

---

## 4. 오탐 / 의도된 차이 (수정 불필요)

- **mcp version train "4 plugins" 표현** — train은 사실 root+4+mcp이나, "4 플러그인과 같은 train"은 독자 관점에서 충분히 참 → 오탐.
- **호스트별 primer 위치 차이**(Claude=SessionStart / Codex=AGENTS.md / Cursor=deny 메시지 / Antigravity=`rules/STEPUP.md`) — 실제 호스트 메커니즘 차이로 **의도된 정당한 분기**. 소스 `hooks.json`과 일치 확인.
- **EN↔KO 번역 drift** — translation-parity 차원 **findings 0**. 한국어가 영어와 같은 사실을 그대로 옮겨 매우 깨끗함(영문이 틀린 곳은 한국어도 같이 틀린 "충실한 번역"이라 drift 아님).

---

## 5. 방법론 메모 (재현용)

- 1차 점검: 7개 차원(npm-publish-surface / version-train / cursor-install / codex-install / cli-command-surface / hook-protocol / translation-parity)을 병렬로 스캔한 뒤, 각 후보를 적대적으로 검증해 real-issue / intended-divergence / false-positive로 분류했다. 후보 17건 → real 12, intended 1, false-positive 4.
- 2차 재검증(이 문서의 핵심): 1차의 "정본"인 레포 내부 신호를 신뢰하지 않고, 호스트 공식 docs로 다시 판정했다. 이 단계에서 cursor·codex 설치 관련 판정이 확정됐다.
- **교훈**: 플러그인·호스트 문서는 빠르게 바뀌므로 README↔README, README↔레포 ground truth 비교로 끝내서는 안 된다. 설치 명령·매니페스트 형식 같은 호스트 계약은 공식 docs를 직접 확인한다.
