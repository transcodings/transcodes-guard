# AI 보안/감사 MCP 경쟁 환경 — 우리 제품에 추가할 부가 tool 브레인스토밍

> 날짜: 2026-05-07 (Asia/Seoul) | 키워드: AI security/audit MCP servers — competitive landscape & feature ideas for `ai-action-tracker-mcp`

## 한줄 요약

엔터프라이즈 게이트웨이(Cloudflare/Datadog/MCP Manager)는 **인증·감사 로깅·프롬프트 인젝션 탐지**를 표준으로 제공하지만, 우리 제품의 차별점인 **bash 명령 의미 분석(rm -rf + git ls-files)** 은 거의 어떤 벤더도 다루지 않는 미충족 영역이며, 다음 단계로는 **Secrets 차단 → 감사 트레일 emit → 파일 변경 델타 로깅 → 정책 YAML** 순으로 PreToolUse/PostToolUse 양 축을 채우고 MCP 서버 측에는 "위험 프로파일 조회"형 advisory tool을 추가하는 것이 가장 합리적이다.

## 핵심 발견사항

| # | 발견사항 | 소스 유형 | 신뢰도 |
|---|---------|----------|--------|
| 1 | 거의 모든 보안 MCP 제품이 **OAuth 2.1 + 감사 로깅 + 프롬프트 인젝션 탐지** 를 baseline으로 묶어 판매한다 | Cloudflare 공식문서, Datadog 블로그, Integrate.io, MCP Manager | 높음 |
| 2 | **Bash 명령 자체에 대한 의미적 차단**(예: `rm -rf` 타깃을 절대 경로 + git tracked 여부로 판정)을 다루는 벤더는 사실상 없음 — 우리 제품의 코어 차별점 | Perplexity reason cross-source, awesome-claude-code-security 분석 | 높음 |
| 3 | **Secrets/credential 패턴 탐지**는 Datadog redaction과 Snyk MCP guardrails가 언급하지만, PreToolUse 단계의 "차단" 형태로 제공하는 곳은 거의 없고 대부분 egress redaction 수준 | Snyk, Datadog, Enkrypt | 보통 |
| 4 | **Audit trail emission**(JSON-Lines → SIEM)은 Dashlane, MintMCP, Arcade, MCP Manager가 모두 제공 — 표준 기능. 우리 제품엔 없음 | MCP Manager 블로그, Integrate.io, Snyk | 높음 |
| 5 | **MCP 서버 자체에 대한 정적 스캐너**(tool-poisoning, schema 의심 패턴 등)는 Invariant Labs `mcp-scan`과 AgentAudit이 거의 단독 소유 | reason output, awesome-list "Scanners and Auditors" 섹션 | 높음 |
| 6 | **공급망/버전 핀 검증**(MCP 서버 버전이 승인 목록인지)은 AgentAudit 단독 강조 — 미충족 영역 | reason cross-source, Medium hardening 글 Phase 3 | 높음 |
| 7 | **이상 탐지(anomaly detection)** 는 Datadog AI Guard만 명시적으로 제공하며 대부분 "rule-based"에 머묾 — 통계/ML 기반 baseline은 거의 공백 | reason output | 보통 |
| 8 | Anthropic 자체 hook 생태계는 **PreToolUse=차단 / PostToolUse=감사 / SessionEnd=cleanup** 패턴이 사실상 표준화되었음 | Medium "Hardening Claude Code", efij/awesome-claude-code-security, Tavily refinement(linkedin/github issues) | 높음 |

## 경쟁 환경 매핑

크게 4개 카테고리로 정리된다.

