---
id: token-auth-device-flow
title: Plugin 인증 토큰을 Device Code Flow + OS Keychain으로 발급·보관
status: draft
priority: P2
effort: L
value: high
category: infrastructure
owner: unassigned
created: 2026-05-14
updated: 2026-05-14
version: 0.1
depends_on: []
related: []
references:
  - src/stepup/config.ts
  - hooks/pre-tool-use.ts
  - https://datatracker.ietf.org/doc/html/rfc8628
  - https://cli.github.com/manual/gh_auth_login
  - https://github.com/atom/node-keytar
tags: [auth, secrets, device-flow, keychain, plugin, dx]
---

# Plugin 인증 토큰을 Device Code Flow + OS Keychain으로 발급·보관

## 컨텍스트 & 문제 정의

현재 `ai-action-tracker` plugin은 Transcodes 백엔드에 붙기 위해 `TRANSCODES_TOKEN`(Member MCP JWT)을 요구한다(`src/stepup/config.ts`). 사용자가 토큰을 얻으려면:

1. Transcodes 콘솔에 로그인해 직접 토큰을 복사
2. `~/.zshrc`(또는 동급 rc 파일)에 `export TRANSCODES_TOKEN="..."`를 평문으로 박음
3. 셸 reload 후 `claude` 재시작

문제점:
- **평문 노출**: dotfiles 리포에 실수로 커밋되면 즉시 유출. JWT는 만료 전까지 회수 어려움.
- **머신 단위 수동**: 새 머신마다 사용자가 반복. CI/CD 환경마다 별도 secret store 구성 필요.
- **토큰 회전 불편**: 만료(`exp` claim)되면 사용자가 다시 콘솔→복사→rc 편집 사이클.
- **plugin 첫 경험 불일치**: marketplace에서 `/plugin install` 두 줄로 끝났는데 실제 사용은 토큰 발급 절차 한 단계 더. plugin install ≠ ready-to-use.

업계 표준은 OAuth 2.0 **Device Authorization Grant**(RFC 8628) + OS Keychain 보관이다 — `gh auth login`, `vercel login`, `stripe login`이 모두 이 패턴. 우리 plugin도 같은 UX로 정렬하면 marketplace 사용자에게 "install → 자동 로그인 → 즉시 사용"이 가능해진다.

추가 보너스: 우리는 이미 step-up MFA(`src/stepup/`)로 WebAuthn 흐름을 다루므로, **device code 화면 자체를 step-up으로 처리**하면 토큰 발급 = 첫 step-up이 되어 인증 UX가 자연스럽게 합쳐진다.

## 목표 (Goals)

1. plugin 사용자가 `claude` 세션 안에서 슬래시 명령(또는 plugin 첫 호출 시) `transcodes_login` MCP tool을 실행하면 브라우저가 열리고, WebAuthn 후 로컬에 토큰이 저장되도록 한다.
2. 저장 위치는 OS 표준 keychain:
   - macOS: Keychain (Generic Password)
   - Linux: libsecret (gnome-keyring/KWallet)
   - Windows: Credential Manager (wincred)
3. 이후 hook/MCP는 환경변수가 없어도 keychain에서 토큰을 load. 환경변수가 있으면 환경변수 우선(기존 호환).
4. 토큰 만료 임박(예: `exp` 잔여 < 24h)이면 자동 갱신 시도. 갱신 실패 시 사용자에게 재로그인 안내.
5. `transcodes_logout` tool로 keychain 항목 삭제.

## 비목표 (Non-Goals)

- OS keychain이 없는 환경(헤드리스 컨테이너, CI runner)의 일급 지원 — 환경변수 fallback으로 충분.
- 다중 계정/프로파일 — 1머신 1토큰. 후속 PRD에서 다룸.
- 자체 OAuth 서버 구축 — Transcodes 백엔드가 device authorization endpoint를 제공한다고 가정(미구현 시 백엔드 PRD 선행).
- 토큰 자체의 회전 정책 변경 — 현재 백엔드 정책 유지.

## 사용 시나리오

### S1. 첫 설치 후 자동 로그인 (행복 경로)

```
사용자: /plugin install ai-action-tracker@ai-action-tracker-mp
Claude Code: ✅ installed.

사용자: rm -rf /etc 같은 거 한번 막아봐
Claude:   (Bash 호출 시도)
hook:    위험 패턴 감지 — TRANSCODES_TOKEN 없음
         → 환경변수 비어 있음, keychain도 비어 있음
         → stderr: "Run /transcodes-login to authenticate (one-time setup)."
         → exit 2

사용자: /transcodes-login
Claude:   transcodes_login tool 호출
plugin:  device code 받음 → 브라우저 자동 open
         "Code: ABCD-EFGH"
브라우저: 사용자 WebAuthn 통과
plugin:  토큰 받음 → keychain 저장 → "Logged in as kim@example.com"

사용자: 다시 위험 명령 시도
hook:    keychain에서 토큰 load → step-up 게이트 → 통과
```

