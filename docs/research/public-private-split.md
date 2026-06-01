# transcodes-guard 공개/비공개 분리 리서치 보고서 (초안)

> 본 문서는 `docs/research/public-private-split.md`로 저장될 초안이다. 단기엔 모노레포 내부 격리, 장기엔 "비공개 비즈니스 로직 + CDN 산출물 + 공개 wrapper" 분리를 목표로, OSS+SaaS 회사들의 실제 사례와 결정 근거를 정리한다.

---

## 0. 컨텍스트 요약 및 핵심 가설

`transcodes-guard`는 npm workspaces 기반 모노레포로, 다음 두 종류의 코드가 한 리포에 공존한다.

| 종류 | 위치 | 공개 가능성 |
|---|---|---|
| 호스트 어댑터 / hook entry / plugin manifest | `plugins/*`, `packages/hook-adapters` | 공개 가능 (각 host CLI에 노출돼야 동작) |
| MFA 게이트 평가 로직, 토큰 핸들링, 백엔드 API 통신 | `packages/stepup-core`, `packages/cli` 일부 | **비공개 희망** |
| 공통 라이브러리 (paths, danger-patterns, mcp-server-core) | `packages/{plugin-paths, danger-patterns, mcp-server-core}` | 공개 가능 |

핵심 가설: **공개 SDK + 비공개 서비스 백엔드** 패턴은 이미 Stripe, Sentry, Clerk, PostHog, Supabase가 각자 다른 균형점으로 해결해 둔 well-trodden path다. 이 리포는 그중 어느 균형점을 베끼느냐를 먼저 정하는 것이 옳다.

---

## 1. 공개/비공개 분리 모노레포 전략 — 사례 비교

### 1.1 PostHog: "open-core / ee/ 디렉터리 + 라이선스 분리"

- 단일 리포 `PostHog/posthog` 안에 `ee/` 디렉터리만 별도 라이선스(EE License, production 사용에 유효한 enterprise subscription 필요)로 묶고, 나머지는 MIT.
- 별도로 `PostHog/posthog-foss` 리포를 자동 생성해서 `ee/`를 완전히 제거한 FOSS 미러를 제공.
- 디렉터리 기반 분리 + 라이선스 텍스트만으로 "코드는 보이지만 상업적 사용은 금지"라는 약한 보호를 건다. 코드 자체는 난독화하지 않는다.
- 참고: `https://github.com/PostHog/posthog/blob/master/ee/LICENSE`, `https://github.com/PostHog/posthog`

**적용 가능성 (transcodes-guard):**
- 우리는 "코드를 보이게 두면 안 됨"이 강한 요구사항이므로 PostHog 식 라이선스-only 보호는 **부족**하다. 게이트의 토큰 검증/우회 패턴이 평문으로 노출되면 보안 가치 자체가 사라진다.
- 다만 단기 격리 단계에서 `packages/stepup-core/`를 `private/stepup-core/`로 옮기고 별도 LICENSE를 부여하는 디렉터리 분리 트릭은 "장기 분리 시 마찰 감소"에 그대로 쓸 수 있다(이후 `git filter-repo --path private/` 한 줄로 추출 가능).

### 1.2 Sentry: "monorepo SDK 전체 공개 + SaaS 백엔드는 별도 리포"

- `getsentry/sentry-javascript` 모노레포에는 `@sentry/core`, `@sentry/browser`, `@sentry/node`, 프레임워크별 SDK가 모두 들어 있고 전부 공개.
- Sentry의 SaaS 백엔드(`getsentry/sentry`)는 FSL(Functional Source License) — 일정 기간 후 OSS로 전환되는 변형 라이선스.
- SDK가 보내는 envelope/payload 포맷은 공개 스펙(인제스천 API)이고, 백엔드의 처리/스토리지/UI가 비공개 가치.
- CDN 측면: `js.sentry-cdn.com`을 통해 loader 스크립트를 배포(아래 §2.2).

**결정 근거:** SDK는 사용자의 빌드/번들에 들어가야 하므로 어차피 소스가 노출된다 → "SDK는 공개하고 백엔드만 지킨다"가 합리적.

**적용 가능성:** 우리의 게이트 코드는 **사용자 머신에서 실행**되므로 Sentry 백엔드와 달리 서버에 격리할 수 없다. 따라서 Sentry 모델을 그대로 쓰면 "결국 다 공개"가 된다. 우리는 한 단계 더 가야 함.

### 1.3 Stripe: "PCI 강제 → 핵심은 CDN, npm은 thin loader"