**A. 엔터프라이즈 게이트웨이 / 런타임 가드레일 (상용)**
- **Cloudflare AI Gateway + WAF + Access**: OAuth 2.1, prompt injection 탐지, shadow MCP detection, AI Gateway routing.
- **Datadog AI Guard**: 7가지 보호(prompt/tool/sensitive data/MCP/anomaly/alignment), APM 통합.
- **MCP Manager / Golf.dev / MintMCP / MCP Total**: 게이트웨이형 — RBAC, SSO/SCIM, 런타임 guardrail, 감사 로그, 대시보드.
- **Arcade.dev**: 멀티유저 권한 스코핑, 감사 firm 타깃, read-only 강제.
- **Dashlane MCP Server**: 감사로그 자체를 LLM이 조회 가능하게 만든 SIEM 연동 톱.
- **Valence Security**: read-only governed retrieval, 정책 변경 금지.

**B. 보안 테스팅 통합 OSS MCP**
- **FuzzingLabs/mcp-security-hub**, **Cyprox/mcp-for-security**, **securityfortech/secops-mcp**: Nmap/Nuclei/SQLMap 등 공격 도구를 MCP tool로 표준화. 우리 제품 방향과는 결이 다름(공격용).

**C. Claude Code 특화 hook/하드닝**
- **awesome-claude-code-security (efij/Puliczek)**: 큐레이션 메타-자료. PreToolUse/PostToolUse/ConfigChange hook reference, 시크릿 누출 방지, MCP allowlist.
- **Medium "Hardening Claude Code"** (emergentcap): Pre-Execution Gate / Supply Chain / ClamAV / Credential hygiene / MCP Audit / Governance — 7-Phase 프레임워크.
- 우리 제품(`ai-action-tracker-mcp`)은 **이 카테고리 1번 페이즈("Pre-Execution Gate")** 에 정확히 위치.

**D. 정적 스캐너 / 감사**
- **Invariant Labs mcp-scan**: MCP 서버 코드 스캔(tool poisoning).
- **AgentAudit**: OWASP MCP Top 10 매핑, 정적 분석, dependency scan.
- **Snyk MCP Scanner Layer**: low-code/no-code 환경의 가드레일 + observability + scanner.
- **Enkrypt AI MCP**: Agent Red Teaming, Agent Guardrails, Policy Engine, AI Data Risk Audit, MCP Scanner, MCP Gateway 통합 suite.

## 합의된 표준 기능 (모든 제품이 가진 것)

3개 이상 소스에서 공통으로 등장하는 baseline:

1. **인증**: OAuth 2.1 (Cloudflare/Dashlane/Arcade), CSRF/CSP/HMAC/`__Host-` 쿠키.
2. **RBAC + 최소권한 tool 스코핑**: Arcade, MCP Manager, Pivot Point.
3. **Rate limiting / throttling**: Kong, Cloudflare AI Gateway, MCP Manager.
4. **감사 로깅 (query-level)**: 누가/언제/어떤 tool/어떤 인자/결과 — Dashlane, MintMCP, Snyk, Integrate.io.
5. **Prompt injection 탐지 / input validation**: Datadog, Cloudflare WAF, Truefoundry, Invariant Labs.
6. **Output sanitization**: MCP server의 응답을 untrusted로 취급(Pivot Point, Truefoundry).
7. **Allowlist(서버 단위)**: 신뢰 가능한 MCP 서버만 연결 — Cloudflare Portal, MCP Manager registry.
8. **SIEM/SOAR 연동**: Dashlane(Splunk), Datadog APM trace, MintMCP Elasticsearch.

### 우리 제품 현재 보유 / 미보유 매핑

| Baseline 기능 | 우리 제품(`ai-action-tracker-mcp`) | 코멘트 |
|---|---|---|
| OAuth/인증 | **없음** | http.ts에 인증 미비, "additional authentication" 모듈이 로드맵 |
| RBAC/스코핑 | **없음** | hello-world tool만 존재 |
| Rate limiting | **없음** | — |
| 감사 로깅 | **없음** (PreToolUse hook이 stderr로 차단 사유만 출력) | PostToolUse 자체가 미구현 |
| Prompt injection 탐지 | **없음** | — |
| Output sanitization | 해당 없음 (MCP server에 도구가 없음) | — |
| 서버 allowlist | 해당 없음 | — |
| SIEM 연동 | **없음** | — |
| **Bash regex 차단** | **있음** (`hooks/danger-patterns.json`) | 합의 기능 아니지만 구현됨 |
| **Bash 의미 분석** (git ls-files) | **있음** (rm -rf 타깃 절대경로 + git tracked 검사) | **거의 단독 보유 기능** |

