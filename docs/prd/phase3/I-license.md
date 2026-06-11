# Phase 3 v2 / Unit I — 라이선스 전환 + private/ 해체

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M9
> 규모: **M** · 선행: [G](./G-policy-bundle.md) (정책 데이터가 코드에서 분리된 후) · 외부 의존: **D1 라이선스 결정(human, 사업)** · 상태: ⚠️ **Gated (결정)**
> 근거: [`boundary-redesign.md`](../../research/boundary-redesign.md) §3 (FSL 권고 + "엔진 공개·데이터 비공개"의 법적 성립)

## 규모 산정

- **M (Medium)** — 1~2 PR + 사업 결정 1건 + 워크스페이스 재배치. 코드 로직 변경은 거의 없음(이동·메타데이터·규칙 정리).
- 리스크: 라이선스는 **한 번 공개하면 해당 버전에 비가역**. D1은 대표 승인 필수.

## 요구사항

보이는 코드의 상업적 보호를 기술(난독화)이 아니라 **라이선스**로 전환하고, "비밀"이 사라진 `private/` 구분을 해체한다.

## D1 — 라이선스 선택 (human 결정, 본 단위의 게이트)

권고: **FSL-1.1-Apache-2.0** — 2년 후 해당 버전이 Apache-2.0으로 자동 전환(DOSP). 경쟁 SaaS·대체 서비스 제공은 "Protected Use"로 금지. dev-tool 선례(Sentry)와 가장 낮은 커뮤니티 반발 실적.

| 선택지 | 전환 | 비고 |
|---|---|---|
| **FSL-1.1-Apache-2.0 (권고)** | 2년 → Apache-2.0 | 시한부 OSS 약속이 신뢰 서사와 정합 |
| BUSL-1.1 | ≤4년 → GPL-호환 | Additional Use Grant 설계 자유도 ↑, HashiCorp 평판 비용 |
| ELv2 | 없음(영구) | 라이선스 키 우회 금지 조항 명시적, OSS 전환 부재 |

결정 시 함께 확정: ① 기존 기여자 동의 절차(현재 사실상 사내 단일 — 간단) ② npm 발행 패키지의 `license` 필드 일괄 갱신 ③ 외부 기여 수령 정책(CLA 여부).

## private/ 해체 + flatten (G 완료 후)

G로 정책 데이터가 분리되면 `private/packages/*`에 남는 것은 전부 "공개 가능한 클라이언트 코드"다. 이때 `private/`가 사라지면 `public/`은 대비 개념을 잃으므로 **한 단계를 통째로 flatten한다** — 1단계 이전의 원형 레이아웃으로 회귀하되, DI seam과 lint 경계는 유지한 채로:

```
public/packages/* + private/packages/*  →  packages/*
public/plugins/*                        →  plugins/*
private/cli                             →  cli
```

- 루트 `workspaces`: `["public/packages/*", "public/plugins/*", "private/packages/*", "private/cli"]` → `["packages/*", "plugins/*", "cli"]`. **turbo.json은 변경 불필요** — Turborepo는 워크스페이스를 패키지 매니저(npm `workspaces` glob)에서 읽고, 패키지 인식 조건은 "glob 매치 + `name` 있는 package.json"뿐이다.
- 이동은 `git mv`(rename 추적 유지). scope 리네임: `@transcodes-guard-private/*` → `@transcodes-guard/*`.
- 경로 참조 일괄 갱신: biome overrides(`public/plugins/*/backend.ts` → `plugins/*/backend.ts`), CI 워크플로 경로, tsup/tsconfig 상대 경로, CLAUDE.md.
- **유지하는 것**: `GateBackend` DI seam(backend.ts 4개) — 비밀 경계가 아니라 코드 경계(테스트 주입·구현 교체)로 재정의. seam 구조는 바꾸지 않는다(2단계 불변식).

최종 구조(J 이후):

```
transcodes-guard/              ← 리포 전체 공개 (FSL)
├── packages/                  공유 라이브러리: gate-contract · gate-backend ·
│                              stepup-core(+policy-bundle) · danger-patterns ·
│                              danger-rules · hook-adapters · mcp-server-core ·
│                              plugin-paths
├── plugins/                   claude-code · codex · antigravity · cursor
│                              (각 backend.ts seam 유지)
├── cli/                       @bigstrider/transcodes-cli (이름·bin 유지)
└── scripts/ docs/ ...         build-cdn.mjs는 shelved 보존
        │
        └─ (네트워크 경계 = 신뢰 경계) → transcode-backend-nestjs-v1 [비공개]
                                          정책 번들 API(G) · RBAC/step-up/감사(H)
```

## 경계 규칙 정리 (E 산출물의 운명)

E(#48)가 승격한 biome `noRestrictedImports`는 private scope 소멸과 함께 대상을 잃는다:

- 규칙을 제거하지 말고 **재조준**: "`gate-backend` 구현 패키지는 seam(backend.ts) 외에서 import 금지"라는 *아키텍처* 규칙으로 존속(scope 이름만 갱신). DI 우회 import를 계속 막는다.
- publish-surface CI 게이트(`"private": true` 강제)는 npm 발행 통제 목적이 남는 패키지에만 잔존(발행 대상은 `publishConfig`로 명시 — split.md §3.2 files allowlist 권고 이행).

## 부수 정리

- README/docs의 "비공개" 서술 갱신 + LICENSE 파일 배치(루트 + 패키지별 `license` 필드).
- `cdn-dist/`·`build:cdn`(A 산출물): 스크립트는 보존(shelved), README에서 비참조화.
- biome 메시지·CLAUDE.md의 경계 서술을 I 이후 상태로 갱신.

## blocking / 관련 결정

- **D1 (blocker)** — 위. 결정 전 착수 불가(이동 자체가 라이선스 헤더와 엮임).
- G 선행 — 정책 데이터가 코드에 남은 채 이동하면 "조직 정책 비공개"(보호 자산 1)가 깨진다.

## 수용 기준

- [ ] 루트 LICENSE + 전 패키지 `license` 필드 일관(D1 결정 반영).
- [ ] `private/`·`public/` 디렉토리 부재(flatten 완료), 루트 `workspaces` 3-glob, 빌드·type-check·23종 smoke green.
- [ ] seam 외 `gate-backend` import 시 biome error(재조준된 규칙) 유지.
- [ ] npm 발행 표면: 발행 패키지의 tarball에 LICENSE 포함 + `files` allowlist 점검(`npm publish --dry-run` CI step — split.md §3.2).

## 산출 파일(예상)

- `LICENSE` (루트) + 패키지별 `package.json` 갱신
- flatten 이동 diff (`git mv` — `packages/*`·`plugins/*`·`cli`, scope 리네임, 루트 `workspaces` 갱신)
- `biome.json` 경계 규칙 재조준(override 경로 포함) · CI publish-surface 게이트 조정
- CLAUDE.md / README 갱신
