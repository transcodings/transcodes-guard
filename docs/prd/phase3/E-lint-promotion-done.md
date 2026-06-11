# Phase 3 / Unit E — 경계 lint warn→error 승격

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M4
> 규모: **S** · 선행: 없음 · 외부 의존: 없음 · 상태: 🎉 **Done** ([PR #48](https://github.com/transcodings/ai-action-tracker-mcp/pull/48) 머지 — gate-backend restricted 등록 + seam override + `private/**` off + stale 메시지 정리)
> v2 비고: private scope가 [Unit I](./I-license.md)에서 해체되면 본 규칙은 "구현 패키지는 seam 외 import 금지"라는 아키텍처 규칙으로 재조준된다(I §경계 규칙 정리).

## 규모 산정

- **S (Small)** — 단일 PR, 외부 의존 0, CI로 즉시 검증.
- 작업: biome 설정 2줄 수준 변경 + per-file override + stale 메시지 정리. 코드 변경 없음(설정 + 주석).
- 리스크 낮음. 단 **순서 의존**(아래 갭) 때문에 한 번에 2단계를 함께 해야 한다.

## 요구사항

biome `noRestrictedImports`를 public→private import에 대해 **error**로 승격한다.

## ⚠️ 현 규칙 갭 (반드시 2단계로)

현재 `biome.json`의 restricted paths는 `stepup-core` · `transcodes-mcp-tools` · `danger-rules` **3개뿐**이고 **`@transcodes-guard-private/gate-backend`는 빠져 있다**. seam인 `backend.ts`는 `gate-backend`만 import → 현 규칙으론 애초에 안 걸린다.

따라서 승격 작업은 다음 2단계가 **모두** 필요하다(둘 중 하나만으론 경계 미강제 또는 seam 오류):

1. **`@transcodes-guard-private/gate-backend`를 restricted list에 추가** (그래야 경계가 실제로 강제됨)
2. **`public/plugins/*/backend.ts`에 per-file override** (의도적 private import 지점이므로 예외 허용)

## stale 메시지 정리

현 restricted-import 메시지는 `"Phase 2 will introduce a GateBackend DI interface..."`라 하나, DI는 이미 #29에서 도입 완료. 메시지를 "DI 경계는 도입됨; 본 승격으로 seam 외 import를 금지한다" 취지로 갱신한다(부모 §1 단계 번호 주의와 함께 — 코드 docstring의 "Phase 2" 번호도 phase3 기준으로 정정).

## 배경

2단계(#29)에서 의도적으로 보류됨 — error 승격은 위 2단계(gate-backend 등록 + per-file override) 선행 필요.

## blocking Open Questions

- 없음. **즉시 착수 가능.**

## 수용 기준

- seam(`backend.ts`) 외 public 파일이 `@transcodes-guard-private/*`(**gate-backend 포함**)를 import하면 **빌드 실패**.
- CI(biome check)에서 강제.
- 기존 seam(`backend.ts` 4개)은 통과.

## 산출 파일(예상)

- `biome.json` — `noRestrictedImports` level `warn`→`error`, paths에 `gate-backend` 추가, 메시지 갱신
- `public/plugins/*/backend.ts` — biome per-file override 주석(또는 `biome.json` overrides 블록)
- 코드 docstring 번호 정정: `public/packages/gate-contract/src/{backend,registry}.ts`

## 비고

본 단위는 [Unit C](./C-cdn-loader-cancel.md)에서 `backend.ts`가 로더로 바뀌면 import 대상이 달라질 수 있다(정적 `gate-backend` import 제거 → 동적 로드). **C 이후 시점이면 override가 불필요해질 수 있으므로**, C와의 순서에 따라 override 범위를 재확인할 것. 권장 순서(A→B→C→E→D→F)대로면 E는 C 이후라 seam이 이미 로더 — 그 경우 override는 "혹시 남아있는 정적 import 방어" 용도로만 둔다.