- `stripe/stripe-js`는 약 100줄짜리 wrapper 패키지. `loadStripe()` 호출 시 `<script src="https://js.stripe.com/v3">`를 동적으로 삽입.
- 실제 카드 입력/암호화/PCI 스코프 로직은 전부 `js.stripe.com`에서 매번 fetch — 사용자/개발자 누구도 자체 호스팅 불가.
- 버전 핀: npm 패키지 각 메이저 버전이 특정 Stripe.js 릴리스("dahlia" 등 코드네임)에 대응 — 즉 wrapper의 의미는 "어떤 CDN 빌드를 부를지의 포인터" + TS 타입.
- 참고: `https://github.com/stripe/stripe-js`, `https://www.npmjs.com/package/@stripe/stripe-js`

**결정 근거:** PCI 컴플라이언스가 "사용자가 카드 처리 코드를 자체 호스팅하지 못하게 한다"는 규제 요구를 만든다. 결과적으로 비즈니스 로직 비공개와 컴플라이언스가 같은 아키텍처를 강제.

**적용 가능성 (가장 가까운 모델):**
- 우리도 동일하게 **`@transcodes-guard/loader`** 같은 thin wrapper만 공개하고, 실제 게이트 평가 로직은 우리 CDN에서 lazy-load하는 구조가 자연스럽다.
- 단, Stripe는 브라우저 컨텍스트라 `<script>` 동적 삽입이 되지만 우리는 **Node.js hook 환경**이므로 `await import('https://cdn.transcodes.dev/guard@x.y.z.mjs')` 형태의 **dynamic ESM import**가 필요(§2.3).

### 1.4 Clerk: "프론트엔드 SDK는 공개, ClerkJS는 CDN, FAPI는 비공개"

- npm 패키지(`@clerk/clerk-js`, `@clerk/nextjs` 등)는 공개. 다만 실제 인증/세션/MFA 로직의 핵심은 **Frontend API(FAPI)** — `clerk.{domain}` HTTP 엔드포인트로 위임.
- SDK가 50초마다 `/client/sessions/<id>/tokens` 핸드셰이크를 돌고, 토큰 갱신/쿠키 도메인 처리 같은 "보일러플레이트지만 도용 위험 낮은" 부분만 클라이언트에 둠.
- "지킬 가치가 있는 로직은 서버에" — 클라이언트는 가능한 한 멍청하게.
- 참고: `https://clerk.com/docs/guides/how-clerk-works/overview`

**적용 가능성:** 우리는 가능한 한 로직을 백엔드 HTTP API로 밀어내고, 게이트 hook은 단순히 "결정을 묻고 결정을 적용"하는 RPC 클라이언트가 되도록 하는 것이 가장 강한 보호. 게이트 평가의 정책 로직(어떤 명령이 위험한지)을 서버사이드 결정으로 옮길 수 있는 만큼 옮긴다. 단점: 오프라인 동작 불가, 네트워크 의존.

### 1.5 Supabase: "거의 다 OSS — 비공개는 인프라/대시보드만"

- `supabase-js` (MIT), GoTrue (MIT, Go), PostgREST (MIT, Haskell), Realtime, Storage 전부 OSS.
- 비공개는 **대시보드 UI, billing, 멀티테넌트 컨트롤 플레인**. 즉 self-host하는 사람도 합법적으로 다 굴릴 수 있고, Supabase는 "오케스트레이션과 사용성"으로 차별화.
- 참고: `https://supabase.com/docs/guides/getting-started/architecture`

**적용 가능성:** 우리 게이트는 supabase식 "다 공개" 모델로 가면 보호되는 자산이 없다. 다만 시사점: **"오픈소스로 둘 부분"의 가치는 채택률/감사 가능성**이고, 비공개 자산은 "결제·정책·UI"처럼 운영 가치에 집중해야 함을 시사. 우리도 `danger-patterns`, `plugin-paths`, MCP 서버 코어처럼 "감사 가능해야 신뢰가 생기는" 코드는 의도적으로 공개 유지하는 게 마케팅적으로 이득.

### 1.6 권고 — 단기/장기 균형

