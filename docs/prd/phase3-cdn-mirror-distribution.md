# PRD — 3단계 v2: 경계 재설계 — 정책 번들 분리 + 서버 결정 권한 + 라이선스 공개 (인덱스)

> Status: Draft v2 · Owner: huskyhoochu · Last updated: 2026-06-10
> 선행 단계: 1단계(디렉토리 분리, #24→#28 완료) · 2단계(`GateBackend` DI 경계, #29 완료)
> 근거 문서: [`docs/research/boundary-redesign.md`](../research/boundary-redesign.md) (**v2 전환 근거**) · [`public-private-split.md`](../research/public-private-split.md) · [`multi-host-plugin-distribution.md`](../research/multi-host-plugin-distribution.md)

> **이 문서는 인덱스다.** 워크스트림별 상세·규모·수용 기준은 [`phase3/`](./phase3/) 하위 개발 단위 문서에 있다.

---

## 0. v1 → v2 경위

v1(2026-06-08 초안)은 "비공개 backend를 난독화 CDN 번들로 빌드(A·B), 로더로 주입(C), filter-repo 미러로 공개(D·F)" 노선이었다. **A([#44](https://github.com/transcodings/ai-action-tracker-mcp/pull/44))와 E([#48](https://github.com/transcodings/ai-action-tracker-mcp/pull/48)) 완료 후, B~D·F를 폐기하고 v2로 전환한다.** 근거([boundary-redesign.md](../research/boundary-redesign.md) 상세):

1. **숨기려던 것에 비밀 가치가 없다** — API 래퍼는 네트워크에서 관찰되고, 정책은 deny 메시지로 설계상 노출되며, 게이트 기계의 불투명성은 신뢰를 깎는다. 진짜 가치(RBAC 판정·step-up 승인)는 **이미 백엔드에 있다**(`evaluate()`의 `checkRbacPermission` 경로).
2. **업계 선례 0건** — 난독화 클라이언트로 성립한 보안 제품 사례를 찾지 못함. 반대로 Tailscale(개방 데몬+폐쇄 컨트롤 플레인), OPA(서명 정책 번들), Sentry(FSL)가 같은 구조에 수렴.
3. **v1 스스로의 자인** — split.md §2.4 "결국 풀린다", §5-5 "정책 결정은 백엔드로". 1차 방어가 뚫린다는 걸 알면서 L+L+M을 투자하고, 셸을 보는 훅이 "CDN에서 받은 난독화 블롭"을 실행하는 신뢰 비용까지 지불하는 계획이었다.
4. **OQ 8개 중 6개가 노선 자체가 만든 문제** — 로더 fallback(OQ1), CDN 도메인(OQ2), 버전 핀(OQ3), 로더 위치(OQ4), 평문 타이밍(OQ5), 인코딩(OQ8)은 v2에서 소멸한다(§7).

## 1. 배경 (v1에서 유지되는 사실)

- 1단계 완료 — `public/` ↔ `private/` 물리 분리, publish-surface CI 게이트.
- 2단계 완료 — `GateBackend` DI: public 측은 `getGateBackend()`만 호출, seam은 `public/plugins/*/backend.ts` 4개. **이 seam은 v2에서도 코드 경계로 유지한다**(테스트 주입·구현 교체 가치). 사라지는 것은 "seam 너머가 비밀"이라는 전제다.
- E 완료(#48) — seam 외 public→private import는 biome error.
- 현 main의 결정 경로: 패턴/룰 매치(로컬 데이터) → verified 캐시(로컬) → **RBAC 판정(백엔드)** → **step-up 승인(백엔드 WebAuthn)**. 즉 결정 권한의 서버 이전은 절반 완료 상태.

## 2. 문제 정의 (v2)

목표는 변함없이 **외부 공개**다. 공개를 막는 진짜 문제는 "코드 평문"이 아니라:

1. **정책 데이터가 코드에 구워져 있다** — 시스템 tool-rules가 `private/packages/danger-rules/src/data/tool-rules.json`으로 번들에 inline. 조직별 정책 차등화·즉시 갱신·테넌트 비공개가 모두 불가능하다.
2. **결정 권한에 로컬 우회 잔재** — `rbac-check.ts`의 좌표 불일치 시 `payload[0]` 차용(다른 좌표의 권한으로 판정), 게이트 결정의 서버 측 감사 부재.
3. **보이는 코드의 상업적 보호 수단 부재** — 공개 시 경쟁적 재사용(무단 SaaS·재배포)을 막을 법적 장치가 없다.

## 3. 목표 / 비목표

### Goals

- **G1** — 시스템/조직 정책을 코드에서 분리해 백엔드가 org-scoped **정책 번들**로 런타임 배포한다(서명·캐시·fail-closed). → [G](./phase3/G-policy-bundle.md)
- **G2** — 결정 권한의 잔여 갭을 봉합한다(좌표 불일치 fail-closed, 결정 감사 로그). → [H](./phase3/H-server-decision.md)
- **G3** — source-available 라이선스(FSL 권고)를 채택하고 `private/` 구분을 해체한다. → [I](./phase3/I-license.md)
- **G4** — 리포를 외부 공개한다(히스토리 시크릿 스캔 후 직접 공개 또는 filter-repo 1회). → [J](./phase3/J-public-flip.md)

### Non-Goals

- **NG1** — 클라이언트 코드 은닉(난독화·CDN 로더). v1에서 폐기.
- **NG2** — 위험 *분류 알고리즘*의 서버 이관. 분류는 로컬 정책 데이터 평가로 충분하다(원격 왕복 ~3ms/콜이 모든 tool call에 누적되는 구조 금지 — Gusto 실측). 서버는 *판정·승인·감사*만 맡는다.
- **NG3** — Ed25519 서명 인프라. 1차는 TLS+SHA-384 manifest, 키 관리는 실제 위협 등장 시(D3).

## 4. 아키텍처 (v2)

```
[Transcodes 백엔드 — 폐쇄 (유일한 비밀 위치)]
  정책 번들 API: org-scoped tool-rules/patterns + revision + SHA-384 manifest     [G]
  RBAC 판정: POST /auth/role/check-permission (기존)                              [H]
  step-up 승인: WebAuthn temp-session (기존) · 결정 감사 로그(신설)               [H]
                       ▲ 토큰 인증 fetch / 판정 질의
                       │
[클라이언트 — 전부 공개, FSL]                                                     [I]
  SessionStart/서버 기동: 번들 TTL refresh → SHA-384 검증 → ~/.transcodes/cache   [G]
  PreToolUse hook: 내장 baseline + 캐시된 org 번들로 분류(로컬, 동기) ──┐
  getGateBackend() 호출부 불변 · backend.ts seam 유지(정적 import)      │
                       ┌────────────────────────────────────────────────┘
                       ▼ 위험 좌표일 때만
  RBAC level 질의(백엔드) → 0 deny / 1 allow / 2 step-up(WebAuthn) → 결정 감사    [H]

[리포 — 공개]                                                                     [J]
  히스토리 시크릿 스캔 → (통과) 본 리포 직접 공개 | (실패) filter-repo 1회
```

설계 불변식: **(1)** `getGateBackend()` 호출부 불변(2단계 seam 유지). **(2)** hook 임계 경로에 신규 동기 네트워크 호출 0 — 번들 refresh는 SessionStart 계열에서만, 원격 판정은 기존 RBAC/step-up 경로에만. **(3)** 정책 없는 상태의 바닥 보호: 내장 baseline(공개 danger-patterns + 최소 시스템 룰)은 번들과 무관하게 항상 동작.

## 5. 개발 단위

| 단위 | 제목 | 규모 | 선행 | 외부 blocker | 상태 |
|---|---|:--:|---|---|---|
| [A](./phase3/A-obfuscate-build.md) | ~~난독화 빌드~~ | M | — | — | 🎉 Done (#44) · **산출물 보류** |
| [B](./phase3/B-cdn-deploy.md) | ~~CDN 배포~~ | — | — | — | 🗑 **Superseded** → G |
| [C](./phase3/C-cdn-loader.md) | ~~CDN 로더~~ | — | — | — | 🗑 **Superseded** → G |
| [D](./phase3/D-mirror-automation.md) | ~~미러 자동화~~ | — | — | — | 🗑 **Superseded** → J |
| [E](./phase3/E-lint-promotion.md) | 경계 lint error 승격 | S | — | 없음 | 🎉 **Done** (#48) |
| [F](./phase3/F-public-release.md) | ~~미러 공개~~ | — | — | — | 🗑 **Superseded** → J |
| [G](./phase3/G-policy-bundle.md) | **정책 번들 분리** | **L** | — | 백엔드 API 1본(사내) | ✅ **Ready** |
| [H](./phase3/H-server-decision.md) | **결정 권한 봉합** | **S** | — | 감사 API(사내, 부분) | ✅ **Ready** |
| [I](./phase3/I-license.md) | **라이선스 + private/ 해체** | **M** | G | **D1 라이선스 결정(human)** | ⚠️ Gated(결정) |
| [J](./phase3/J-public-flip.md) | **공개 전환** | **S**(human) | G·H·I | D4 히스토리 처분 | 🚫 Gated |

**권장 실행 순서: G·H(병렬 가능) → I(D1 결정 후) → J.** 지금 착수 가능 = **G와 H**. v1과 달리 외부 인프라(AWS·도메인) 의존이 0이고, 유일한 외부 의존은 자사 백엔드 API다.

## 6. 위험 — 마스터

| 위험 | 영향 | 완화 | 소관 |
|---|---|---|---|
| 번들 위조/MITM | 잘못된 정책 주입 | TLS + SHA-384 manifest 검증 후 활성화(OPA 패턴). 실위협 시 Ed25519(D3) | G |
| 백엔드 불가 시 게이트 무력화 | fail-open 우회 | last-known-good 캐시(TTL 내) → 만료 시 gated 좌표 deny + 내장 baseline 상시 동작. break-glass = CLI 비대칭 disable(기존 규칙) | G |
| 정책 공개로 탐지 회피 | 패턴 우회 | baseline 정규식의 본질적 한계로 수용. 조직 커스텀 룰은 org-scoped 비공개 데이터. 회피 시도 자체가 감사 로그에 남음 | G·H |
| 라이선스 위반(무단 SaaS) | 상업 가치 침식 | FSL Protected Use 집행(Sentry 선례). 기술 차단 아님을 명시적으로 수용 | I |
| 히스토리에 시크릿 잔존 | 자격증명 노출 | gitleaks/trufflehog 전수 스캔 → 발견 시 filter-repo + 로테이션 | J |
| 기발행 npm tarball의 구 정책 inline | 과거 버전 노출 | 비밀 아님으로 재분류(v2 전제). 신규 버전부터 G 반영 | G·I |

## 7. v1 OQ 처분표

| v1 OQ | 처분 |
|---|---|
| OQ1 로더 fallback | **소멸**(로더 없음). fail-closed 설계는 G §fail-closed 매트릭스로 이전 |
| OQ2 CDN 도메인 | **소멸** |
| OQ3 버전 핀 갱신 | **소멸**. 정책 번들 `revision`으로 대체(G) |
| OQ4 로더 위치 | **소멸** |
| OQ5 평문 제거 타이밍 | **재정의**: 코드 평문은 비밀 아님. 제거 대상은 정책 데이터뿐(G) |
| OQ6 CLI tarball inline | I에서 라이선스로 해소(코드는 FSL 보호, 정책은 G로 분리) |
| OQ7 CLI 미러 포함 | **소멸**(미러 없음, 전부 공개) |
| OQ8 obfuscator 인코딩 | **소멸** |

## 8. 신규 결정 게이트 (v2)

1. **D1 — 라이선스 선택** (human, 사업 결정) → blocks **I**. 권고: FSL-1.1-Apache-2.0(2년 DOSP). 대안: BUSL-1.1(4년, Grant 유연) / ELv2(영구). 근거: boundary-redesign.md §3.
2. **D2 — 시스템 tool-rules의 기밀성** → affects **G·J**. 권고: 비밀 아님(deny 메시지로 노출되는 데이터). 조직 커스텀 룰만 org-scoped 비공개.
3. **D3 — 번들 무결성 방식** → affects **G**. 권고: TLS + SHA-384 manifest로 시작, detached signature는 후속.
4. **D4 — 히스토리 처분** → blocks **J**. 시크릿 스캔 결과로 결정: 통과 시 직접 공개, 실패 시 filter-repo 1회 + 자격증명 로테이션.

## 9. 마일스톤

| 마일스톤 | 단위 | 산출물 | 규모 | 상태 |
|---|---|---|:--:|---|
| M1 — ~~난독화 빌드~~ | A | (보류) `build:cdn` | M | Done·shelved |
| M4 — 경계 강제 | E | lint error + seam override | S | Done (#48) |
| **M7 — 정책 번들** | G | 번들 API 계약 + fetch/검증/캐시 + fail-closed + 23종 smoke 갱신 | L | Ready |
| **M8 — 결정 봉합** | H | rbac-check fail-closed + 결정 감사 | S | Ready |
| **M9 — 라이선스** | I | LICENSE 전환 + private/ 해체 + 경계 규칙 정리 | M | Gated(D1) |
| **M10 — 공개** | J | 히스토리 스캔 + repo 공개 + 4호스트 설치 검증 | S | Gated |
