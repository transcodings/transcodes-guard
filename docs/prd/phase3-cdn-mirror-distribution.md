# PRD — 3단계: 비공개 backend의 obfuscate + S3/CloudFront CDN 배포 + public 미러 공개 (인덱스)

> Status: Draft · Owner: huskyhoochu · Last updated: 2026-06-09
> 선행 단계: 1단계(디렉토리 분리, #24→#28 완료) · 2단계(`GateBackend` DI 경계, #29 완료)
> 근거 문서: [`docs/research/public-private-split.md`](../research/public-private-split.md) · [`docs/research/public-private-mapping.md`](../research/public-private-mapping.md) · [`docs/research/multi-host-plugin-distribution.md`](../research/multi-host-plugin-distribution.md)

> **이 문서는 인덱스다.** 워크스트림별 상세·규모·수용 기준은 [`phase3/`](./phase3/) 하위 개발 단위 문서에 있다. 본 문서는 공통 맥락(배경/문제/목표/아키텍처)과 단위 간 의존·규모·실행 순서만 유지한다.

---

## 1. 배경 (Background)

`transcodes-guard`는 한 모노레포에 **공개 가능한 호스트 어댑터/hook/MCP 셸**과 **비공개 비즈니스 로직(MFA 게이트 평가, 토큰 핸들링, 백엔드 API 통신, RBAC 정책)**이 공존한다. 1·2단계로 다음이 끝났다.

- **1단계 (완료)** — 디렉토리를 `public/` ↔ `private/`로 물리 분리. `private/packages/*`는 전부 `"private": true`, CI가 publish-surface 게이트로 강제. public→private import는 biome `noRestrictedImports`로 검출(현재 **warn**).
- **2단계 (완료)** — `public/packages/gate-contract`에 `GateBackend` 인터페이스 + `setGateBackend`/`getGateBackend` 레지스트리를 두고, `private/packages/gate-backend`가 구현. public 측(hook 15종 + `mcp-server-core`)은 private를 직접 import하지 않고 `getGateBackend()`만 호출한다. public standalone 빌드(private 격리 후 `tsc --noEmit`)까지 검증됨.

핵심 seam은 호스트별 [`public/plugins/*/backend.ts`](../../public/plugins/claude-code/backend.ts) 단 4개 파일이다. 현재는 **정적 import**로 `setGateBackend(transcodesGateBackend)`를 호출하며, tsup `noExternal`이 private 어댑터를 각 entry 번들에 **평문(plaintext)으로 inline**한다. 이 docstring이 본 단계(CDN 전환)를 명시적으로 예고한다:

```
Phase 2 (CDN): replace the static import below with the loader that fetches
the obfuscated backend bundle from CloudFront, verifies it, and calls
setGateBackend — the getGateBackend() call sites do not change.
```

> ⚠️ **단계 번호 주의**: 코드 docstring(`backend.ts`·`registry.ts`)과 biome 메시지는 CDN/DI 작업을 **"Phase 2"**로 부른다. 이는 DI 단계가 독립 단계로 삽입되기 *전*의 2단계 모델(1=분리+번들, 2=CDN)에서 쓰인 것이며, 갱신되지 않았다. **코드의 "Phase 2 (CDN)" = 본 PRD의 3단계**다. 워크스트림 C·E에서 이 docstring/메시지의 번호를 phase3 기준으로 정정한다(→ [Unit C](./phase3/C-cdn-loader.md) · [Unit E](./phase3/E-lint-promotion.md)).

## 2. 문제 정의 (Problem)

목표는 **public 미러 리포를 외부에 공개**하는 것이다. 그러나 현재 상태로 공개하면 안 되는 이유:

1. **평문 누출** — 현재 plugin `dist/`에 private backend가 inline 평문으로 박혀 있다. 소스를 `private/`로 옮겨도 빌드 산출물이 누출되면 분리는 무의미하다(MEMORY: public/private split audit, "진짜 위험은 dist 번들 누출").
2. **런타임 분리 부재** — public이 동작하려면 backend가 필요한데, 현재는 빌드 타임에 결합돼 있어 "public만 공개"가 성립하지 않는다.
3. **공개 인프라 전무** — `git filter-repo` 미러 자동화, S3/CloudFront 배포, obfuscation 파이프라인, CDN 로더가 코드/인프라로 **하나도 존재하지 않는다**(워크플로는 `ci.yml`·`release.yml` 둘뿐).

## 3. 목표 / 비목표 (Goals / Non-Goals)

### Goals

- **G1** — 비공개 backend를 난독화된 단일 ESM 번들로 빌드하고, public dist에서 평문 inline을 제거한다. → [A](./phase3/A-obfuscate-build.md)
- **G2** — 난독화 번들을 SHA384 무결성 매니페스트와 함께 S3/CloudFront CDN에 배포한다(메이저 버전 경로 분리). → [B](./phase3/B-cdn-deploy.md)
- **G3** — `backend.ts` seam을 CDN 로더로 교체한다: fetch → SHA384 검증 → 로컬 캐시 → `import()` → `setGateBackend()`. **`getGateBackend()` 호출부는 0줄 변경.** → [C](./phase3/C-cdn-loader.md)
- **G4** — public→private import 경계 lint를 warn→**error**로 승격하되, `backend.ts` 단일 seam만 per-file override. → [E](./phase3/E-lint-promotion.md)
- **G5** — `git filter-repo`로 private 히스토리를 완전 제거한 public 미러를 자동 미러링한다. → [D](./phase3/D-mirror-automation.md)
- **G6** — public 미러 리포를 외부에 공개한다. → [F](./phase3/F-public-release.md)

### Non-Goals

- **NG1** — Ed25519 코드 서명. v1은 SHA384 SRI만(split.md §2.5 — 키 로테이션/폐기 운영부담, 공급망 공격 사례 발생 시 추가).
- **NG2** — 게이트 정책의 *전면* 백엔드 이관. 본 PRD는 코드 분리/배포가 범위이며, 정책 서버 이관(Clerk 모델)은 상시 과제로 별도 추진(split.md §5.5).
- **NG3** — `@bigstrider/transcodes-cli`의 배포 방식 변경. CLI는 이미 별도 npm 발행 중이며 브랜드 리네임에서 제외됨(CLAUDE.md).
- **NG4** — 호스트 marketplace 등록/실제 plugin 발행 채널 확정. 배포 채널은 #19에서 보류 결정됨 — 본 PRD는 미러 공개까지가 범위.

## 4. 설계 개요 (Architecture)

```
[private 모노레포 — 이 리포, 영구 비공개]
  private/packages/gate-backend  ──①obfuscate build──▶  guard-<ver>.mjs (난독화 ESM)   [A]
                                                              │
                                                       ②SHA384 계산 + 매니페스트         [B]
                                                              │
                                                   ③S3 업로드 + CloudFront 무효화        [B]
                                                              ▼
                              cdn.transcodes.dev/guard/v1/guard-<ver>-<sha384>.mjs
                                                              ▲
                                                   ④런타임 fetch + 해시검증 + 로컬캐시    [C]
                                                              │
[public 미러 리포 — 외부 공개]                                │
  public/plugins/*/backend.ts (CDN 로더) ──────────────────┘                            [C]
       └─ fetch → verify(SHA384) → ~/.transcodes/cache/guard-<ver>-<sha384>.mjs → import() → setGateBackend()
  public/packages/* (gate-contract, mcp-server-core, ...) ── getGateBackend() 호출 (불변)
       ▲
  ⑤git filter-repo --invert-paths --path private/ 로 미러 생성 → public repo push       [D]
```

설계 불변식(invariant): **CDN 전환으로 바뀌는 것은 "누가 `setGateBackend()`를 호출하는가" 단 하나다.** public 소비자는 전부 `getGateBackend()`만 보므로 로더 도입은 `backend.ts` 4개 파일 교체로 끝난다(split.md §4.2, registry.ts docstring).

## 5. 개발 단위 (Development Units)

워크스트림 = 개발 단위 = 마일스톤(1:1). 각 단위는 독립 PR(군)으로 진행. 상세·수용 기준은 단위 문서 참조.

| 단위 | 제목 | 규모 | 선행 | 외부 blocker | 상태 |
|---|---|:--:|---|---|---|
| [A](./phase3/A-obfuscate-build.md) | 비공개 backend 난독화 빌드 | **M** | — | 없음 | ✅ **Ready** |
| [B](./phase3/B-cdn-deploy.md) | SHA384 매니페스트 + S3/CloudFront 배포 | **L** | A | AWS 인프라·`cdn.transcodes.dev` 도메인·secrets (OQ2) | ⚠️ Blocked(인프라) |
| [C](./phase3/C-cdn-loader.md) | CDN 로더 (`backend.ts` 교체) | **L** | A, B | fallback 정책·버전 핀·로더 위치 결정 (OQ1/3/4) | ⚠️ Blocked(결정) |
| [E](./phase3/E-lint-promotion.md) | 경계 lint warn→error 승격 | **S** | — | 없음 | ✅ **Ready** |
| [D](./phase3/D-mirror-automation.md) | public 미러 자동화 | **M** | A~C(사실상) | CLI 미러 포함 결정(OQ7)·target public repo | ⚠️ Blocked(결정) |
| [F](./phase3/F-public-release.md) | public 미러 공개 | **S**(human) | A~E 전부 | 위 전부 | 🚫 Gated |

규모 기준: **S** = 단일 PR·외부 의존 0 · **M** = 1~2 PR·결정/검증 동반 · **L** = 복수 PR·외부 인프라 또는 다수 결정·보안 임계.

**권장 실행 순서: A → B → C → E → D → F** (A~C가 본체, E·D는 공개 직전 안전망, F가 스위치). **지금 외부 의존 없이 착수 가능 = A·E.**

## 6. 위험 (Risks) — 마스터

| 위험 | 영향 | 완화 | 소관 단위 |
|---|---|---|---|
| CDN 침해/MITM으로 위조 번들 주입 | 게이트 우회 | SHA384 핀 검증(로더 소스 상수). 사례 시 Ed25519(NG1) | B, C |
| 로더 fail-open으로 게이트 무력화 | 보안 우회 | fallback을 fail-closed로 설계, `denyByDefaultBackend` 재검토 | C |
| obfuscation 우회(역난독화) | 로직 노출 | 1차 obfuscation + 2차 정책 백엔드 이관(NG2). "풀린다" 전제 | A |
| filter-repo 누락으로 평문 히스토리 공개 | 비공개 코드 영구 노출 | `--dry-run` + grep/metafile 체크리스트 + 공개 전 수동 감사 | D, F |
| 첫 fetch 지연이 hook 응답 시간에 영향 | UX 저하 | 캐시 우선, 설치/빌드 시 사전 fetch(warm cache) | C |
| CDN 장애 시 게이트 동작 불가 | 가용성 | 캐시된 검증본 재사용 + 오프라인 폴백 정책 | C |

## 7. 미해결 질문 (Open Questions) — 마스터

각 OQ는 해당 단위 문서에서 blocking으로 추적된다.

1. **로더 fallback 정책** — 검증 실패/오프라인 시 deny-by-default인가, 캐시된 마지막 검증본 사용인가? → blocks **C**
2. **CDN 도메인** — `cdn.transcodes.dev` 확정? S3+CloudFront vs 대안? → blocks **B**
3. **버전 핀 갱신 흐름** — 새 backend 배포 시 로더 핀 상수 갱신/릴리스 방법? (`gate-contract` 메이저 bump 연동?) → blocks **B/C**
4. **로더 패키지 위치** — `@transcodes-guard/loader` 별도 public 패키지 vs `backend.ts` 인라인? → blocks **C**
5. **public dist 평문 제거 타이밍** — A 완료~C 전 과도기 public dist 상태? → affects **A/C/D**
6. **CLI tarball의 private inline** — CLI는 여전히 private inline 발행(MEMORY); CDN 모델 밖에 둘지? → affects **D**
7. **CLI 미러 포함 여부** — CLI 소스가 `private/cli/`라 `--path private/`에 함께 제거. 미러는 npm CLI 참조만 vs CLI를 `public/`으로 이동? → blocks **D**
8. **obfuscator encoding 채택 여부** — 기본 `stringArrayEncoding: []`(없음). 엔드포인트 은닉 위해 `['base64']`? → affects **A**

## 8. 마일스톤 (Milestones)

| 마일스톤 | 단위 | 산출물 | 규모 | 상태 |
|---|---|---|:--:|---|
| M1 — 난독화 빌드 | [A](./phase3/A-obfuscate-build.md) | `npm run build:cdn`, obfuscated `guard-<ver>.mjs` | M | Ready |
| M2 — CDN 배포 | [B](./phase3/B-cdn-deploy.md) | S3/CloudFront 인프라 + 배포 워크플로 + SHA384 매니페스트 | L | Blocked |
| M3 — 로더 전환 | [C](./phase3/C-cdn-loader.md) | `backend.ts` 로더 교체, 23종 smoke 통과 | L | Blocked |
| M4 — 경계 강제 | [E](./phase3/E-lint-promotion.md) | lint error 승격 + seam override | S | Ready |
| M5 — 미러 자동화 | [D](./phase3/D-mirror-automation.md) | filter-repo 미러 워크플로 + 검증 체크리스트 | M | Blocked |
| M6 — 공개 | [F](./phase3/F-public-release.md) | public repo 외부 공개 | S | Gated |