| 단계 | 모델 | 보호 강도 | DX 비용 |
|---|---|---|---|
| **단기 (이번 공개 시점)** | PostHog 식 디렉터리 분리 + `packages/private/*`를 `"private": true`로 publish 차단 + 라이선스 분리 | 약 (소스 노출) | 거의 0 |
| **중기 (1~3개월)** | Stripe-loader 식 thin wrapper로 entry 좁히고, 비공개 로직을 사내 npm 또는 사설 GitHub Packages로 분리 | 중 (소스 비공개, 단 enterprise만 접근 가능) | 중 (배포 파이프 2개) |
| **장기** | 비공개 로직을 obfuscated ESM으로 사내 CDN에 올리고 wrapper가 dynamic import + SRI 검증 | 강 (난독화+무결성) | 큼 (CDN/서명/캐싱) |

---

## 2. CDN 배포 형식 + thin wrapper 패턴

### 2.1 npm thin wrapper의 표준 모양 (Stripe 모델)

`@stripe/stripe-js`의 API 표면:
```ts
export function loadStripe(publishableKey: string, options?): Promise<Stripe | null>;
```
- npm 패키지의 책임은 (1) script 태그 주입, (2) 글로벌 객체를 Promise로 감싸기, (3) **TypeScript declaration 제공**(타입은 공개되지만 구현은 노출 안 됨).
- 우리 케이스에서는 `@transcodes-guard/loader`가 다음을 책임:
  ```ts
  export async function loadGuard(opts: GuardOptions): Promise<Guard>;
  // 내부적으로 await import(`https://cdn.transcodes.dev/guard@${PINNED}.mjs`)
  ```
- 버전 핀: wrapper의 npm 메이저 버전을 CDN URL 경로에 1:1 매핑 (Stripe가 코드네임으로 하는 것을 우리는 semver로).

### 2.2 Sentry Loader: "에러 발생 시점에만 풀 SDK fetch"

- snippet은 1~2KB. 페이지 로드 비용 최소화.
- 실제 SDK는 `js.sentry-cdn.com`에서 lazy load. CSP에 `script-src https://browser.sentry-cdn.com` 추가 필요.
- 버전 선택은 Sentry 대시보드에서 하고, 각 번들의 **SRI 해시가 docs 페이지에 게시**됨.
- 참고: `https://docs.sentry.io/platforms/javascript/install/loader/`

**시사점:** "SRI 해시를 우리 docs에 publish"는 모방 가치가 크다. wrapper 코드가 fetch 시점에 알려진 해시를 검증하면 CDN 침해에 대한 일차 방어가 된다.

### 2.3 Node ESM dynamic import의 제약 (브라우저와 다름)

- 브라우저: `<script src>` 또는 `import()` from URL — 표준.
- Node.js: **HTTPS URL을 `import()`로 직접 못 부른다** (`--experimental-network-imports`가 있었으나 deprecated 추세). 우리 hook은 Node 런타임이므로 다음 중 하나가 현실안:
  1. 빌드/설치 시 CDN에서 받아 `~/.transcodes/cache/guard-<version>-<sha384>.mjs`로 캐시, 런타임에 로컬 파일로 `import()`. **SHA384 검증을 우리가 직접 수행.**
  2. postinstall 스크립트가 CDN bundle을 받아 `node_modules/@transcodes-guard/loader/runtime/`에 떨군다(단점: lock 파일/캐시 무력화 우려).
  3. wrapper가 HTTP 클라이언트 + VM(`node:vm`)로 평가 — 가능하나 일반적이지 않고 디버깅 난이도 ↑.

**권고:** (1) 방식. `~/.transcodes/cache/`는 이미 CLI가 관리하는 디렉터리고, 캐시 무결성 검증을 한 곳에 둘 수 있다.

### 2.4 Obfuscation: 무엇을, 어디까지

- `javascript-obfuscator` (npm + jsDelivr CDN 둘 다 배포 중): 식별자 mangling, control-flow flattening, string array encoding, self-defending(디버거 attach 시 abort), dead code injection.
- 빌드 단에서 webpack/rollup의 `mangle`만 켜는 것은 **변수명만 짧아지는 수준**이라 단독으로는 부족.
- 라이선스 보호용은 `javascript-obfuscator`로 충분, 안티-리버스엔지니어링까지는 한계가 있음(결국 클라이언트 코드는 풀 수 있다는 전제 필요).
- 참고: `https://www.npmjs.com/package/javascript-obfuscator`, `https://github.com/javascript-obfuscator/webpack-obfuscator`

**권고:** 1차 방어는 obfuscation, 2차 방어는 **로직 자체를 백엔드로 옮기기**(Clerk 식). 게이트 평가 정책의 *최종 결정*은 서버가 내리도록 설계하면 클라이언트 번들이 까져도 가치 손실이 제한적.

### 2.5 무결성 보장 — SRI + 서명

