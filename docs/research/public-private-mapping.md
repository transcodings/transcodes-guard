# transcodes-guard 코드 민감도 매핑 (공개 준비용)

> 이 문서는 **현재 코드 트리**(공개 전 상태)에서 어떤 파일이 어느 정도 민감한지를 매핑한다. 분리 작업의 베이스라인이자, 향후 새 코드가 들어올 때 어느 디렉터리에 둘지 결정하는 기준이다. 동반 문서: [`public-private-split.md`](./public-private-split.md) (사례 비교/분리 전략).

## 1. 민감도 등급 기준

| 등급 | 의미 | 처리 |
|---|---|---|
| **HIGH** | 노출되면 보안 취약점 또는 영업비밀 유출. Transcodes 백엔드 스키마/엔드포인트/인증 흐름을 직접 드러냄. | `private-packages/`로 이동, publish 차단 |
| **MED** | 직접 비즈니스 로직은 아니지만, 내부 도구명/URL/플로우를 텍스트로 노출. | 마스킹/일반화 후 공개 가능 |
| **LOW** | 호스트 어댑터, 빌드 설정, 일반 보안 패턴, 공개 표준 구현. | 공개 가능 |

---

## 2. HIGH (차단 권장)

### 2.1 `packages/stepup-core/`

전체 패키지가 Transcodes 백엔드와의 통신 + step-up MFA 평가 로직.

| 파일 | 내용 | 노출 시 위험 |
|---|---|---|
| `src/client.ts` | Transcodes API HTTP 클라이언트 (`/v1/auth/temp-session/step-up/session`, `x-transcodes-token` 헤더) | API 표면 노출, 토큰 검증 흐름 리버스 엔지니어링 |
| `src/config.ts` | `DEFAULT_BACKEND_URL = "https://api.transcodesapis.com"` 하드코딩 | 공격 대상 명확화 (현재는 소스 접근자만 알고 있음) |
| `src/session.ts` | step-up 세션 생성/폴링, `organization_id` / `project_id` / `member_id` 스키마 | 내부 도메인 모델 노출, 멤버십 모델 추론 가능 |
| `src/jwt.ts` | JWT 파싱/검증, 클레임 구조 | 토큰 구조 분석 → 위조 시도 표면 |
| `src/token-store.ts` | 토큰 저장 경로/포맷 (`~/.transcodes/`) | 토큰 탈취 경로 명확화 |
| `src/evaluate.ts` | 게이트 결정 로직 (어떤 조건에서 step-up을 요구하는지) | 우회 패턴 추론 가능 |

**결정**: 패키지 전체를 `private-packages/stepup-core/`로 이동.

### 2.2 `packages/mcp-server-core/src/tools/` 일부

`createServer()` 자체는 공개 OK, 도구 구현 중 백엔드 통신부가 HIGH.

| 파일 | 내용 |
|---|---|
| `tools/transcodes-client.ts` | 27개 MCP 도구명 ↔ 백엔드 endpoint 매핑 (`ENDPOINT_MAP`) |
| `tools/members.ts` | 멤버 생성/조회/`retire_member` 등 |
| `tools/organization.ts` | 조직 관리 (생성/수정/조회) |
| `tools/rbac.ts` | 역할/권한 (`set_role_permissions` 등) |
| `tools/membership.ts` | 멤버십 세션 (`membership/mcp/session`) |
| `tools/passcode.ts` | 패스코드 생성/검증 |
| `tools/auth-devices.ts` | WebAuthn 디바이스 관리 |

**결정**: 신규 `private-packages/transcodes-mcp-tools/`로 추출. `packages/mcp-server-core/`는 `createServer()` + 도구 등록 인터페이스만 유지.

### 2.3 `packages/danger-patterns/src/data/tool-rules.json`

8개 보호 도구 ↔ `stepupAction`/`stepupResource` 매핑.

```json
// 예시 (실제 파일 참조)
{
  "retire_member": { "stepupAction": "...", "stepupResource": "..." },
  "set_role_permissions": { ... }
}
```

노출 시: 어떤 백엔드 도구가 보호되는지, 보호 액션/리소스 분류 체계가 드러남. **공격자에게 "어디부터 공격할지"의 지도가 됨**.

**결정**: 신규 `private-packages/danger-rules/`로 추출. `packages/danger-patterns/`는 일반 정규식 패턴(`danger-patterns.json`)만 유지.

### 2.4 `packages/cli/src/` 중 토큰/백엔드 모듈

전체 CLI는 사용자 진입점이라 공개되어야 하지만, 내부 모듈 중 백엔드 통신 / 토큰 저장 / kill-switch 보호 로직은 HIGH.

| 영역 | 처리 |
|---|---|
| 명령 라우팅 (`enable`, `disable`, `status`, `tokens`, `dashboard`) 진입점 | LOW (공개 유지) |
| 토큰 저장 구현, JWT 디코딩, 백엔드 호출 | HIGH (`private-packages/cli-bits/`로 추출) |

---

## 3. MED (마스킹 후 공개)

### 3.1 `docs/architecture.md`

설계 의도(왜 stdio/HTTP 두 transport를 두는지, 왜 PreToolUse hook에서 게이트하는지 등)는 공개 가치가 크다. 다만 다음 라인은 마스킹:

- 구체 endpoint URL (`/auth/member/revocation` 등) → "`<backend endpoint>`"로 일반화
- 내부 도메인 필드명 (`organization_id`, `session.sid`) → "`<context fields>`"
- 보호 도구 구체명 → "민감 MCP 도구"

### 3.2 `README.md`

전체적으로 한국어 사용자 가이드라 공개 OK. 단, "무엇이 차단되나" 섹션에서 `retire_member`, `tool-rules.json` 구체명 언급 부분만 일반화.

---

## 4. LOW (공개 OK)

| 영역 | 근거 |
|---|---|
| `packages/hook-adapters/` | 호스트별 stdin/stdout JSON 변환. MCP/Claude Code/Codex/Antigravity/Cursor hook spec은 모두 공개 표준. |
| `packages/plugin-paths/` | `~/.transcodes/`, `~/.cache/` 경로 해상. 표준 `os.homedir()` 처리. |
| `packages/danger-patterns/src/data/danger-patterns.json` | rm -rf, dd, mkfs 등 일반 위험 패턴. 다른 보안 도구도 사용 중. |
| `packages/mcp-server-core/src/server.ts`, `transport.ts` | `createServer()` 코어, Streamable HTTP 전송. MCP spec 구현. |
| `plugins/*/` 전체 | 매니페스트 + hook 진입점. 마켓플레이스 배포에 필요. |
| `tsup.config.ts`, `turbo.json`, `npm workspace` 설정 | 일반 모노레포 빌드 설정. |
| `.github/workflows/*` | CI/release-please 자동화. 백엔드 비밀 없음. |
| `docs/research/*` (대부분) | 외부 공개 자료 기반 종합. 내부 스키마 미포함. |

---

## 5. 의존 그래프 (현재)

```
plugins/*/hooks/*.ts            (LOW, 진입점)
        ↓
packages/hook-adapters          (LOW, wire format)
        ↓
packages/stepup-core            (HIGH) ← evaluate 호출
        ↓
packages/stepup-core/client     (HIGH) ← 백엔드 API

plugins/*/src/stdio.ts          (LOW)
        ↓
packages/mcp-server-core        (LOW shell)
        ↓
packages/mcp-server-core/tools  (HIGH 일부)
        ↓
백엔드 API

packages/cli/src/index.ts       (mixed)
        ├── 라우팅 (LOW)
        └── 토큰/백엔드 (HIGH)
```

**경계 검출 포인트** (phase 2에서 인터페이스로 차단할 곳):
1. `hook-adapters` → `stepup-core.evaluate()` 호출
2. `mcp-server-core.createServer()` → 도구 등록
3. `cli` → 토큰/백엔드 모듈

---

## 6. 이동 후 디렉터리 (phase 1 종료 상태)

```
packages/                                # 공개
  plugin-paths/
  danger-patterns/                       # danger-patterns.json만
  mcp-server-core/                       # 코어 + 등록 인터페이스
  hook-adapters/
  cli/                                   # 진입점/라우팅만

private-packages/                        # 비공개
  stepup-core/                           # ← packages/stepup-core/ 전체
  transcodes-mcp-tools/                  # ← mcp-server-core/src/tools/ 일부
  danger-rules/                          # ← tool-rules.json
  cli-bits/                              # ← CLI 토큰/백엔드 모듈

plugins/                                 # 공개
  claude-code-ai-action-tracker/
  codex-ai-action-tracker/
  antigravity-ai-action-tracker/
  cursor-ai-action-tracker/
```

## 7. 검증 체크리스트

배포 모델: GitHub repository를 공개 채널로 사용. 호스트(Claude Code/Codex/Antigravity/Cursor)는 repo URL을 직접 참조해 plugin을 설치한다. CLI(`@bigstrider/transcodes-cli`)만 예외로 npm을 쓰며, 그 tarball은 tsup이 private-packages를 inline해 빌드한다.

- [ ] 모든 HIGH 파일이 `private-packages/` 아래에 있는가?
- [ ] `packages/*/package.json`의 `"files"` allowlist가 명시되어 있는가?
- [ ] `private-packages/*/package.json`에 `"private": true` 가 있는가? (CI `Public-mirror surface` 스텝이 강제)
- [ ] biome가 `packages/**` → `@transcodes-guard-private/*` import를 `noRestrictedImports` warn으로 검출하는가?
- [ ] `docs/architecture.md`, `README.md`에 구체 endpoint/도구명이 남아 있지 않은가?
- [ ] `git filter-repo --invert-paths --path private-packages/ --dry-run` 가 의도대로 동작하는가? (공개 미러 추출 한 줄)
- [ ] CLI tarball을 dry-build해 dist/index.js에 백엔드 URL/엔드포인트 문자열이 직접 노출되지 않는지 grep으로 확인했는가?

## 8. 후속 phase 트래킹

| Phase | 항목 |
|---|---|
| 2 | `GateBackend` DI 인터페이스 추출, 경계 lint를 `error`로 승격 |
| 2 | 정책 결정의 백엔드 이관 (Clerk 모델) |
| 3 | CLI tarball의 private 부분 obfuscation 또는 thin loader 모델 도입 |
| 4 | `git filter-repo`로 공개 미러 분리 후 GitHub repo 공개 |