### S2. 환경변수 override (CI, 개발자)

`TRANSCODES_TOKEN` env가 있으면 keychain을 무시하고 그 값 사용. CI runner나 dotfiles 기반 워크플로 호환.

### S3. 토큰 만료 임박

hook이 토큰을 load할 때 `exp` 잔여 < 24h이면 backend의 refresh endpoint를 한 번 시도. 성공 → keychain 갱신. 실패 → 정상 흐름 진행(아직 만료는 안 됐으므로) + stderr에 1줄 경고.

### S4. 명시적 logout

```
/transcodes-logout
→ keychain에서 항목 삭제 + stderr "Logged out."
```

## 기능 요구사항

### FR-1. 새 MCP tool 2개

`src/server.ts`에 등록:

| Tool | 인자 | 동작 |
|---|---|---|
| `transcodes_login` | (없음) | device authorization 시작 → browser_url을 결과로 반환 + 백그라운드 폴링(또는 별도 `transcodes_login_poll` tool로 분리) → 성공 시 keychain write |
| `transcodes_logout` | (없음) | keychain 항목 삭제 |

### FR-2. 토큰 우선순위

`loadStepupConfig()`가 토큰을 가져오는 순서:

```
1. process.env.TRANSCODES_TOKEN (트림 후 빈 문자열이 아닐 때)
2. keychain.get("ai-action-tracker", "transcodes-token")
3. (없음) → 호출자가 fail-safe 처리
```

환경변수 우선 정책은 명시적 override를 가능케 하고, 기존 사용자 경험을 깨지 않는다.

### FR-3. 새 모듈 `src/stepup/keychain.ts`

```ts
export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

export function createTokenStore(): TokenStore;
```

내부 구현:
- 기본은 `keytar` (또는 maintained fork인 `@napi-rs/keyring`) 사용.
- keychain API 호출 실패(헤드리스 리눅스 + no D-Bus) → **암호화된 fallback 파일**(`store.ts`와 같은 캐시 디렉터리에 OS user 권한 0600, AES-GCM with machine-bound key 또는 그냥 0600 평문)로 graceful degradation. 디폴트는 평문 0600 + warn 로그(보안과 단순성 트레이드오프; FR-7 미해결 질문 참조).

### FR-4. Device Authorization Flow (백엔드 가정)

Transcodes 백엔드가 RFC 8628 표준 endpoint 2개를 제공한다고 가정:

```
POST /v1/auth/device/code
  → { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }

POST /v1/auth/device/token
  body: { device_code, client_id: "ai-action-tracker" }
  → 200: { access_token, expires_in, refresh_token? }
  → 400 authorization_pending: 계속 폴링
  → 400 slow_down: interval 증가
  → 400 expired_token: 만료, 처음부터
  → 400 access_denied: 사용자 거부
```

`access_token`은 기존과 동일한 형식(Member MCP JWT)으로 발급되어야 한다 — 그래야 `parseMemberAccessToken()`을 그대로 재사용.

### FR-5. 사용자 보이는 UX

`transcodes_login` 응답 텍스트:
```
🔐 Open this URL in your browser to authenticate:

  https://app.transcodes.com/device?code=ABCD-EFGH

Verification code: ABCD-EFGH
Expires in: 5 minutes

After completing WebAuthn, call transcodes_login_poll (or wait — I'll
keep checking every 5s).
```

### FR-6. Hook 통합

`hooks/pre-tool-use.ts`의 fail-safe 분기에 토큰 부재 시 안내 메시지 갱신:

```
Step-up MFA gate is not configured.
  → Run /transcodes-login once to authenticate this machine.
  → Or set TRANSCODES_TOKEN env if you manage tokens out-of-band.
```

### FR-7. 토큰 만료 사전 갱신

`loadStepupConfig()`에 옵션 추가:
```ts
loadStepupConfig({ refreshIfExpiringWithin: 24 * 3600 })
```

`exp - now < threshold`이면 비동기로 refresh 시도. 실패해도 현재 토큰 그대로 반환(아직 만료 전이므로 동작 가능).

## 구현 스케치

### 새 파일

- `src/stepup/keychain.ts` — TokenStore 인터페이스 + keytar 구현 + 파일 fallback.
- `src/stepup/device-flow.ts` — RFC 8628 클라이언트(create device code → poll → return JWT).

### 수정 파일

- `src/stepup/config.ts`:
  - `loadStepupConfig()`가 env → keychain 순으로 토큰 조회.
  - 모든 호출처에서 동기 → 비동기로 변경(또는 sync wrapper 유지하고 keychain은 lazy load).
- `src/server.ts`:
  - `transcodes_login`, `transcodes_logout` tool 등록.
- `hooks/pre-tool-use.ts`:
  - 토큰 부재 메시지 갱신.
  - keychain 조회를 위해 hook 내부에서도 비동기 흐름 도입.
