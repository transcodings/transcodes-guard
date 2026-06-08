# Changelog

## [0.5.2](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.5.1...transcodes-guard-v0.5.2) (2026-06-08)


### Documentation

* **prd:** 구버전 PRD 초안 정리 (phase3만 유지) ([bc89ab2](https://github.com/transcodings/ai-action-tracker-mcp/commit/bc89ab2a5cfe41072cd6e271917b4f7e1f4dfea6))

## [0.5.1](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.5.0...transcodes-guard-v0.5.1) (2026-06-08)


### Documentation

* **prd:** 3단계 CDN 미러 배포 PRD 추가 ([3624e30](https://github.com/transcodings/ai-action-tracker-mcp/commit/3624e3022fce9a22514bc17f5eee1584ac09768a))

## [0.5.0](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.4.0...transcodes-guard-v0.5.0) (2026-06-08)


### Features

* GateBackend DI 경계 — public이 private 없이 빌드 (분리 2단계) ([6508acb](https://github.com/transcodings/ai-action-tracker-mcp/commit/6508acb45f9d3fbb89107d671fea30b8cb2c4429))
* GateBackend DI 경계 도입 — public이 private 없이 빌드 ([651dd02](https://github.com/transcodings/ai-action-tracker-mcp/commit/651dd021e9e24abe2d2a2bed03ff523c6937c64d))


### Code Refactoring

* public/private 2분할 재배치 + 플러그인 디렉토리명 정리 ([dcb801e](https://github.com/transcodings/ai-action-tracker-mcp/commit/dcb801ef62ce78f24b1cad11a9d2b81b63f22fec))
* public/private 2분할 재배치 + 플러그인 디렉토리명 정리 (분리 1단계) ([f104495](https://github.com/transcodings/ai-action-tracker-mcp/commit/f1044956372e93fef5749cf914b23b66e28ecfdb))

## [0.4.0](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.3.0...transcodes-guard-v0.4.0) (2026-06-07)


### Features

* **rbac:** RBAC step-up 게이트 전환을 public/private 분할 위로 re-port ([#26](https://github.com/transcodings/ai-action-tracker-mcp/issues/26)) ([c3c6ad5](https://github.com/transcodings/ai-action-tracker-mcp/commit/c3c6ad5e0b81e584deefdce6166350412e68cac2))

## [0.3.0](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.2.1...transcodes-guard-v0.3.0) (2026-06-01)


### ⚠ BREAKING CHANGES

* danger-rules 패키지 분리 (tool-rules 격리)
* 백엔드 통신 도구 구현이 별도 비공개 패키지로 이동. createServer()의 외부 시그니처/노출 도구 목록은 변경 없음.
* 패키지 이름이 @transcodes-guard-private scope로 이동. 외부에서 직접 import하던 경로가 변경됨 (현재로선 모노레포 내부 의존만 있어 영향 없음).

### Documentation

* **research:** 공개/비공개 분리 사례 + 현 코드 민감도 매핑 ([3e35ac9](https://github.com/transcodings/ai-action-tracker-mcp/commit/3e35ac94d0fb8153f133c6b1ab92c19545542ef7))
* workspace layout/rules에 private-packages 반영 ([4c44ee0](https://github.com/transcodings/ai-action-tracker-mcp/commit/4c44ee0775029d8df862fbac5daa2eb2372f2a27))


### Code Refactoring

* danger-rules 패키지 분리 (tool-rules 격리) ([c5bbd3c](https://github.com/transcodings/ai-action-tracker-mcp/commit/c5bbd3c964aff3456b37b5314ea7a0145cd80391))
* stepup-core를 private-packages로 격리 ([655127b](https://github.com/transcodings/ai-action-tracker-mcp/commit/655127b590645ba7fa19348c856fef9e469ccf10))
* transcodes-mcp-tools 패키지 분리 ([8f8ec36](https://github.com/transcodings/ai-action-tracker-mcp/commit/8f8ec365311cd45ef409f8c7d48025f2dda1e2b1))

## [0.2.1](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.2.0...transcodes-guard-v0.2.1) (2026-05-31)


### Bug Fixes

* **release:** auto-merge 스텝 fromJSON 템플릿 에러 수정 ([55ebfe8](https://github.com/transcodings/ai-action-tracker-mcp/commit/55ebfe8cd94bbd5a705f92d6c0a7e268165f7a1a))
* **release:** auto-merge 스텝의 fromJSON 템플릿 에러 수정 ([70e77de](https://github.com/transcodings/ai-action-tracker-mcp/commit/70e77de0877410b918be2e5d260ae53c28ca104d))

## [0.2.0](https://github.com/transcodings/ai-action-tracker-mcp/compare/transcodes-guard-v0.1.0...transcodes-guard-v0.2.0) (2026-05-31)


### Features

* Cursor IDE plugin 추가 — flat wire format adapter + beforeSubmitPrompt side-effect ([#9](https://github.com/transcodings/ai-action-tracker-mcp/issues/9)) ([937ca3f](https://github.com/transcodings/ai-action-tracker-mcp/commit/937ca3f9d91795d51c6e93380aea3322640b5da2))
* Google Antigravity 2.0 plugin 추가 — native adapter + PreInvocation fusion ([#7](https://github.com/transcodings/ai-action-tracker-mcp/issues/7)) ([df11179](https://github.com/transcodings/ai-action-tracker-mcp/commit/df11179decbb2263442e1f63f1d170bbfff020d7))
* **hook:** replace exit 2 with Step-up MFA gate ([323fcfa](https://github.com/transcodings/ai-action-tracker-mcp/commit/323fcfa4d463b7fe0c923c02e3a2e1f7381afad4))
* **hook:** rm -rf 의미 분석 + 차단 사유 명시 ([0261195](https://github.com/transcodings/ai-action-tracker-mcp/commit/0261195524cc29ca1081892805b973bac4bf53f2))
* **hooks:** introduce step-up MFA hook orchestra ([af02019](https://github.com/transcodings/ai-action-tracker-mcp/commit/af020190bb3881676a40a3a3f867dc265f36169d))
* host-aware data dir (CLAUDE_PLUGIN_DATA) + JSONC for user rules ([#10](https://github.com/transcodings/ai-action-tracker-mcp/issues/10)) ([c4bcf11](https://github.com/transcodings/ai-action-tracker-mcp/commit/c4bcf11b9dc2e902c3efe5b2fff9d21d0cd1891c))
* **marketplace:** .claude-plugin/marketplace.json 카탈로그 추가 ([8cfd898](https://github.com/transcodings/ai-action-tracker-mcp/commit/8cfd89844e52e4bd1c1862cf2956e213c760b259))
* MCP 도구 호출에 hook 기반 step-up MFA 게이트 확장 ([#5](https://github.com/transcodings/ai-action-tracker-mcp/issues/5)) ([a09f2d0](https://github.com/transcodings/ai-action-tracker-mcp/commit/a09f2d093c6aa570b929144015ab06317c99c8c8))
* **mcp:** expose create_stepup_session and poll_stepup_session tools ([7e4b929](https://github.com/transcodings/ai-action-tracker-mcp/commit/7e4b92934841854cfe54bf3aa86d1591a785a918))
* **mcp:** hello-world resource를 danger-patterns://list로 교체 ([efcc398](https://github.com/transcodings/ai-action-tracker-mcp/commit/efcc398877a638f0671c6dddd9592024fb90ee87))
* **patterns:** 사용자 패턴 add/update/remove + 명령 시뮬레이션 tool ([ad5fb61](https://github.com/transcodings/ai-action-tracker-mcp/commit/ad5fb61a3d36c34f98314f416af525dd6f5c93d9))
* **plugin-paths:** 모든 로컬 상태를 ~/.transcodes/state로 통합 ([5309551](https://github.com/transcodings/ai-action-tracker-mcp/commit/5309551ce5ffe5740cc56cee52ea230e57291fbf))
* **plugin-paths:** 모든 로컬 상태를 ~/.transcodes/state로 통합 ([e84aca1](https://github.com/transcodings/ai-action-tracker-mcp/commit/e84aca11c9c2a48fed936eb594bb3f89677205be))
* **plugin:** ai-action-tracker plugin 패키징 ([6eb58a1](https://github.com/transcodings/ai-action-tracker-mcp/commit/6eb58a141369dc7cf17cd02aa14fbb83b121a4a2))
* PreToolUse hook으로 위험 Bash 명령 차단 ([6634ac1](https://github.com/transcodings/ai-action-tracker-mcp/commit/6634ac1748c751eea35f98be65346503fe4a7d32))
* **release:** 4종 plugin npm 발행 + release-please atomic 릴리스 자동화 ([9f66444](https://github.com/transcodings/ai-action-tracker-mcp/commit/9f664447d0bd4e395c24e6cd3606c01553f1f90e))
* **stepup:** add Step-up MFA module — adapted from transcodes-mcp-server ([6a491ad](https://github.com/transcodings/ai-action-tracker-mcp/commit/6a491ad694e6d8a2e34fcac9849f1e1beb9cac6c))
* **stepup:** hand step-up flow off to agent — hook no longer polls ([fe0932c](https://github.com/transcodings/ai-action-tracker-mcp/commit/fe0932c0a71c405bc20a1cc68baa5145a4da12c0))
* **stepup:** poll_stepup_session_wait long-polling tool 도입 ([cefe338](https://github.com/transcodings/ai-action-tracker-mcp/commit/cefe338cde63e06df353c026433cae53c2ca5852))
* **stepup:** 진단·검증 흐름을 결정론적 MCP 도구로 강제 ([088b31e](https://github.com/transcodings/ai-action-tracker-mcp/commit/088b31e6ccac66304a43ef1bed758c0022051f8a))
* transcodes CLI 추가 + 기존 MCP server tools 통합 + reference-src 제거 ([#11](https://github.com/transcodings/ai-action-tracker-mcp/issues/11)) ([6e76085](https://github.com/transcodings/ai-action-tracker-mcp/commit/6e760857c135e91a00e3828cb161e04f6dae112e))
* transcodes GUI 대시보드 + 멀티토큰 + kill-switch 코어 ([#13](https://github.com/transcodings/ai-action-tracker-mcp/issues/13)) ([c64b666](https://github.com/transcodings/ai-action-tracker-mcp/commit/c64b6663d24a3dfebca81c301932b30f7cc42086))
* 런타임 enable/disable kill-switch 제어 표면 + GUI 비대칭 편입 ([#12](https://github.com/transcodings/ai-action-tracker-mcp/issues/12)) ([5de3add](https://github.com/transcodings/ai-action-tracker-mcp/commit/5de3add0463cfa904ed2a81624faaabb8727325b))
* 모노레포 재편 + Codex CLI plugin 추가 ([#6](https://github.com/transcodings/ai-action-tracker-mcp/issues/6)) ([be5f7ea](https://github.com/transcodings/ai-action-tracker-mcp/commit/be5f7ea32b75604a914283f42b4181ed75789e7b))


### Bug Fixes

* **cli:** package.json description를 실제 서브커맨드와 정합화 ([c2d3335](https://github.com/transcodings/ai-action-tracker-mcp/commit/c2d33350971b9684b5fd1be1784d2a10e519e803))
* **danger-patterns:** tracker-dashboard-launch 시스템 패턴 제거 ([608cbdd](https://github.com/transcodings/ai-action-tracker-mcp/commit/608cbdd9ad3caf587602ea706a255b77a0899946))
* **danger-patterns:** tracker-dashboard-launch 패턴 제거 (오탐 해소) ([3d19026](https://github.com/transcodings/ai-action-tracker-mcp/commit/3d19026cd611c0bf0b55cb9e9267c7cd806ddd6f))
* **danger-patterns:** 시스템 룰을 정적 import로 임베드해 번들 호환성 확보 ([64fd8fc](https://github.com/transcodings/ai-action-tracker-mcp/commit/64fd8fc6202a78341bc6801f5417ca4450a7d9c3))
* **hooks:** step-up 검증 후 fast-path가 explicit allow JSON emit ([803025c](https://github.com/transcodings/ai-action-tracker-mcp/commit/803025c5903cc56e72240d967ebcd04647612dff))
* **hooks:** stop hook 출력 JSON에 decision:"block" 추가 ([bb339ad](https://github.com/transcodings/ai-action-tracker-mcp/commit/bb339ad3fb6735b203f4652b1392e72499b9df76))
* **hooks:** Stop hook의 hookSpecificOutput 제거 — validator schema 정렬 ([aa7bd4a](https://github.com/transcodings/ai-action-tracker-mcp/commit/aa7bd4a18ebf521bc14f85a6c015b0ad475a1e8d))
* **plugin:** hooks.json 최상위 "hooks" 래퍼 추가 ([4b1dfaf](https://github.com/transcodings/ai-action-tracker-mcp/commit/4b1dfafbf7008bc921e8664cc6855f9d35eed8e3))
* **release:** 누락된 plugin 매니페스트·hook을 npm files에 포함 + CLAUDE.md 정합화 ([05db270](https://github.com/transcodings/ai-action-tracker-mcp/commit/05db2700b50b29e6fb0bffa1e2aa63bfc9af81dd))
* **stepup:** accept `url` as the browser-URL key in create response ([f2a078f](https://github.com/transcodings/ai-action-tracker-mcp/commit/f2a078f0011254d49c0924da62a3701a73b0babe))
* **stepup:** dedupe browser auto-launch across concurrent hook processes ([b6b2875](https://github.com/transcodings/ai-action-tracker-mcp/commit/b6b2875e9fe3bf340c1a76b7cab83b76e131e8d6))
* **stepup:** post-match fail-open 차단 — deny emit 이후 writePending ([6ff9779](https://github.com/transcodings/ai-action-tracker-mcp/commit/6ff9779ab3a40fd3a58ddcdc25404321b3b0b7fc))


### Documentation

* AI 보안 MCP 경쟁 리서치 + 부가 tool 4종 PRD 추가 ([a5d92d6](https://github.com/transcodings/ai-action-tracker-mcp/commit/a5d92d685536964db5e9feedeec6767b41c76a08))
* Claude Code plugin/marketplace 리서치 + 본 프로젝트 이주 전략 ([002c426](https://github.com/transcodings/ai-action-tracker-mcp/commit/002c42654f9f444c897f08c6948e39201fc4e457))
* document the Step-up MFA gate and asymmetric fail policy ([31752f0](https://github.com/transcodings/ai-action-tracker-mcp/commit/31752f0b53c378abc05d57ac655175bd066412c4))
* **prd:** add 0005 token-auth-device-flow PRD ([e38c821](https://github.com/transcodings/ai-action-tracker-mcp/commit/e38c8215e82dd0e6a71f66f4c7e119c16ae43b4b))
* README 맨앞에 로컬 plugin 설치 절차 추가 ([#8](https://github.com/transcodings/ai-action-tracker-mcp/issues/8)) ([5a12d58](https://github.com/transcodings/ai-action-tracker-mcp/commit/5a12d58ab812480b543a32b1bd66bbd13541d3c8))
* **readme:** plugin 설치 안내 + 5분 튜토리얼 추가 ([bb09c95](https://github.com/transcodings/ai-action-tracker-mcp/commit/bb09c958dcd99f83fcebb8f358747d32d77d20a0))
* **readme:** use-case driven 재작성 — hook 메인 기능 노출 ([3954d9c](https://github.com/transcodings/ai-action-tracker-mcp/commit/3954d9c342d5a114ce5093239d9aaa1a16450e6d))
* **research:** Codex·Antigravity 2.0·Cursor hook/plugin 호환성 리서치 추가 ([916ef3e](https://github.com/transcodings/ai-action-tracker-mcp/commit/916ef3eb81cf4d9d7b60a59aa5b56945585e4444))
* **research:** MCP 서버 배포 전략 + 멀티호스트 plugin 배포 리서치 2건 추가 ([ece92c7](https://github.com/transcodings/ai-action-tracker-mcp/commit/ece92c7ae723b3ff775e3d5c74437bff4b5d115a))
* **tools:** 한국어 트리거 키워드를 tool description에 추가 ([67e0606](https://github.com/transcodings/ai-action-tracker-mcp/commit/67e0606626d8d7dd3b3362eb3f2b8d4da333aa79))
* update paths and structure policy for monorepo layout ([9dee2ad](https://github.com/transcodings/ai-action-tracker-mcp/commit/9dee2ada6771f207723b9d2187b148aaccafb6b9))
* 데이터 저장 위치를 ~/.transcodes/state 통합 기준으로 갱신 ([950222d](https://github.com/transcodings/ai-action-tracker-mcp/commit/950222d74b6dbd7f036992643bebcd3ced43afc7))
* 문서 구조 정비 + createServer TSDoc 추가 ([ae0fe8c](https://github.com/transcodings/ai-action-tracker-mcp/commit/ae0fe8c351d5732c9309241e4ea9f3f1e486b5f1))
* 코드 현재 상태에 맞춰 문서·룰 일괄 정합화 + hook 도구명 drift 제거 ([be82f3e](https://github.com/transcodings/ai-action-tracker-mcp/commit/be82f3e9f3ce4f998d9b894696d3858423411e5b))


### Code Refactoring

* **monorepo:** align source into plugins/ai-action-tracker/ (정리안 2) ([866e52b](https://github.com/transcodings/ai-action-tracker-mcp/commit/866e52b8ad7d3790cc5a2e1364e88f0b0fc4a63e))

## Changelog

이 파일은 [release-please](https://github.com/googleapis/release-please)가 main의
conventional commit(`feat:` / `fix:` / `perf:` …)을 읽어 릴리스마다 자동으로 갱신합니다.
**수동 편집하지 마세요** — 다음 릴리스에서 덮어쓰여집니다.

`@bigstrider/transcodes-guard-{claude-code,codex,antigravity,cursor}` 4종은 항상 동일
버전으로 함께 릴리스되며, 이 단일 CHANGELOG가 그 공통 릴리스 트레인의 변경 이력입니다.