- **SRI**: `<script integrity="sha384-...">`는 브라우저 표준. Node에서는 동등 기능을 우리가 구현(`crypto.createHash('sha384')`로 비교).
- 배포 파이프라인이 빌드 산출물의 SHA384를 계산해서 (a) wrapper 소스에 상수로 박고, (b) 별도 manifest로도 게시.
- 더 강한 옵션: **Ed25519 서명**. `@noble/ed25519` (5KB)로 wrapper가 bundle을 받자마자 서명 검증. 키 로테이션과 키 폐기 채널이 추가 운영 부담.
- 참고: `https://sri.js.org/`, `https://andrewlock.net/avoiding-cdn-supply-chain-attacks-with-subresource-integrity/`, `https://github.com/paulmillr/noble-ed25519`

**권고:** v1은 SHA384 SRI만. Ed25519는 키 관리 부담이 큼 — 실제로 CDN 공급망 공격 사례가 생길 때 추가.

### 2.6 트레이드오프

| 축 | thin wrapper + CDN | 풀 번들 npm |
|---|---|---|
| 보안 | 비공개 로직 ✓, 무결성 검증 추가 가능 | 소스 노출 ✗ |
| 오프라인 동작 | 첫 fetch 필요 (이후 캐시) | 즉시 |
| 디버깅 DX | 난독화된 stack trace | 평문 stack trace |
| 빌드 복잡도 | CDN 인프라/서명 파이프 필요 | 단일 npm publish |
| 업데이트 속도 | CDN 즉시 (또는 핀에 따라) | npm 재설치 필요 |
| 공급망 위험 | CDN 침해 시 광범위 영향 | npm 침해 (registry typosquatting) |

---

## 3. 모노레포에서 publish 표면 좁히기

### 3.1 `private: true`와 scoped restricted

- npm workspaces는 루트 `package.json`이 반드시 `"private": true`여야 정상 동작. 우리는 이미 그렇게 설정돼 있음.
- 각 workspace 패키지에 `"private": true`를 박으면 `npm publish` 자체가 거부됨 — 가장 단순한 "절대 공개 금지" 토글.
- scoped 패키지는 기본이 restricted. 우리 비공개 패키지는 `@transcodes-guard-private/stepup-core` 같은 별도 scope로 두면 의도가 명확해진다.
- 참고: `https://docs.npmjs.com/creating-and-publishing-private-packages/`, `https://docs.npmjs.com/cli/v7/commands/npm-publish/`

### 3.2 `files` allowlist (denylist보다 우선)

- `.npmignore`는 함정이 많다. `.gitignore`가 있으면 `.npmignore`가 누락된 파일이 자동으로 publish 되는 케이스가 흔함.
- **`package.json`의 `"files"` 필드를 명시적 allowlist로 사용**하는 것이 OWASP / Snyk 권고.
- 빌드 전에 `npm publish --dry-run`으로 실제 tarball 내용을 확인하는 것을 CI step으로 강제.
- 참고: `https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html`, `https://snyk.io/blog/ten-npm-security-best-practices/`, `https://blog.npmjs.org/post/165769683050/publishing-what-you-mean-to-publish.html`

**적용:**
```jsonc
// packages/plugin-paths/package.json
{
  "files": ["dist/", "README.md"],   // src/, tests/, tsconfig.json 등 자동 제외
  "publishConfig": { "access": "public" }
}
```

### 3.3 turbo / pnpm 빌드 격리

- Turborepo의 `turbo prune --scope=@transcodes-guard/loader` 는 해당 패키지와 그 internal deps만 남긴 partial monorepo를 출력 → public 리포 빌드 컨텍스트로 그대로 쓰기 좋음.
- `tasks.outputs`를 빈 배열로 두면 캐시되지 않으므로, 비공개 패키지의 빌드 산출물은 캐시 공유 대상에서 제외하는 식의 격리도 가능.
- pnpm은 `--filter "!@transcodes-guard-private/*"` 형태의 negation filter로 "공개 빌드"와 "전체 빌드"를 분리 가능.
- 참고: `https://turborepo.dev/docs/core-concepts/internal-packages`, `https://turbo.build/repo/docs/core-concepts/monorepos/filtering`, `https://nhost.io/blog/how-we-configured-pnpm-and-turborepo-for-our-monorepo`

### 3.4 향후 분리: `git filter-repo`

