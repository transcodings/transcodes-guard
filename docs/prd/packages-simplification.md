# PRD — `packages/` 구조 단순화·평탄화 계획

> 작성: 2026-06-19. 산출 방식: `packages/*` 9개 패키지를 병렬 워크플로우 에이전트로 개별 감사(inspect) → 교차 종합(synthesize) → 제안별 적대적 검증(critique). 18개 서브에이전트, 제안 8건에 대해 검증 통과분만 채택. 코드 변경 없음 — 본 문서는 실행 계획이다.

## 0. 배경과 목적

`packages/*`는 9개 워크스페이스 라이브러리로 구성되며, 그중 4개가 150 LOC 미만의 "마이크로 패키지"다. 과거 **public/private 분리**(이제 폐기됨, CLAUDE.md "now-dissolved")를 전제로 쪼갠 잔재가 남아 있어, 패키지 경계 일부가 더 이상 가치를 내지 못한다. 본 계획의 목표는 **경계가 가치를 내는 곳은 유지**하고, **publish 경계 폐기로 정당성을 잃은 분리와 죽은 코드/의존은 평탄화**하는 것이다.

### 현재 구조 (LOC / 내부 의존)

| 패키지 | LOC | 응집도 | 비고 |
|---|---:|---|---|
| stepup-core | 3084 | medium | 게이트 결정 + 백엔드 클라이언트. 분리 후보 있으나 보류(P8) |
| transcodes-mcp-tools | 1831 | high | 56개 MCP 도구 어댑터. 소비자=gate-backend 하나(P5 keep) |
| mcp-server-core | 1665 | medium | host-agnostic 서버 셸. 단일 createServer 불변식 |
| hook-adapters | 702 | high | 호스트별 stdin/stdout 계약. 완료-감지 정규식 중복(P7) |
| gate-contract | 652 | medium | DI seam 인터페이스. P6 keep |
| danger-rules | 362 | high | MCP 툴-룰 레지스트리. danger-patterns의 쌍둥이(P2) |
| plugin-paths | 150 | high | 경로 해결 leaf. 흡수 제안 reject(P1) |
| danger-patterns | 126 | medium | Bash 패턴 + RBAC 어휘. danger-rules와 병합(P2) |
| gate-backend | 125 | high | 세 private 패키지를 묶는 얇은 바인더. seam(P5/P6 keep) |

**의존 그래프의 핵심 특징**

- `danger-patterns`·`plugin-paths`는 거의 모든 패키지의 leaf로, 깨끗한 단방향 의존만 가진다.
- `gate-backend → {stepup-core, transcodes-mcp-tools, danger-rules}`는 의도적 DI 바인더이며, `getGateBackend()` seam과 biome `noRestrictedImports`로 보호된다. **이 경계는 단순화 대상이 아니다.**
- `danger-rules → danger-patterns`는 RBAC 어휘를 공유하기 위한 단방향 엣지로, 병합 시 내부화 가능하다.

## 1. 불변 제약 (모든 작업이 지켜야 함)

각 제안의 검증에서 반복 확인된 횡단 제약. 위반 시 빌드/리뷰가 깨진다.