요약: baseline 8종 중 0~1개만 충족. 차별점은 baseline 밖에 있음.

## 차별화 기회 (소수만 가진 기능)

reason cross-source 분석이 식별한 미충족 영역:

| 미충족 기능 | 현재 보유 벤더 | 우리 제품 방향성과 적합도 |
|---|---|---|
| OWASP MCP Top 10 자동 태깅 | AgentAudit 단독 | 중 — 차단 시 reason에 OWASP code 부착 |
| **파일 단위 의미적 무결성**(predicted vs actual diff) | 없음 | **매우 높음** — 우리 git ls-files 접근의 자연스러운 확장 |
| **PreToolUse 단계 secrets 차단**(redaction 아님, 차단) | 없음 (Datadog은 egress redaction) | 높음 |
| 공급망 / 버전 핀 검증 | AgentAudit | 중 |
| 통계 기반 anomaly detection | Datadog (rule-based 위주) | 낮음(Phase 3) |
| MCP 서버 정적 스캐너 | Invariant Labs `mcp-scan` | 중 — model-callable advisory tool로 적합 |
| **Bash 의미적 destructive 차단** | **우리 단독** | 이미 보유 — 강화 방향(`dd`, `chmod`, `mv` 등 확장) |

## 우리 제품 부가 tool 후보 — 우선순위 제안

각 후보는 (a) MCP server tool / (b) PreToolUse hook / (c) PostToolUse hook / (d) Stop·SessionEnd hook 중 어디에 위치하는지 명시.

### Phase 1 — MVP 확장 (즉시 가치, 작은 노력)

| 후보 | 구현 위치 | 핵심 동작 | 난이도 | 가치 | 시너지 |
|------|---------|----------|--------|------|--------|
| `secrets-redact` 차단기 | (b) PreToolUse hook | tool input(특히 Bash·Write·Edit)에서 AWS key id, JWT, `password=`, `api_key=`, RFC3339 토큰 패턴 + 엔트로피 검사. 매치 시 exit 2 차단 | **S** | 높음 | 기존 regex 레이어 옆에 그대로 추가; danger-patterns.json 포맷과 일관 |
| `audit-emit` 감사 트레일 | (c) PostToolUse hook | `{ts, session_id, tool, args_redacted, blocked, reason, files_touched}` JSON-Lines를 stderr/webhook/syslog로 emit. fail-open 원칙 유지 | **M** | 높음 | 우리는 PostToolUse 자체가 없음 → 새 hook 진입점. 차후 Datadog/Splunk 연동의 토대 |
| `file-change-delta` 로거 | (c) PostToolUse hook | PreToolUse에서 `git ls-files`로 예측한 영향 파일과 PostToolUse 시점 `git diff --name-only`를 비교, mismatch면 audit에 alarm 플래그 부착 | **S** | 높음 | git ls-files 인프라 재사용. "예측 vs 실제" 갭은 환각/우회 탐지 |
| `policy-yaml` 정책 평가기 | (b) PreToolUse hook | `policies.yaml`에 `{role, tool, action, env, effect}` 규칙. danger-patterns.json을 일반화 | **M** | 중 | 정규식 하드코딩에서 데이터 기반으로 진화. 사용자별 override(로드맵의 "additional authentication")와 짝 |

### Phase 2 — 엔터프라이즈 확장