- `package.json`:
  - `keytar` 또는 `@napi-rs/keyring` 의존성 추가.
  - **주의**: plugin 배포 트리는 node_modules 없이 동작해야 하므로(`plugins/ai-action-tracker/dist/`), keychain 라이브러리는 native bindings 포함. plugin packaging 시 prebuilt binary를 함께 dist에 복사하는 빌드 단계 추가 필요. 이 항목은 미해결 질문 1에서 다룸.
- README/CLAUDE.md:
  - 환경변수 export 방식은 "고급/CI" 절로 강등.
  - 첫 사용자 가이드를 `/transcodes-login`으로 변경.

## 트레이드오프 & 리스크

| 결정 | 트레이드오프 |
|------|-------------|
| OS keychain 사용 | 표준·안전 ↔ native binding 의존, plugin packaging 복잡도 ↑ |
| 환경변수를 keychain보다 우선 | 기존 사용자/CI 호환 ↔ "분명히 로그아웃 했는데 왜 동작?" 같은 디버깅 혼란 — `/transcodes-status` tool로 현재 출처 표시 권장 |
| 평문 파일 fallback | 헤드리스 환경 지원 ↔ 결국 평문, 명목상 보안만. 차라리 헤드리스에선 env 강제도 검토 |
| Device flow를 MCP tool로 노출 | Claude가 직접 호출 가능, slash 명령으로도 wrap ↔ tool이라 자동 호출 가능성 — 정책 명확화 필요 |
| 자동 refresh | UX 매끄러움 ↔ 갱신 실패가 silent해질 위험 — refresh 실패는 stderr warn 필수 |

리스크:
- **백엔드 의존**: device authorization endpoint 미존재 시 본 PRD는 백엔드 PRD 선행 의존.
- **Native binding 빌드**: macOS/Linux/Windows 각각 prebuilt 또는 빌드 환경 필요. plugin marketplace 사용자가 빌드 환경 없으면 동작 안 함.
- **keychain unlock prompt**: macOS Keychain은 처음 read 시 사용자 확인 다이얼로그가 뜰 수 있음. 백그라운드 hook에서 이게 발생하면 hook timeout 가능 — keychain access group 설정으로 회피 검토.

## 미해결 질문

1. **Plugin packaging과 native binary**: keytar 등 native binding을 plugin dist에 어떻게 동봉? 옵션:
   (a) `@napi-rs/keyring`처럼 prebuilt를 npm 패키지에 포함하는 라이브러리 선택 → dist에 `node_modules` 일부 같이 복사.
   (b) plugin install 단계에서 `npm install` 트리거(Claude Code plugin manifest의 install hook 가능 여부 미확인).
   (c) keychain 의존 자체를 포기하고 OS별 CLI(`security`, `secret-tool`, `cmdkey`)를 spawn — 의존 없음. 권장 후보.
2. **헤드리스 환경 정책**: keychain 없을 때 (a) env 강제 (b) 0600 평문 파일 fallback (c) 거부하고 사용자가 명시적으로 `--allow-plaintext` 옵션. 보안/UX 균형.
3. **Hook의 비동기 keychain 조회 비용**: 매 Bash 호출마다 keychain access는 50ms+ 가능. 첫 호출 후 메모리 캐시(프로세스 단위지만 hook은 단발)? 또는 hook이 마지막 토큰을 cache 파일로 빠르게 두는 dual-store?
4. **Refresh token 지원 여부**: Transcodes 백엔드가 refresh token을 발급하는가? 안 한다면 만료 임박 시 사용자에게 재로그인 안내만 가능.
5. **Slash 명령 vs MCP tool 노출**: `/transcodes-login`을 plugin이 정의 가능한가? Claude Code plugin manifest의 commands 필드 검토. MCP tool로만 노출하면 사용자가 자연어로 "log in"이라 해야 동작.

## 검증 기준 (Acceptance Criteria)

- [ ] `transcodes_login` tool이 device code + verification URL을 반환한다.
- [ ] WebAuthn 완료 후 토큰이 OS keychain에 저장된다(macOS: `security find-generic-password -s ai-action-tracker` 로 확인).
- [ ] `TRANSCODES_TOKEN` env가 없는 셸에서도 hook이 위험 명령을 정상적으로 게이트한다(keychain load 동작).
- [ ] `TRANSCODES_TOKEN` env가 있으면 keychain 무시(우선순위 회귀 테스트).
- [ ] `transcodes_logout` 후 keychain 항목이 삭제되고 hook은 다시 fail-safe로 차단한다.
- [ ] 토큰 만료 24h 전 hook 호출 시 자동 refresh 시도(성공/실패 양 경로 테스트).
- [ ] 헤드리스 Linux(D-Bus 없음)에서 plugin이 명확한 에러 메시지로 fallback을 안내한다.
- [ ] 빌드/패키징: `npm run build:plugin` 후 `plugins/ai-action-tracker/dist/`만으로 정상 동작(외부 `npm install` 불필요).
- [ ] README 첫 사용자 절이 `/transcodes-login` 흐름으로 갱신된다.
- [ ] CLAUDE.md에 "토큰 출처 우선순위(env → keychain)" 규칙이 명시된다.