- `git filter-repo --path packages/stepup-core/ --path packages/cli/` 한 줄로 해당 디렉터리만 추출 + 히스토리 보존.
- `git filter-repo --invert-paths --path packages/stepup-core/`로 public 리포 쪽에서는 비공개 디렉터리를 히스토리에서 완전히 제거 → **과거 커밋에 평문이 남는 사고 방지**.
- 단, 이 시점 이전에 한 번이라도 push된 공개 리모트가 있으면 force-push가 필요하므로 **공개 시점 전에 디렉터리 분리부터 끝내는 것이 가장 마찰이 적다**.
- 참고: `https://www.git-tower.com/learn/git/faq/git-filter-repo`, `https://docs.github.com/en/get-started/using-git/splitting-a-subfolder-out-into-a-new-repository`, `https://czak.pl/til/git-filter-repo-monorepo-splitting`

**권고 — 디렉터리 레이아웃 변경 (단기 작업)**

```
packages/
  public/
    plugin-paths/
    danger-patterns/
    mcp-server-core/
    hook-adapters/
    loader/                  ← 신규 thin wrapper (장기에 CDN을 부르게 될 곳)
  private/
    stepup-core/             ← 평가/토큰/백엔드 통신
    cli-private-bits/        ← 토큰 저장 구현 등
```

이 구조면 나중에 `git filter-repo --path packages/public/` 한 번으로 공개 리포가 떨어지고, 그 사이 공개 빌드는 `turbo run build --filter="./packages/public/*"`로만 돌리면 된다.

---

## 4. 호환되는 인터페이스 설계

### 4.1 "API 표면은 declaration 파일로만 노출"

- Stripe-js의 핵심 자산은 `@stripe/stripe-js`가 publish하는 `.d.ts` — 사용자는 타입으로 안전하게 코딩하고, 구현은 런타임에 채워진다.
- 우리 `@transcodes-guard/loader`도 동일하게 가야 한다. `Guard` 인터페이스, `evaluate()` 시그니처, `GuardDecision` discriminated union을 공개 타입으로 두고, **구현은 비공개 번들이 채움.**

### 4.2 DI / pluggable backend (OpenTelemetry 모델)

- OTel은 API 레이어(`@opentelemetry/api`)와 SDK 레이어(`@opentelemetry/sdk-*`)를 분리해서, 사용자 코드는 API만 import하고 런타임에 SDK가 provider를 등록한다.
- `opentelemetry-js`와 `opentelemetry-js-contrib`을 **별도 리포**로 운영 — 코어는 좁고 안정적, 벤더/플러그인은 빠르게 진화하도록 분리.
- 참고: `https://github.com/open-telemetry/opentelemetry-js`, `https://github.com/open-telemetry/opentelemetry-js-contrib`

**적용:**
```ts
// 공개: @transcodes-guard/core
export interface GateBackend {
  evaluate(cmd: RiskyCommand, ctx: HookContext): Promise<GuardDecision>;
}
export function setGateBackend(b: GateBackend): void;

// 비공개: @transcodes-guard-private/stepup-core (또는 CDN bundle)
import { setGateBackend } from "@transcodes-guard/core";
setGateBackend(realStepupBackend);
```

이렇게 두면:
- 공개 리포의 hook 코드는 항상 `core.evaluate(...)`만 부르고, 어떤 backend가 꽂혔는지 모른다.
- 비공개 backend가 없으면 "no-op pass" 또는 "deny by default" 두 정책 중 하나로 fallback (보안 정책에 맞게 후자 권장).
- 테스트에선 `setGateBackend(fakeBackend)`로 갈아끼우기.
- 장기 CDN 모델로 갈 때 `@transcodes-guard/loader`는 `setGateBackend(await fetchAndVerify(...))`만 하는 0.5KB 코드가 됨.

### 4.3 Contract 안정성 — semver와 wire 호환

- Stripe의 wrapper-CDN 버전 핀은 메이저 단위. 우리는 `core` 패키지의 `GateBackend` 인터페이스에 변화가 있으면 메이저 bump, 그에 맞춰 CDN URL 경로도 메이저 단위로 분리(`cdn.transcodes.dev/guard/v1/...`, `/v2/...`).
- backend가 던지는 `GuardDecision` 타입은 **wire format**으로도 안정적이어야 함 — JSON-serializable + 알 수 없는 필드 무시(forward-compat).

### 4.4 트레이드오프

