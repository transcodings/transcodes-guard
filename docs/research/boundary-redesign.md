# 경계 재설계 리서치 — "코드 은닉"에서 "정책 데이터 + 결정 권한 보호"로

> Status: Proposal · Owner: huskyhoochu · Date: 2026-06-10
> 선행 문서: [`public-private-split.md`](./public-private-split.md) (2026-06 초안) · [`public-private-mapping.md`](./public-private-mapping.md)
> 본 문서는 phase3 v1(난독화 CDN 번들 + 미러) 노선을 폐기하고 v2(공개 클라이언트 + 정책 번들 + 라이선스)로 전환하는 근거를 정리한다. 잔여 실행 계획은 [`../prd/phase3-remaining.md`](../prd/phase3-remaining.md) 참조.

---

## 1. 왜 다시 조사했나 — v1의 전제 결함

split.md는 Stripe-loader 모델(§1.3, §5-4)을 장기안으로 채택하면서, 동시에 그 한계를 스스로 기록했다:

- §2.4: "결국 클라이언트 코드는 풀 수 있다는 전제 필요. (…) 2차 방어는 **로직 자체를 백엔드로 옮기기**(Clerk 식)."
- §5-5: "(상시) 게이트 평가의 *정책 결정*은 가능한 한 백엔드 HTTP API로 위임."

즉 v1은 "1차 방어(난독화)는 뚫리고 진짜 방어는 2차(백엔드 이관)"임을 알면서 1차에 L+L+M 규모(인프라·로더·미러)를 투자하는 계획이었다. 결정적으로, **그 사이 코드가 이미 2차 방어를 절반 구현했다**: 현 main의 `evaluate()`는 RBAC 판정을 백엔드에 묻고(`checkRbacPermission`, null이면 step-up 강제), step-up 승인 자체가 WebAuthn 백엔드 플로우다. 클라이언트에 남은 것은 "어떤 명령/도구가 어느 좌표(resource, action)에 해당하는가"의 **분류 데이터**뿐이다.

v1이 지키려던 것과 실제 비밀 가치의 불일치:

| v1이 숨기려던 것 | 실제 비밀 가치 | 이유 |
|---|---|---|
| 백엔드 API 래퍼(transcodes-mcp-tools) | 없음 | 엔드포인트·요청 형태는 네트워크에서 관찰됨 (split.md OQ8 스스로 인정) |
| tool-rules 정책(danger-rules) | 낮음 | 게이트는 deny 시 사유를 에이전트에 설명해야 함 — 정책은 런타임에 설계상 노출 |
| 게이트 평가 기계(stepup-core) | 없음(역효과) | 셸을 들여다보는 코드의 불투명성은 신뢰 훼손 — 감사 가능성이 곧 채택 근거 |
| 결정 권한(RBAC·step-up) | **높음** | 이미 백엔드에 있음 — 숨길 필요 없이 *서버에 있어서* 보호됨 |

## 2. 리서치 ① — 개방 클라이언트 + 폐쇄 컨트롤 플레인 (2026-06-10, full)

> 질의: OPA 정책 번들 배포(서명·로컬 평가·오프라인 폴백) / Tailscale·Teleport 개방 클라이언트 모델 / 로컬 CLI 훅의 PDP·PEP 분리(지연·캐시·fail-closed). 1차 출처 10건 추출(Tailscale 공식 3, OPA 공식 2, Gusto 실측, agentpatterns, CodiLime, HN/SO/Substack).

### 2.1 종합 판단 (확신도: 높음)

업계 증거는 **"클라이언트 전부 공개 + 테넌트 정책 데이터(서명·캐시) + 서버 측 결정 권한을 보호 자산으로 삼는" 모델을 일관되게 지지**하며, 난독화 클라이언트로 성립한 보안 제품 사례는 수집된 전 출처에서 **0건**이었다.

### 2.2 핵심 근거