1. **`packages/*`는 전부 `"private": true` 유지.** publish 대상은 `plugins/*`·`cli`뿐. publish-surface CI 게이트가 강제.
2. **`gate-backend`는 `plugins/*/backend.ts` 밖에서 import 금지.** biome `noRestrictedImports`가 error로 강제(seam 파일만 예외).
3. **백엔드 결합 코드는 `getGateBackend()` seam으로만 접근.** `gate-backend` 직접 import 금지.
4. **단일 `createServer()` / 단일 gate 불변식.** 5개 플러그인 transport가 `mcp-server-core`의 `createServer()`를 공유. 플러그인으로 병합 금지.
5. **구조 변경 후 반드시 `npm run build:plugin` 실행 + 재생성된 `dist/`(packages/* + plugins/*)를 같은 커밋에 포함.** dist는 커밋된 빌드 산출물이다.

## 2. 채택 제안 (검증 통과)

검증 등급: **endorse**(무조건 채택) / **endorse-with-caveat**(caveat 반영 조건부 채택).

### P2 — `danger-patterns` + `danger-rules` 병합 → 단일 룰 레지스트리 (endorse-with-caveat)

- **근거**: 두 패키지는 "두 개의 평행 레지스트리, 같은 멘탈 모델"(`.claude/rules/danger-patterns.md`)로 명시된 쌍둥이다. 분리의 유일한 근거였던 public(publish 가능)/private 구분은 **폐기**됐고 현재 둘 다 `private:true`. `danger-rules`는 이미 RBAC 어휘를 위해 `danger-patterns`를 단방향 의존하므로, 병합은 엣지를 내부화할 뿐 순환을 만들지 않는다. `danger-patterns`의 description은 이미 `+ MCP tool-rule registry`를 포함해 통합을 예고한다.
- **목표 구조**: `danger-patterns/`에 `tool-rules.{ts,json}` + `guard-rules` 흡수. 결과 패키지명은 `@transcodes-guard/danger-patterns`(더 일반적·consumer 7개로 더 많음). `danger-rules` 패키지 삭제.
- **caveat (반드시 반영)**:
  - consumer surface 비대칭 — 패턴만 쓰는 `gate-contract`/`mcp-server-core`가 tool-rule 코드를, 룰만 쓰는 `gate-backend`가 패턴 코드를 전이적으로 끌게 된다. private workspace dep이고 번들 시 tree-shaking되므로 위반은 아니나 표면이 약간 커진다.
  - effort는 medium이되 과소평가 주의: import 사이트 ~12곳 변경 + dist 재빌드/재커밋(§1.5).
- **effort/risk**: medium / low.

### P3 — danger 패키지의 죽은 의존성 제거 (endorse-with-caveat)

- **근거**: `danger-patterns`·`danger-rules` 두 `package.json`이 `@transcodes-guard/plugin-paths`와 `jsonc-parser`를 선언하지만 `src/`에서 둘 다 import하지 않음(검증으로 확인). `danger-rules → danger-patterns` 의존은 **실사용**이므로 건드리지 않는다.
- **목표 구조**: 두 패키지에서 미사용 dep 2개 제거 + lockfile 재생성.
- **caveat (반드시 반영)**: `packages/danger-patterns/dist/`에 **stale 산출물**(`tool-rules.js/.d.ts/.js.map`)이 남아 있어 여전히 두 dep을 import한다. tool-rules가 `danger-rules`로 이동하기 전의 고아 출력이다. `npm run build:plugin` 재실행으로 이 stale 파일을 떨궈 dist를 정합화해야 한다(§1.5).
- **effort/risk**: low / low.
- **참고**: P2와 함께 수행하면 자연히 통합된다(병합 시 dep 정리·dist 재생성이 한 번에).

### P4 — `mcp-server-core/tool-catalog.ts` → `cli`로 이동 (endorse-with-caveat)

- **근거**: `tool-catalog.ts`는 import 0개의 순수 정적 데이터(~651 LOC)이고, 유일한 비-dist 소비자는 `cli/src/dashboard.ts` 하나(repo 전체 grep 확인). `cli`는 이미 `mcp-server-core`를 의존하므로 이동 시 역의존이 생기지 않고 오히려 `cli → mcp-server-core` 엣지 하나를 제거할 수 있다. private 패키지의 `./tool-catalog` subpath export도 함께 줄어든다.
- **목표 구조**: `tool-catalog.ts`를 `cli/src/`로 이동, `mcp-server-core`의 `./tool-catalog` subpath export 제거.
- **caveat (반드시 반영)**: 이 카탈로그는 `mcp-server-core`의 `registerTool` 등록부를 **수작업 미러링**하는 동기화 결합이 있다. `cli`로 옮기면 진실의 원천에서 멀어진다. 이동 시 (a) "mcp-server-core의 tools/와 server.ts registerTool과 동기화 필수" 주석을 그대로 유지하고, (b) 가능하면 type-check/CI에 drift 감지 가드를 두는 것을 조건으로 한다.
- **effort/risk**: low / low.

### P7 — `hook-adapters` 완료-감지 정규식 중복 제거 (endorse-with-caveat)

- **근거**: 동일한 완료 감지 정규식이 4곳에 존재 — 정본 export `ANTIGRAVITY_COMPLETION_PATTERN`(`hook-adapters/src/antigravity.ts`, 이미 `index.ts`로 공개됨) + `plugins/{claude-code,codex,cursor}` 훅의 복붙 사본 3개. 세 플러그인 모두 이미 `hook-adapters`를 의존하므로 신규 엣지·순환 없음.
- **목표 구조**: 3개 플러그인 사본을 export 재사용으로 대체.
- **caveat (반드시 반영)**: 정본 export 이름이 host-specific(`ANTIGRAVITY_*`)인데 값은 host-agnostic이다. 4개 호스트 공유 시 오해 소지 → 중립 이름(예: `COMPLETION_PATTERN`)으로 rename 권장하되, **`findReferences`로 사용처 확인 후** 진행. rename·de-dup 모두 dist 재빌드/재커밋 필요(§1.5).
- **effort/risk**: low / low.

## 3. 유지 결정 (keep — 변경 금지)

검증이 "경계가 가치를 내므로 유지"로 판정한 것들. keep도 산출물이다 — 잘못된 병합을 막는다.

### P5 — `transcodes-mcp-tools`는 독립 유지 (endorse)

- 1956 LOC의 실질 비즈니스 로직이고, `gate-backend`는 세 private 패키지를 GateBackend 계약에 묶는 **얇은 바인더**다. `gate-backend` description이 명시한 phase-2 **CDN 로드** 봉합이 이 분리에 의존한다. 병합하면 그 DI 경계가 무너진다.

### P6 — `gate-contract`/`gate-backend`/`stepup-core` seam 유지 (endorse-with-caveat)

- 핵심 DI 아키텍처. biome `noRestrictedImports`(biome.json:51-55)가 import 금지를 강제하고 4개 seam 파일이 예외 처리됨. 병합은 §1의 제약 2·3을 직접 위반한다.
- **부수 작업(문서 한정)**: `registry.ts:6,9`의 폐기된 public/private 분리 언급과 "Phase 3 CDN obfuscated backend bundle" 주석을 정리. **단, 문서/주석만 수정** — import-ban 설정·registry 동작·seam 배선은 절대 건드리지 않는다. Phase 3 CDN 계획이 살아있는지 먼저 확인 후 해당 주석을 다룰 것.

### P8 — `stepup-core`의 token-store/policy 분리는 **보류** (endorse)

- `token-store.ts`(306 LOC)·`policy-bundle.ts`(386)+`guard-rules.ts`(252)는 분리 후보지만, 지금 빼내면 **마이크로 패키지를 새로 양산**한다. "host = adapter, never a duplicated gate"의 최소주의 철학에 반한다. P2(병합으로 패키지 수 감소)를 먼저 끝낸 뒤 재검토한다.

## 4. 기각 제안 (reject)

### P1 — `plugin-paths`를 `stepup-core`로 흡수 (reject, 제약 위반)

- **기각 사유**:
  1. **책임 혼재**(§제약 위반): `plugin-paths`는 4개 호스트가 공유하는 host-agnostic leaf(경로 해결 + `detectHost`/`HostName`), `stepup-core`는 backend-coupled 게이트 로직. leaf를 업무 로직에 흡수하는 것은 책임을 섞는다.
  2. **문서화된 단일 진실원천 파괴**: CLAUDE.md Must 규칙(line 70) "Resolve persist/cache paths only via `@transcodes-guard/plugin-paths`", 아키텍처 표(line 31), 전용 룰 파일(`.claude/rules/plugin-paths.md`), CLI 섹션(line 62)이 모두 `plugin-paths`를 중앙 경로 해석기로 못박는다. 흡수는 이 경계를 위반한다.
  3. **새 결합/순환 위험**: 흡수하면 (dead dep 정리 후에도) 경로 유틸이 필요한 곳이 게이트 로직 전체에 의존해야 한다.
  4. **실익 대비 비용**: 패키지 1개 감소가 전부인데, `plugin-paths`는 ~5개 함수의 작고 안정적인 leaf라 유지 비용이 거의 없다.
- **단, `plugin-paths` 자체의 정리 항목은 별도로 유효**(흡수와 무관, 선택):
  - dead export 강등/제거: `detectHost`/`transcodesDir`/`legacyDataDir`/`legacyCacheDir`/`HostName`은 외부 소스 호출처가 없음(내부 전용).
  - `dataDir()`와 `cacheDir()`가 동일 `stateDir()` 반환 — 구분이 현재 무의미. `migrateLegacyFile`의 `kind` 파라미터도 무시됨(`void kind`). 시그니처 단순화 여지.
  - **문서 드리프트 수정**: `.claude/rules/plugin-paths.md`·루트 CLAUDE.md·package.json description이 구버전 동작(`CLAUDE_PLUGIN_DATA`/`~/.claude/ai-action-tracker` 경로 선택)을 서술 — 실제 구현은 `~/.transcodes/state` 일원화로 이동함. 일괄 갱신 필요.

## 5. 실행 순서 (제안)

작은 무위험 정리부터, 구조 병합은 그 뒤에. 각 단위는 독립 PR 권장.

1. **P3 + P7** (low/low, 구조 무영향) — dead dep 제거, 정규식 de-dup. 빠른 정리로 시작.
2. **P4** (tool-catalog 이동) — drift 가드 caveat 반영.
3. **P2** (danger 병합) — P3를 흡수하며 진행(병합 시 dep 정리·dist 재생성 동시). 가장 큰 구조 변경.
4. **P6 문서 정리** (registry.ts 주석) — 다른 작업과 묶어도 무방.
5. **P1의 plugin-paths 문서 드리프트 수정** (흡수는 하지 않음) — 선택.
6. **P8 재검토** — P2 완료 후, 그때 패키지 수 상황을 보고 token-store/policy 분리를 다시 판단.

### 공통 완료 기준 (모든 단위)

- [ ] `npm run type-check` 통과
- [ ] `npm run check`(biome) 통과 — 특히 `noRestrictedImports` 무위반
- [ ] `npm run build:plugin` 실행 + 재생성된 `dist/`(packages/* + plugins/*) 동일 커밋 포함
- [ ] 23개 훅 스모크 테스트 통과 (claude-code 9 + codex 3 + antigravity 5 + cursor 6)
- [ ] `packages/*` 전부 `"private": true` 유지 확인

## 6. 기대 효과

- 패키지 수 **9 → 8**(P2 병합). 추가로 P8 보류 결정이 향후 무분별한 마이크로 패키지 양산을 막는다.
- subpath export·dead dep·복붙 정규식·stale dist 제거로 표면적 축소.
- 핵심 DI seam(P5/P6)은 그대로 — **단순화가 아키텍처 경계를 건드리지 않음**을 명시적으로 보장.
- 문서 드리프트(plugin-paths·registry public/private 잔재) 해소로 코드-문서 정합성 회복.
