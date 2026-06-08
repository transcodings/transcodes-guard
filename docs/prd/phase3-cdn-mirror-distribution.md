# PRD — 3단계: 비공개 backend의 obfuscate + S3/CloudFront CDN 배포 + public 미러 공개

> Status: Draft · Owner: huskyhoochu · Last updated: 2026-06-08
> 선행 단계: 1단계(디렉토리 분리, #24→#28 완료) · 2단계(`GateBackend` DI 경계, #29 완료)
> 근거 문서: [`docs/research/public-private-split.md`](../research/public-private-split.md) · [`docs/research/public-private-mapping.md`](../research/public-private-mapping.md) · [`docs/research/multi-host-plugin-distribution.md`](../research/multi-host-plugin-distribution.md)

---

## 1. 배경 (Background)

`transcodes-guard`는 한 모노레포에 **공개 가능한 호스트 어댑터/hook/MCP 셸**과 **비공개 비즈니스 로직(MFA 게이트 평가, 토큰 핸들링, 백엔드 API 통신, RBAC 정책)**이 공존한다. 1·2단계로 다음이 끝났다.

- **1단계 (완료)** — 디렉토리를 `public/` ↔ `private/`로 물리 분리. `private/packages/*`는 전부 `"private": true`, CI가 publish-surface 게이트로 강제. public→private import는 biome `noRestrictedImports`로 검출(현재 **warn**).
- **2단계 (완료)** — `public/packages/gate-contract`에 `GateBackend` 인터페이스 + `setGateBackend`/`getGateBackend` 레지스트리를 두고, `private/packages/gate-backend`가 구현. public 측(hook 15종 + `mcp-server-core`)은 private를 직접 import하지 않고 `getGateBackend()`만 호출한다. public standalone 빌드(private 격리 후 `tsc --noEmit`)까지 검증됨.

핵심 seam은 호스트별 [`public/plugins/*/backend.ts`](../../public/plugins/claude-code/backend.ts) 단 4개 파일이다. 현재는 **phase 1 정적 import**로 `setGateBackend(transcodesGateBackend)`를 호출하며, tsup `noExternal`이 private 어댑터를 각 entry 번들에 **평문(plaintext)으로 inline**한다. 이 docstring이 3단계를 명시적으로 예고한다:

```
Phase 2 (CDN): replace the static import below with the loader that fetches
the obfuscated backend bundle from CloudFront, verifies it, and calls
setGateBackend — the getGateBackend() call sites do not change.
```

## 2. 문제 정의 (Problem)

목표는 **public 미러 리포를 외부에 공개**하는 것이다. 그러나 현재 상태로 공개하면 안 되는 이유:

1. **평문 누출** — 현재 plugin `dist/`에 private backend가 inline 평문으로 박혀 있다. 소스를 `private/`로 옮겨도 빌드 산출물이 누출되면 분리는 무의미하다(MEMORY: public/private split audit, "진짜 위험은 dist 번들 누출").
2. **런타임 분리 부재** — public이 동작하려면 backend가 필요한데, 현재는 빌드 타임에 결합돼 있어 "public만 공개"가 성립하지 않는다.
3. **공개 인프라 전무** — `git filter-repo` 미러 자동화, S3/CloudFront 배포, obfuscation 파이프라인, CDN 로더가 코드/인프라로 **하나도 존재하지 않는다**(워크플로는 `ci.yml`·`release.yml` 둘뿐).

## 3. 목표 / 비목표 (Goals / Non-Goals)

### Goals

- **G1** — 비공개 backend를 난독화된 단일 ESM 번들로 빌드하고, public dist에서 평문 inline을 제거한다.
- **G2** — 난독화 번들을 SHA384 무결성 매니페스트와 함께 S3/CloudFront CDN에 배포한다(메이저 버전 경로 분리).
- **G3** — `backend.ts` seam을 CDN 로더로 교체한다: fetch → SHA384 검증 → 로컬 캐시 → `import()` → `setGateBackend()`. **`getGateBackend()` 호출부는 0줄 변경.**
- **G4** — public→private import 경계 lint를 warn→**error**로 승격하되, `backend.ts` 단일 seam만 per-file override.
- **G5** — `git filter-repo`로 private 히스토리를 완전 제거한 public 미러를 `transcodes-guard` public repo로 자동 미러링한다.
- **G6** — public 미러 리포를 외부에 공개한다.

### Non-Goals

- **NG1** — Ed25519 코드 서명. v1은 SHA384 SRI만(근거: split.md §2.5 — 키 로테이션/폐기 운영부담이 큼, 실제 공급망 공격 사례 발생 시 추가).
- **NG2** — 게이트 정책의 *전면* 백엔드 이관. 본 PRD는 코드 분리/배포가 범위이며, 정책 서버 이관(Clerk 모델)은 상시 과제로 별도 추진(split.md §5.5).
- **NG3** — `@bigstrider/transcodes-cli`의 배포 방식 변경. CLI는 이미 별도 npm 발행 중이며 브랜드 리네임에서 제외됨(CLAUDE.md).
- **NG4** — 호스트 marketplace 등록/실제 plugin 발행 채널 확정. 배포 채널은 #19에서 보류 결정됨 — 본 PRD는 미러 공개까지가 범위.

## 4. 설계 개요 (Architecture)

```
[private 모노레포 — 이 리포, 영구 비공개]
  private/packages/gate-backend  ──①obfuscate build──▶  guard-<ver>.mjs (난독화 ESM)
                                                              │
                                                       ②SHA384 계산 + 매니페스트
                                                              │
                                                   ③S3 업로드 + CloudFront 무효화
                                                              ▼
                              cdn.transcodes.dev/guard/v1/guard-<ver>-<sha384>.mjs
                                                              ▲
                                                   ④런타임 fetch + 해시검증 + 로컬캐시
                                                              │
[public 미러 리포 — transcodes-guard, 외부 공개]              │
  public/plugins/*/backend.ts (CDN 로더) ──────────────────┘
       └─ fetch → verify(SHA384) → ~/.transcodes/cache/guard-<ver>-<sha384>.mjs → import() → setGateBackend()
  public/packages/* (gate-contract, mcp-server-core, ...) ── getGateBackend() 호출 (불변)
       ▲
  ⑤git filter-repo --invert-paths --path private/ 로 미러 생성 → public repo push
```

설계 불변식(invariant): **CDN 전환으로 바뀌는 것은 "누가 `setGateBackend()`를 호출하는가" 단 하나다.** public 소비자는 전부 `getGateBackend()`만 보므로 로더 도입은 `backend.ts` 4개 파일 교체로 끝난다(split.md §4.2, registry.ts docstring).

## 5. 워크스트림 (Workstreams)

권장 실행 순서: **A → B → C → E → D → F**. A~C가 "private를 CDN으로 빼는" 본체, E·D는 공개 직전 안전망, F가 마지막 스위치.

### A. 비공개 backend 난독화 빌드

| 항목 | 내용 |
|---|---|
| **요구사항** | `private/packages/gate-backend`를 단일 obfuscated ESM(`guard-<version>.mjs`)으로 빌드하는 별도 스크립트 신설 |
| **도구** | `javascript-obfuscator` — identifier mangling + control-flow flattening + string-array encoding + self-defending + dead code injection (split.md §2.4). 단순 `mangle`만으로는 불충분 |
| **산출물** | `cdn-dist/guard-<version>.mjs` (단일 파일, public dist와 분리된 경로) |
| **public dist 변경** | plugin 번들에서 private backend 평문 inline 제거 — backend.ts가 로더로 바뀌면 자연 해소(C와 연동) |
| **검증** | 산출물 grep으로 백엔드 URL/도구명/식별자 잔존 0건; 번들이 정상 `import()` 가능 |
| **수용 기준** | `npm run build:cdn`(가칭)이 결정적으로 동일 번들 생성, public dist에 private 식별자 누출 0 |

> 한계 명시: obfuscation은 "결국 클라이언트 코드는 풀린다"는 전제(split.md §2.4). 라이선스/표면 축소용이며 완전한 안티-리버스엔지니어링이 아님. 진짜 방어선은 NG2(정책 백엔드 이관).

### B. SHA384 매니페스트 + S3/CloudFront 배포

| 항목 | 내용 |
|---|---|
| **요구사항** | A 산출물의 SHA384를 계산 → (a) 로더 소스에 핀 상수로 박고 (b) 별도 매니페스트(JSON)로도 게시 |
| **CDN 경로** | 메이저 버전 단위 분리 `cdn.transcodes.dev/guard/v1/guard-<ver>-<sha384>.mjs` (split.md §4.3) |
| **인프라** | S3 버킷 + CloudFront 배포; `.github/workflows/`에 배포 워크플로 신규(S3 sync + CloudFront invalidation) |
| **무결성** | Node에 SRI 표준이 없으므로 `crypto.createHash('sha384')`로 자체 검증 구현(split.md §2.3, §2.5) |
| **미설계 세부** | 매니페스트 스키마(version/sha384/url 필드), 버전 핀 갱신 절차, CloudFront 캐시 정책(immutable + 해시 파일명) |
| **수용 기준** | 배포 워크플로가 번들 업로드 + 매니페스트 게시 + 무효화 완료, 게시된 SHA384가 로컬 계산값과 일치 |

### C. CDN 로더 구현 (`backend.ts` 교체)

| 항목 | 내용 |
|---|---|
| **요구사항** | `public/plugins/*/backend.ts`의 정적 import를 로더로 교체. 책임: fetch → SHA384 검증 → 로컬 캐시 → `import()` → `setGateBackend()` |
| **캐시 경로** | `~/.transcodes/cache/guard-<version>-<sha384>.mjs` — 이미 CLI가 관리하는 디렉토리. **반드시 `@transcodes-guard/plugin-paths`의 `cacheDir()`로 해석**(CLAUDE.md: 경로 하드코딩 금지) |
| **Node 제약** | HTTPS URL 직접 `import()` 불가 → 캐시 후 로컬 파일 `import()`가 유일한 현실안(split.md §2.3 방식 1) |
| **fallback 정책** | 네트워크 실패/검증 실패 시 거동. 게이트는 보안 컴포넌트 → **deny by default 또는 캐시된 마지막 검증본 사용** 결정 필요. 기존 `denyByDefaultBackend`(noop.ts)와 정합 검토 — 미주입 시 hook 경로 pass는 phase 1 미출하 전제였음, 출하 로더에서는 fail-closed 거동 재설계 필요 |
| **call site 불변** | `getGateBackend()` 호출부(mcp-server-core + hooks)는 변경 0 — seam 설계의 핵심 |
| **미설계 세부** | 캐시 무효화/TTL, 오프라인 폴백, 버전 핀 갱신, 동시성(여러 hook 동시 첫 fetch) |
| **수용 기준** | 캐시 미스→fetch→검증→주입 정상 동작; 검증 실패 시 안전 거동; 4개 호스트 23종 smoke 통과 |

### D. public 미러 자동화

| 항목 | 내용 |
|---|---|
| **요구사항** | `git filter-repo --invert-paths --path private/`로 private 히스토리를 완전 제거한 미러를 `transcodes-guard` public repo로 push하는 워크플로 |
| **타이밍 제약** | 공개 push 전에 디렉토리 분리가 끝나야 force-push 마찰이 없음 — **1단계로 이미 충족** (split.md §5.2) |
| **CLI tarball 예외** | CLI tarball 빌드 job은 **full repo에서** 실행(미러 아님) — tsup이 private deps를 inline해야 함(release-dist.md) |
| **검증 체크리스트** | private 히스토리 제거 확인, files allowlist, 백엔드 endpoint/도구명 잔존 grep, `--dry-run` filter-repo 사전 점검(mapping.md §검증) |
| **수용 기준** | 미러 리포에 `private/` 경로가 현재·과거 커밋 어디에도 없음; public만으로 빌드/타입체크 그린 |

### E. 경계 lint warn→error 승격

| 항목 | 내용 |
|---|---|
| **요구사항** | biome `noRestrictedImports`를 public→private import에 대해 **error**로 승격 |
| **예외** | `public/plugins/*/backend.ts` 단일 seam만 per-file override(의도적 private import 지점) |
| **배경** | 2단계에서 의도적으로 보류됨(#29 본문) — error 승격은 per-file override 선행 필요 |
| **수용 기준** | seam 외 public 파일이 private를 import하면 빌드 실패; CI에서 강제 |

### F. public 미러 공개

| 항목 | 내용 |
|---|---|
| **요구사항** | `transcodes-guard` public repo를 외부 공개로 전환 |
| **선행 조건** | A~E 전부 완료 + D 검증 체크리스트 그린 |
| **배포 채널** | 미러 리포 자체가 곧 배포 채널(호스트가 repo URL로 직접 plugin 설치, distribution.md). npm은 Claude Code 한정 선택 채널 |
| **수용 기준** | 공개 리포에서 호스트별 설치가 동작, CDN 로더가 backend를 정상 fetch |

## 6. 위험 (Risks)

| 위험 | 영향 | 완화 |
|---|---|---|
| CDN 침해/MITM으로 위조 번들 주입 | 게이트 우회 | SHA384 핀 검증(로더 소스 상수). 사례 발생 시 Ed25519 추가(NG1) |
| 로더 fail-open으로 게이트 무력화 | 보안 우회 | C의 fallback을 fail-closed로 설계, `denyByDefaultBackend` 거동 재검토 |
| obfuscation 우회(역난독화) | 로직 노출 | 1차 obfuscation + 2차 정책 백엔드 이관(NG2). "풀린다" 전제 수용 |
| filter-repo 누락으로 평문 히스토리 공개 | 비공개 코드 영구 노출 | `--dry-run` 사전 점검 + grep 체크리스트 + 공개 전 수동 감사 |
| 첫 fetch 지연이 hook 응답 시간에 영향 | UX 저하 | 캐시 우선, 설치/빌드 시 사전 fetch(warm cache) 검토 |
| CDN 장애 시 게이트 동작 불가 | 가용성 | 캐시된 검증본 재사용 + 오프라인 폴백 정책(C 미설계 세부) |

## 7. 미해결 질문 (Open Questions)

1. **로더 fallback 정책** — 검증 실패/오프라인 시 deny-by-default인가, 캐시된 마지막 검증본 사용인가? (보안 vs 가용성 트레이드오프)
2. **CDN 도메인** — `cdn.transcodes.dev`가 확정인가? S3+CloudFront vs 다른 조합?
3. **버전 핀 갱신 흐름** — 새 backend 배포 시 로더의 핀 상수를 어떻게 갱신/릴리스하는가? (`gate-contract` 메이저 bump와 연동?)
4. **로더 패키지 위치** — `@transcodes-guard/loader`를 별도 public 패키지로 둘지, `backend.ts` 인라인으로 둘지?
5. **public dist 평문 제거 타이밍** — A 완료 후 C 전까지 과도기에 public dist는 어떤 상태인가?
6. **CLI tarball의 private inline** — CLI는 여전히 private를 inline 발행하는데(MEMORY), 이는 CDN 모델 밖에 둘지 함께 전환할지?

## 8. 마일스톤 (Milestones)

| 마일스톤 | 워크스트림 | 산출물 |
|---|---|---|
| M1 — 난독화 빌드 | A | `npm run build:cdn`, obfuscated `guard-<ver>.mjs` |
| M2 — CDN 배포 | B | S3/CloudFront 인프라 + 배포 워크플로 + SHA384 매니페스트 |
| M3 — 로더 전환 | C | `backend.ts` 로더 교체, 23종 smoke 통과 |
| M4 — 경계 강제 | E | lint error 승격 + seam override |
| M5 — 미러 자동화 | D | filter-repo 미러 워크플로 + 검증 체크리스트 그린 |
| M6 — 공개 | F | `transcodes-guard` public repo 외부 공개 |
