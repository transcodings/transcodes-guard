# Phase 3 / Unit A — 비공개 backend 난독화 빌드

> 부모: [`../phase3-cdn-mirror-distribution.md`](../phase3-cdn-mirror-distribution.md) · 마일스톤 M1
> 규모: **M** · 선행: 없음 · 외부 의존: 없음 · 상태: 🎉 **Done** ([PR #44](https://github.com/transcodings/ai-action-tracker-mcp/pull/44) 머지) · **산출물 보류 (2026-06-10, v2 전환)** — v2는 코드 은닉을 폐기하므로 `build:cdn` 산출물은 미사용. 스크립트는 보존(shelved), 후속 정리는 [Unit I](./I-license.md) §부수 정리. 미해결 지적: `rotateStringArray`는 구 옵션명 가능성(현행 `stringArrayRotate`) — 재가동 시 확인.

## 규모 산정

- **M (Medium)** — 1~2 PR, 외부 인프라 0.
- 작업: ① 단일 ESM 번들 스크립트 ② obfuscator 설정(lightweight + seed) ③ metafile 기반 누출 검증 ④ npm script 배선 ⑤ 결정성(동일 입력→동일 SHA384) 확인.
- 리스크 낮음(코드/빌드 한정). 단 "결정적 빌드" 보장이 핵심 난이도 — seed 고정 + 비결정 transform 배제로 해소.

## 요구사항

`private/packages/gate-backend`를 단일 obfuscated ESM(`guard-<version>.mjs`)으로 빌드하는 별도 스크립트(`npm run build:cdn`, 가칭)를 신설한다.

## 빌드 파이프라인

esbuild/tsup로 단일 ESM 번들(`minify: true`) → `javascript-obfuscator`로 후처리.

**역할 분담**: `minify`가 identifier mangling + dead-code elimination을 담당하고, obfuscator는 minify가 못 하는 **문자열 은닉(stringArray)만** 담당한다.

### obfuscator 설정 (기존 백엔드 전략 채택)

기존 백엔드 [`bundler.obfuscate.ts`](../../../../transcode-backend-nestjs-v1/src/toolkit/bundler/bundler.obfuscate.ts)의 **lightweight 프리셋**을 기준으로 한다:

- `stringArray: true` + 낮은 `stringArrayThreshold`(~0.1) + **`stringArrayEncoding: []`(인코딩 없음)**
- `controlFlowFlattening` · `deadCodeInjection` · `selfDefending` · `renameGlobals` · `simplify` **전부 OFF**
- 결정적 빌드를 위해 **`seed` 고정** 추가

**근거**:
1. **hook 임계경로** — `controlFlowFlattening`은 런타임 최대 1.5x 저하(context7 확인), `deadCodeInjection`은 번들 비대화. 게이트는 *모든 tool call* hook에서 돌아 [부모 §6 "첫 fetch 지연" risk](../phase3-cdn-mirror-distribution.md#6-위험-risks--마스터)와 직결.
2. **결정성** — shuffle/rotate/deadCode는 난수 기반→비결정적이라 SHA384 핀([Unit B](./B-cdn-deploy.md))과 충돌.
3. **"풀린다" 전제(NG2)** — heavy transform은 정상 사용자만 느리게 함. 로직 은닉 강도는 transform이 아니라 NG2 정책 이관으로 메운다.

> 한계 명시: obfuscation은 "결국 클라이언트 코드는 풀린다"는 전제(split.md §2.4). 라이선스/표면 축소용이며 완전한 안티-리버스엔지니어링이 아님. 진짜 방어선은 NG2(정책 백엔드 이관). lightweight로 충분하며 aggressive 프리셋의 비용(런타임 저하·비결정성·번들 비대)은 정당화되지 않는다.

## 산출물

- `cdn-dist/guard-<version>.mjs` (단일 파일, public dist와 분리된 경로).

## public dist 변경

plugin 번들에서 private backend 평문 inline 제거 — `backend.ts`가 로더로 바뀌면 자연 해소([Unit C](./C-cdn-loader.md)와 연동). → 과도기 상태는 OQ5.

## 검증

- 번들 입력 검증은 **esbuild/tsup `metafile`로 input 모듈 그래프 확인**. (백엔드 가이드 `toolkit-core.md`: "string grep on obfuscated bundles is unreliable" — `stringArray`가 문자열을 배열로 재배치해 grep이 false-negative를 낼 수 있음.)
- grep은 보조 스모크로만; 번들이 정상 `import()` 가능한지 확인.

## blocking / 관련 Open Questions

- **OQ8 (affects)** — obfuscator encoding 채택 여부. 기본 `stringArrayEncoding: []`(없음). 엔드포인트 은닉 위해 `['base64']`? hot-path 디코드 비용 vs 어차피 네트워크로 노출되는 엔드포인트 → **본 단위 권장: 없음**. 결정 없이도 기본값으로 착수 가능(blocker 아님).
- **OQ5 (affects)** — public dist 평문 제거 타이밍(A 완료~C 전 과도기).

## 수용 기준

- `npm run build:cdn`이 **동일 입력 → 동일 SHA384**(seed 고정 결정성).
- metafile에 private 모듈만 포함, public dist에 private 식별자 누출 0.
- 산출 번들이 정상 `import()` 가능.

## 산출 파일(예상)

- `scripts/build-cdn.mjs` (또는 `private/packages/gate-backend`의 별도 빌드 설정)
- `package.json` 스크립트 `build:cdn`
- `cdn-dist/guard-<version>.mjs` (gitignore 여부는 B와 함께 결정)