| 후보 | 구현 위치 | 핵심 동작 | 난이도 | 가치 | 시너지 |
|------|---------|----------|--------|------|--------|
| `mcp-server-scan` advisory | (a) MCP server tool | 입력: 서버 이름/URL. 출력: `{transport, version, network_exposure, last_audit, risk: LOW/MED/HIGH, owasp_tags[]}`. 차단하지 않고 모델/사용자에게 정보 제공 | **M** | 중 | hello-world echo를 대체할 첫 "진짜 tool". 모델이 새 MCP 추가 시 호출 |
| `version-pin-check` | (b) PreToolUse hook | `approved-versions.json`에 등재된 도구/패키지 버전과 호출 인자 비교, 미일치면 차단 | **S** | 중 | Snyk/Dependabot 데이터 import 가능 |
| `prompt-injection-sig` | (b) PreToolUse hook | "Ignore previous instructions" 류, system prompt override, README/이슈 텍스트 안 hidden 지시 등 시그니처 매칭 | **M** | 중 | Datadog AI Guard 보완(로컬·저지연) |
| `network-egress-policy` | (b) PreToolUse hook | `curl|wget|ssh|nc` 등의 도메인을 파싱해 `network-allowlist.yaml` 매칭. 미허용 도메인 차단 | **M** | 중 | 기존 `curl ... \| bash` regex의 의미적 일반화 |
| `session-threshold` | (d) Stop / SessionEnd hook | 세션 누적 카운터(파일 삭제 수, 외부 호출 수, 차단 횟수). 임계 초과 시 SessionEnd 시점에 경고/요약 emit | **M** | 중 | per-session governance 레이어. 현재 우리 hook은 per-command 단위라 비어있음 |

### Phase 3 — 고급

| 후보 | 구현 위치 | 핵심 동작 | 난이도 | 가치 | 시너지 |
|------|---------|----------|--------|------|--------|
| `owasp-mcp-tag` | (c) PostToolUse hook | 차단/허용 이벤트마다 OWASP MCP Top 10 카테고리 자동 태깅 | **M** | 높음 | SOC2/NIST 컴플라이언스 리포팅 — AgentAudit 외엔 거의 없음 |
| `anomaly-baseline` | (c) PostToolUse hook + 비동기 배치 | 2~4주 baseline 학습 후 Isolation Forest로 이상치 플래그 | **L** | 높음 | Datadog 이상의 통계 기반 — 초기 데이터 수집 필요 |
| `policy-as-code` (Rego/CEL) | (b) PreToolUse hook | YAML→Rego/CEL로 격상. 조건부 정책, 역할/세션 컨텍스트 사용 | **L** | 높음 | 멀티테넌트/대규모 조직용 |
| `supply-chain-provenance` | (a) MCP server tool | MCP 서버 메타: source repo, commit hash, last security audit | **L** | 중 | Phase 2 `mcp-server-scan`의 데이터 소스 |
| `model-rationale-log` | (c) PostToolUse hook | 모델의 도구 선택 이유를 트레이스에서 추출해 audit에 부착 | **M** | 낮음 | 디버깅용; 핵심 보안 가치는 낮음 |

### 즉시 권장 4개 (Bottom line)

1. **`audit-emit`** (M / 높음) — PostToolUse를 새로 만들고 표준 JSON-Lines 출력. 다른 모든 부가 기능의 출력 채널이 됨.
2. **`secrets-redact` 차단기** (S / 높음) — danger-patterns.json 옆에 secrets-patterns.json 추가하고 hook 분기 한 줄.
3. **`file-change-delta`** (S / 높음) — 우리만의 git ls-files 자산을 재활용하는 자연스러운 진화.
4. **`policy-yaml`** (M / 중) — danger-patterns.json을 정책 파일로 일반화하면서 로드맵의 per-session override와 결합 지점 확보.

## 추가 분석 (Perplexity reason 결과)