| 축 | 강한 DI(공개 core + 비공개 plugin) | 모놀리식 closed SDK |
|---|---|---|
| 보안 | 비공개 표면 최소 ✓ | 비공개 표면 큼 |
| 테스트성 | 가짜 backend 주입 쉬움 ✓ | mocking 필요 |
| 사용자 신뢰 | 공개 core를 감사 가능 ✓ | 블랙박스 |
| 구현 부담 | 인터페이스 안정성 책임 발생 | 자유 |

---

## 5. 종합 권고 — 이 리포 기준 실행 순서

1. **(이번 PR 단위, ~1일)** `packages/` 아래에 `public/` / `private/` 서브디렉터리 도입. 비공개 후보(`stepup-core`, CLI의 토큰 저장 구현)는 `private/`로 이동. `private/*/package.json`에 `"private": true` 강제. 모든 패키지 `"files"` allowlist 명시.
2. **(공개 시점 직전, ~0.5일)** `git filter-repo --invert-paths --path packages/private/`로 공개 리모트용 미러 브랜치 생성. CI에 "공개 빌드는 `packages/private/*`를 import하면 실패"하는 lint rule 추가(ts `paths` 제약 + eslint `no-restricted-imports`).
3. **(1~2주)** 공개 측 `@transcodes-guard/core`에 `GateBackend` 인터페이스 추출. 비공개 `stepup-core`가 이 인터페이스를 구현하도록 리팩토링. hook 코드는 모두 인터페이스 호출로 변경.
4. **(1~2개월, 장기)** `@transcodes-guard/loader` thin wrapper 작성. 비공개 backend를 obfuscated ESM 번들로 빌드(`javascript-obfuscator` 또는 webpack-obfuscator)하고 사내 CDN에 SHA384 매니페스트와 함께 게시. loader가 fetch → 해시 검증 → dynamic import → `setGateBackend`.
5. **(상시)** 게이트 평가의 *정책 결정*은 가능한 한 백엔드 HTTP API로 위임 (Clerk 모델). 클라이언트 번들이 까져도 "정책 자체"는 서버에 남도록.

---

## 6. 참고 URL 모음

### 사례 (OSS+SaaS 구조)
- PostHog ee/ license: https://github.com/PostHog/posthog/blob/master/ee/LICENSE
- PostHog 메인 리포: https://github.com/PostHog/posthog
- Sentry JS SDK 모노레포: https://github.com/getsentry/sentry-javascript
- Sentry Loader 문서: https://docs.sentry.io/platforms/javascript/install/loader/
- Stripe.js loader: https://github.com/stripe/stripe-js
- @stripe/stripe-js on npm: https://www.npmjs.com/package/@stripe/stripe-js
- Clerk overview: https://clerk.com/docs/guides/how-clerk-works/overview
- Supabase architecture: https://supabase.com/docs/guides/getting-started/architecture
- supabase-js: https://github.com/supabase/supabase-js

### CDN / obfuscation / 무결성
- javascript-obfuscator: https://www.npmjs.com/package/javascript-obfuscator
- webpack-obfuscator: https://github.com/javascript-obfuscator/webpack-obfuscator
- SRI 가이드: https://andrewlock.net/avoiding-cdn-supply-chain-attacks-with-subresource-integrity/
- sri.js.org (SRI fallback): https://sri.js.org/
- noble-ed25519 (서명): https://github.com/paulmillr/noble-ed25519

### npm publish 표면 좁히기
- npm files field / publish 베스트프랙티스: https://blog.npmjs.org/post/165769683050/publishing-what-you-mean-to-publish.html
- OWASP NPM Security: https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html
- Snyk 10 best practices: https://snyk.io/blog/ten-npm-security-best-practices/
- npm publish docs: https://docs.npmjs.com/cli/v7/commands/npm-publish/
- private packages docs: https://docs.npmjs.com/creating-and-publishing-private-packages/

### 모노레포 도구 / 분리
- Turborepo internal packages: https://turborepo.dev/docs/core-concepts/internal-packages
- Turborepo filtering: https://turbo.build/repo/docs/core-concepts/monorepos/filtering
- pnpm + turbo 사례 (Nhost): https://nhost.io/blog/how-we-configured-pnpm-and-turborepo-for-our-monorepo
- git-filter-repo 가이드: https://www.git-tower.com/learn/git/faq/git-filter-repo
- GitHub 서브폴더 분리: https://docs.github.com/en/get-started/using-git/splitting-a-subfolder-out-into-a-new-repository

### 인터페이스 설계 / DI
- opentelemetry-js: https://github.com/open-telemetry/opentelemetry-js
- opentelemetry-js-contrib: https://github.com/open-telemetry/opentelemetry-js-contrib