1. **가치의 위치 (Tailscale 동형성)** — Tailscale은 요청 경로에 앉는 클라이언트 데몬·DERP 서버·wireguard-go를 전부 공개하고 **코디네이션 서버(컨트롤 플레인)만 폐쇄**한다. 폐쇄 GUI는 "폐쇄 OS의 래퍼"라는 실무 사유다. 컨트롤 플레인 프로토콜을 재구현한 headscale이 존재해도 "보완재"로 공인하며 상업적으로 성공 — 해자가 운영 서비스(SSO·감사·컴플라이언스)에 있기 때문. 우리의 "게이트 코드 공개 + step-up 판정·테넌트 정책·감사 백엔드"와 동형이다. ([opensource](https://tailscale.com/opensource) · [blog](https://tailscale.com/blog/opensource) · [control/data planes](https://tailscale.com/docs/concepts/control-data-planes))
2. **정책은 코드가 아니라 데이터로 배포 (OPA 번들)** — gzip tarball을 주기 폴링으로 수신, **서명(keyid/scope) 검증 후 활성화**, 로컬 평가, `persist: true`로 오프라인 시 last-known-good 유지. 폴링 예시 10–20s/30–120s, 롱폴링 10s. OPA Control Plane은 정책 거버넌스를 오브젝트 스토리지 배포로 분리한 공식 레퍼런스. ([bundles](https://www.openpolicyagent.org/docs/management-bundles) · [OCP](https://www.openpolicyagent.org/docs/ocp))
3. **지연 예산** — 인-클러스터 원격 인가도 왕복 ~3ms, 직렬 100건이면 +300ms ([Gusto](https://engineering.gusto.com/super-scaling-open-policy-agent-with-batch-queries-4fb9c0484ce4)); 임베디드 평가면 sub-µs ([Korolev](https://dimakorolev.substack.com/p/open-policy-agent-musings)). → **분류(위험 여부)는 로컬 정책 데이터로, 승인(step-up)은 서버 권한으로.** 우리 hook 임계 경로의 원격 왕복은 어차피 사람이 기다리는 WebAuthn 경로에만 존재하므로 ms 비용은 무의미하다.
4. **fail-closed 선례가 호스트 플랫폼에 있음** — Claude Code managed settings: 기본은 캐시 폴백(fail-open 창 존재), `forceRemoteSettingsRefresh: true`로 fail-closed("정책 검증 불가 = 차단", TLS hard-fail 비유). 캐시 자가영속 + break-glass 절차 동반이 조건. ([agentpatterns](https://agentpatterns.ai/security/fail-closed-remote-settings-enforcement/))
5. **개발자 수용성** — "오픈소스를 진짜 신경 쓰는 건 소수"라는 냉소가 HN에 있으나, 그 소수가 보안 도구의 도입 결정 계층이고, *서버 측* 폐쇄에조차 headscale·"Tailscale 해킹되면?"(r/Tailscale 128pt) 수준의 불신이 실재한다. 셸 접근 권한을 가진 **로컬** 난독화 블롭은 그보다 강한 거부 지점. ([HN](https://news.ycombinator.com/item?id=43563396))

### 2.3 운영 파라미터 (Unit G 입력)

| 항목 | 업계 수치 | 우리 적용 |
|---|---|---|
| 번들 폴링 | OPA 10–120s (상주 데몬 전제) | hook은 단명 프로세스 → 폴링 불가. **SessionStart 계열 훅 + MCP 서버 기동 시 TTL 기반 refresh** |
| 서명 | keyid/scope 검증 후 활성화 | 1차 TLS+SHA-384 manifest, Ed25519 detached sig는 후속 (D3) |
| 오프라인 | `persist: true` last-known-good + 스테일 모니터링 | 캐시 TTL 내 사용, 만료+불가 시 gated 좌표 deny (G §fail-closed 매트릭스) |
| 원격 인가 지연 | 왕복 ~3ms/콜, 배치 시 166µs | 분류는 로컬, 원격은 step-up 경로에만 |
| 캐시 신선도 | 정책 변경 후 ~5s 반영 이상 (gematik PDP) | 우리는 TTL 1h급으로 충분 (정책 변경 빈도 낮음, 강제 갱신 경로 별도) |

## 3. 리서치 ② — 공개 소스의 상업 보호: source-available 라이선스 (2026-06-10, brief)

> 질의: BSL/BUSL vs FSL vs ELv2 vs PostHog-식 ee/ 이중 라이선스 — 금지 범위·OSS 전환·집행 실적·반발. 1차 출처: Sentry FSL 공식, Elastic licensing FAQ, FOSSA/Goodwin 분석.

### 3.1 비교

| 모델 | 경쟁 서비스 금지 | 라이선스 체크 우회 금지 | OSS 자동 전환 | 반발 |
|---|---|---|---|---|
| **BSL/BUSL 1.1** | Additional Use Grant로 정의 (보통 no-SaaS) | 별도 조항 필요 | **4년 내** GPL-호환으로 (버전별) | 중~상 (HashiCorp→OpenTofu 포크) |
| **FSL** (Sentry) | "Protected Use" — 경쟁 용도 금지 | 별도 조항 필요 | **2년 후** Apache-2.0/MIT (DOSP) | 약 (시한부 OSS 약속이 명시적) |
| **ELv2** | 명시적 금지 | **명시적 금지** (유일) | 없음 (영구 source-available) | 상 (OpenSearch 포크) |
| **ee/ 이중** (PostHog) | ee/만 금지 | ee/ 라이선스에 명시 | 없음 (제품 결정) | 최소 (core가 진짜 OSS) |

### 3.2 판단: **FSL 권고** (확신도: 보통 — 최종은 사업 결정 D1)

- dev-tool 회사(Sentry)가 정확히 우리 상황(클라이언트 코드가 사용자 머신에서 읽힘)을 위해 설계했고, "2년 뒤 Apache-2.0"이라는 명시적 시한이 커뮤니티 반발을 가장 적게 만든 실적이 있다.
- BUSL은 Additional Use Grant 설계 자유도가 높지만 HashiCorp 선례의 평판 비용이 있고, ELv2는 OSS 전환이 없어 "감사 가능성 = 신뢰" 서사와 어긋난다.
- ee/ 이중 모델은 core/ee 경계 유지 비용이 우리 규모에 과함 — 우리는 ee에 둘 코드 자체가 사라지는 방향(§1)이다.

### 3.3 "엔진 공개 + 정책 데이터 비공개"의 법적 성립

확립된 패턴이다 (OPA·Cerbos·OpenFGA 생태계): **소프트웨어 라이선스는 코드를, 테넌트 정책·데이터는 별도 계약(SaaS 약관·DPA)이 지배한다.** 정책을 코드베이스에 굽지 않고 런타임 입력/외부 스토어로 분리하면, 엔진이 어떤 라이선스든 정책 데이터는 라이선스 대상 밖이다. AWS의 OPA 가이드도 테넌트 데이터를 장수 base document로 박지 말고 결정 시점 입력으로 넘기라고 권고. ([AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-api-access-authorization/opa-design-isolation.html) · [FOSSA](https://fossa.com/blog/comprehensive-guide-source-available-software-licenses/) · [Sentry FSL](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/))

## 4. 결론 — v2 경계 정의

**보호 자산 3종** (모두 코드 은닉 불필요):

1. **조직 정책 데이터** — 시스템 tool-rules + 조직 커스텀 룰. 코드/번들에 굽지 않고 백엔드가 org-scoped로 런타임 배포 (서명·캐시·fail-closed). → Unit G
2. **결정 권한** — RBAC 판정·step-up 승인·감사 로그. 이미 백엔드. 잔여 갭(좌표 불일치 폴백, 결정 감사)만 봉합. → Unit H
3. **상업적 재사용 금지** — 보이는 코드의 경쟁적 재사용은 기술이 아니라 **라이선스(FSL 권고)**가 막는다. → Unit I

**공개 자산** (감사 가능성 = 신뢰 = 채택): 게이트 엔진(stepup-core), 훅 4종, 어댑터, MCP 셸, admin tool 래퍼, CLI. — `GateBackend` DI seam은 코드 경계로서 유지한다(테스트 주입·구현 교체 가치). 사라지는 것은 "seam 너머가 비밀"이라는 전제뿐이다.

**v1 자산 처분**: A(난독화 빌드)는 Done이나 산출물 보류(shelved). B·C·D·F는 superseded — 근거는 본 문서, 대체는 G·H·I·J.

## 5. 반론과 한계 (성실성 기록)

- **"난독화도 겹겹 방어의 한 겹 아닌가"** — 겹의 비용이 문제다: CDN 인프라 + fail-closed 로더 재설계 + 미러 자동화(L+L+M)와 신뢰 훼손을 지불하고 얻는 것이 "어차피 풀리는 한 겹"(split.md §2.4 자인)이다. 같은 예산이면 G(정책 분리)·H(권한 봉합)가 방어 기여가 크다.
- **위험 패턴 레지스트리 자체가 경쟁 우위라면** — 리서치 ①의 미비점. 탐지 회피 우려(공격자가 패턴을 읽고 우회)는 정규식 기반 baseline에선 본질적 한계고, 대응은 은닉이 아니라 서버 측 분류 보강이다. 단, 조직 커스텀 룰은 org-scoped 데이터라 이미 비공개(G).
- **기존 npm 발행분** — CLI tarball에 구 정책이 inline돼 이미 발행됨(MEMORY). 과거 버전의 비밀성은 어차피 소실 — v2로 잃는 것이 없다는 방증이기도 하다.
- **뒤집힐 조건** — ① 탐지 *알고리즘*(예: 자체 분류 모델)이 서버 이관 불가한 핵심 가치로 등장 → C안(비공개 npm 플러그인) 재검토. ② 완전 오프라인 운영이 핵심 요구가 됨 → 서버 권한이 보호 자산 역할을 못 하므로 전략 재구성. ③ 경쟁사가 FSL 위반으로 무단 SaaS를 띄우고 집행이 실패하는 사례 발생 → 법적 보호 가정 재평가.

## 6. 출처

리서치 ① (아키텍처): [Tailscale opensource](https://tailscale.com/opensource) · [Tailscale blog](https://tailscale.com/blog/opensource) · [Tailscale control/data planes](https://tailscale.com/docs/concepts/control-data-planes) · [OPA Bundles](https://www.openpolicyagent.org/docs/management-bundles) · [OPA OCP](https://www.openpolicyagent.org/docs/ocp) · [agentpatterns fail-closed](https://agentpatterns.ai/security/fail-closed-remote-settings-enforcement/) · [CodiLime OPA AI agents](https://codilime.com/blog/why-use-open-policy-agent-for-your-ai-agents/) · [Gusto batch OPA](https://engineering.gusto.com/super-scaling-open-policy-agent-with-batch-queries-4fb9c0484ce4) · [Styra fail-open](https://docs.styra.com/das/observability-and-audit/monitoring/fail-open-mitigation) · [HN headscale](https://news.ycombinator.com/item?id=43563396) · [Korolev OPA musings](https://dimakorolev.substack.com/p/open-policy-agent-musings) · [SO OPA S3 bundle](https://stackoverflow.com/questions/68088930)

리서치 ② (라이선스): [Sentry FSL 발표](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/) · [open.sentry.io/licensing](https://open.sentry.io/licensing/) · [Elastic licensing FAQ](https://www.elastic.co/pricing/faq/licensing) · [Elastic 변경 해설](https://www.elastic.co/blog/license-change-clarification) · [FOSSA source-available 가이드](https://fossa.com/blog/comprehensive-guide-source-available-software-licenses/) · [FOSSA BSL](https://fossa.com/blog/business-source-license-requirements-provisions-history/) · [Goodwin 라이선스 동향](https://www.goodwinlaw.com/en/insights/publications/2024/09/insights-practices-moving-away-from-open-source-trends-in-licensing) · [AWS OPA 테넌트 격리](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-api-access-authorization/opa-design-isolation.html) · [InfoQ FSL](https://www.infoq.com/news/2023/12/functional-source-license/) · [TechCrunch FSL](https://techcrunch.com/2023/11/20/with-functional-source-license-sentry-wants-to-grant-developers-freedom-without-harmful-free-riding/)