### 합의점
- **계층화는 사실상 표준 패턴**: PreToolUse=blocking / PostToolUse=logging / SessionEnd=cleanup 분리는 거의 모든 hook 기반 가이드(Medium hardening, awesome-claude-code-security, Anthropic issues #2818/#39882)에서 동일하게 권장됨.
- **MCP 서버 tool은 "advisory"가 적합**: 차단 결정은 hook이, "이 서버 위험한가?" 같은 정보 제공은 model-callable tool이 한다는 분업이 reason 결과·Valence·Arcade 패턴 모두에서 일치.
- **Audit는 baseline**: 이걸 안 하는 보안 제품은 사실상 없음. 우리만 비어있음.

### 논쟁점 / 의견 분화
- **차단 vs 권고**: Cloudflare/Datadog는 게이트웨이 단계에서 강하게 차단하지만, Valence·Arcade 일부는 "retrieve, summarize, guide — no policy modification" 즉 enforcement 회피 철학. 우리 hook은 명백히 차단형 → 권고형 advisory tool을 함께 두면 양쪽 철학을 수용 가능.
- **Bash 단계 vs 모델 단계**: Datadog AI Guard·Cloudflare WAF는 모델 입출력 레벨에서 검사. 우리 hook은 도구 호출 직전 명령 레벨. 두 레이어는 서로 보완(중복 아님) — Perplexity reason도 명시적으로 "Datadog handles model-level threats; transcodes-guard handles bash/file-level specificity"로 분리.
- **버전 핀 vs 동적 신뢰**: AgentAudit·Snyk는 버전 핀 강조, 반면 MCP Manager registry는 "관리자 승인 + 시그니처" 모델. 우리는 상대적으로 단순한 `approved-versions.json`이 출발점으로 적합.

### 정량 데이터
- Perplexity reason 토큰 사용: prompt=317, completion=5160, total=5477, cost=$0.056 (참고용 메타데이터).
- 외부 제품의 가격/성능 정량 데이터는 추출 범위 안에서는 발견되지 않음. 추출 코퍼스(8 articles)는 정성적 features 위주.

## 소스 상세

### 기사 및 문서

| 소스 | 핵심 내용 | URL |
|------|----------|-----|
| Snyk — Securing Low-Code Agentic AI with MCP Guardrails | "MCP Request Handler → MCP Scanner Layer → Observability Layer" 3단 계층 + DevSecOps 통합. 우리 제품의 PreToolUse hook이 Scanner Layer에 정확히 매핑됨 | https://snyk.io/blog/securing-low-code-agentic-ai-mcp-guardrails/ |
| Integrate.io — Best MCP Gateways and AI Agent Security Tools (2026) | Essential features: 실시간 모니터링, .env/SSH key/credential 보호, 감사 트레일, 차단 + advanced(autonomous investigation, anomaly detection, SIEM/SOAR) | https://www.integrate.io/blog/best-mcp-gateways-and-ai-agent-security-tools/ |
| MCP Manager — Best MCP Security Tools 2025 | MCP Manager / Golf.dev / MCP Total / MintMCP 4종 비교. 공통: registry, RBAC, SSO/SCIM, runtime guardrail, audit log | https://mcpmanager.ai/blog/mcp-security-tools/ |
| Enkrypt AI — MCP Gets Defensive | Agent Red Teaming, Agent Guardrails, Policy Engine, AI Data Risk Audit, MCP Scanner, MCP Gateway 통합 제품 라인 | https://www.enkryptai.com/blog/mcp-gets-defensive-securing-agents-using-mcp |
| Cloudflare — Securing MCP Servers (공식문서) | OAuth 2.1 + CSRF/CSP/HMAC/`__Host-`/state binding 체크리스트. `@cloudflare/workers-oauth-provider` 코드 예시 | https://developers.cloudflare.com/agents/guides/securing-mcp-server/ |
| Medium — Hardening Claude Code (emergentcap) | 7-Phase 프레임워크: Assessment → Pre-Execution Gate(우리 위치) → Supply Chain → ClamAV → Credential hygiene → MCP Audit → Governance. SessionEnd cleanup 패턴(zombie kill, snapshot prune, credential scrub) 구체 명시 | https://medium.com/@emergentcap/hardening-claude-code-a-security-review-framework-and-the-prompt-that-does-it-for-you-c546831f2cec |
| TrueFoundry — MCP Server Security Best Practices | 5대 best practice: schema 강제, 인증, 역할 기반 권한, 감사+anomaly, prompt injection 가드 + 휴먼 승인 워크플로우 | https://www.truefoundry.com/blog/mcp-server-security-best-practices |
| efij/awesome-claude-code-security (메타-소스) | 카테고리: Hardening, Sandboxing, Hooks/Guardrails, MCP Security(Scanners·Gateways·Standards·Research), Prompt Injection, Secrets/Data Leakage, Enterprise Governance, Secure CI/CD, Plugins/Supply Chain | https://github.com/efij/awesome-claude-code-security |

보조: Refinement(Tavily) — TheDecipherist/claude-code-mastery(블록 시크릿/위험 명령 hook 예제), Anthropic claude-code issues #2818(PreToolUse가 dangerous string replacement 방지), #39882(PreApiCall/PostApiCall hook 제안 — DLP/PII/audit logging).

## 미비점 및 추가 조사 필요 영역

- **OWASP MCP Top 10**: AgentAudit이 단독 매핑하는 분류 체계의 정확한 카테고리 목록을 확보하지 못함. `agentaudit.dev/compare` 직접 추출 필요.
- **Datadog AI Guard "MCP-specific protection layer"** 의 구체 동작 — Datadog 블로그 추출 실패(skipped). 통합 시점에 다시 조사 권장.
- **Invariant Labs `mcp-scan`** 의 실제 탐지 룰(특히 tool poisoning 시그니처)은 awesome-list 메타-언급 외 직접 코드 분석 미수행.
- **상용 제품 가격대 / 성능 벤치마크** 정량 데이터 부재. 경쟁 포지셔닝(특히 OSS 무료 vs 게이트웨이 SaaS)을 비교하려면 추가 조사 필요.
- **Stop / SessionEnd hook의 모범 패턴** — Medium 글이 launchd/cron 예시까지 다루지만, MCP 서버 측에서 SessionEnd를 trigger받는 표준 방법은 우리 코드베이스에 미적용.

## 전체 출처

1. https://snyk.io/blog/securing-low-code-agentic-ai-mcp-guardrails/
2. https://www.integrate.io/blog/best-mcp-gateways-and-ai-agent-security-tools/
3. https://mcpmanager.ai/blog/mcp-security-tools/
4. https://www.enkryptai.com/blog/mcp-gets-defensive-securing-agents-using-mcp
5. https://developers.cloudflare.com/agents/guides/securing-mcp-server/
6. https://medium.com/@emergentcap/hardening-claude-code-a-security-review-framework-and-the-prompt-that-does-it-for-you-c546831f2cec
7. https://www.truefoundry.com/blog/mcp-server-security-best-practices
8. https://github.com/efij/awesome-claude-code-security
9. https://github.com/Puliczek/awesome-mcp-security
10. https://www.pivotpointsecurity.com/does-mcp-make-your-ai-more-secure-or-less-secure/
11. https://www.checkpoint.com/cyber-hub/cyber-security/what-is-ai-security/mcp-security/
12. https://blog.cloudflare.com/enterprise-mcp/
13. https://www.dashlane.com/blog/mcp-server-audit-log-access/
14. https://www.datadoghq.com/blog/monitor-mcp-servers/
15. https://www.arcade.dev/blog/enterprise-mcp-guide-for-accounting-audit-firms/
16. https://www.valencesecurity.com/resources/blogs/ai-agents-saas-ai-security-valence-mcp-server
17. https://github.com/cyproxio/mcp-for-security
18. https://github.com/securityfortech/secops-mcp
19. https://github.com/FuzzingLabs/mcp-security-hub
20. https://www.mintmcp.com/blog/build-audit-trails-ai-coding-agents
21. https://github.com/anthropics/claude-code/issues/2818
22. https://github.com/anthropics/claude-code/issues/39882
23. https://agentaudit.dev/compare
