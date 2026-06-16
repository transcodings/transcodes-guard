# transcodes-guard

AI 코딩 에이전트(Claude Code / Codex / Antigravity / Cursor)가 실행하려는 **위험한 셸 명령을 실행 직전에 가로채** Transcodes **Step-up MFA**(WebAuthn) 인증을 요구하는 PreToolUse hook + MCP 서버입니다. 인증을 통과한 명령만 실행됩니다.

> 답하는 질문: **"에이전트가 `rm -rf` 같은 위험 명령을 실행하기 전에 어떻게 멈추지?"**

GitHub 리포는 `transcodings/ai-action-tracker-mcp`, 배포 제품명·플러그인은 `transcodes-guard`입니다. 4개 호스트가 **하나의 git 리포**에서 빌드된 같은 코어를 각자 네이티브 방식으로 설치합니다.

---

## 동작 방식 (한눈에)

1. 에이전트가 Bash 명령(또는 보호된 MCP 도구)을 호출하려 함.
2. PreToolUse hook이 위험 패턴(정규식 + `rm -rf` git-추적 의미 분석) 또는 보호 도구를 감지 → **차단**하고 WebAuthn 인증 URL을 띄움.
3. 사용자가 브라우저에서 WebAuthn 완료 → 에이전트가 MCP 도구 `poll_stepup_session_wait`(서버측 long-polling)로 검증 확인.
4. 검증된 상태에서 **같은 명령을 재시도**하면 hook이 통과시킴(단발 — 다음 위험 명령은 다시 인증).

차단은 **fail-safe**, 위험 매칭 전의 오류는 **fail-open**(안전 명령을 막지 않음). 상세 설계: [`docs/architecture.md`](./docs/architecture.md).

---

## 설치

### Claude Code (메인)

마켓플레이스 = 이 리포. 세션 안에서 두 줄:

```
/plugin marketplace add transcodings/ai-action-tracker-mcp
/plugin install transcodes-guard@bigstrider
```

`dist/`가 리포에 커밋돼 있어 클론 즉시 설치됩니다. 사내/팀 한정이면 리포를 private로 두고 접근 권한이 있는 멤버만 설치하면 됩니다(설치 시점에 각자의 git 자격으로 clone). 끄려면 네이티브 `/plugin disable transcodes-guard`.

팀 자동 등록은 프로젝트 `.claude/settings.json`에:

```json
{
  "extraKnownMarketplaces": [{ "source": "github", "repo": "transcodings/ai-action-tracker-mcp" }],
  "enabledPlugins": ["transcodes-guard@bigstrider"]
}
```

### 그 외 호스트 (npm 미사용 — 각자 네이티브 방식)

| 호스트 | 설치 | 가이드 |
|---|---|---|
| OpenAI Codex CLI | Codex 네이티브 마켓플레이스(`.agents/plugins/marketplace.json` + `git-subdir`) | [`plugins/codex/README.md`](./plugins/codex/README.md) |
| Google Antigravity 2.0 | `agy plugin install <git-url>` | [`plugins/antigravity/README.md`](./plugins/antigravity/README.md) |
| Cursor IDE | `install.sh` (`.cursor/hooks.json` + `mcp.json` 작성) | [`plugins/cursor/README.md`](./plugins/cursor/README.md) |

호스트별 배포 메커니즘 정리: [`docs/research/multi-host-plugin-distribution.md`](./docs/research/multi-host-plugin-distribution.md). plugin 없이 hook을 수동 등록하려면: [`docs/hook-installation.md`](./docs/hook-installation.md).

---

## 무엇이 차단되나

- **Bash 정규식**: `rm -rf /`·`rm -rf *`·`mkfs`·`dd of=/dev/…`·`curl … | bash`·fork bomb·`chmod -R … ~/`·보호 브랜치 force-push 등(system 패턴) + 사용자 추가 패턴.
- **`rm -rf <상대경로>` 의미 분석**: cwd 기준으로 풀어 `git ls-files`로 추적 파일 포함 시 차단 — 정규식이 못 잡는 사각지대.
- **보호된 MCP 도구**: 사전 정의된 민감 도구 목록(예: 멤버 정리, 권한 변경, 패스코드 발급 등). 시스템 룰셋은 비공개 정책 데이터로 분리되어 있고, 사용자 정의 추가만 `add_tool_rule` MCP 도구로 가능합니다.

패턴 커스터마이징(재빌드 불필요): MCP 도구 `add_user_pattern` / `add_tool_rule` 또는 사용자 JSONC 파일(`//` 주석·trailing comma 허용). 시스템 패턴은 빌드에 임베드됩니다. 미리 확인은 `simulate_command` / `simulate_hook_invocation` / `inspect_stepup_state`.

**알려진 한계**: 셸 quoting 미인식(`echo "rm -rf /"`도 매칭될 수 있음), 정규식 우회 일부 가능(1차 방어선), 비-git 디렉토리에선 의미 분석 skip.

---

## `transcodes` CLI — 토큰 + 대시보드

Step-up 백엔드 호출에 필요한 멤버 토큰은 `@bigstrider/transcodes-cli`가 `~/.transcodes/config.json`에 저장합니다. 게이트 on/off 토글은 없습니다 — 보호를 끄려면 호스트 네이티브 방식으로 플러그인을 disable/uninstall 하세요.

```bash
transcodes status     # 활성 토큰 출처 + 만료
transcodes tokens     # 저장된 토큰 목록
transcodes set <token> -l <label>  # 토큰 저장
transcodes            # 무인자 → GUI 대시보드
```

---

## 데이터 저장 위치

모든 로컬 상태는 `~/.transcodes/state/`에 통합 저장됩니다(멤버 토큰 `config.json`과 같은 제품 홈). 사용자 룰(`user-patterns.json` 등)·step-up 상태(`stepup-pending.json` 등)가 여기 있습니다. 과거 경로(`$CLAUDE_PLUGIN_DATA`, `~/.claude/ai-action-tracker/`, OS 캐시)는 첫 호출 시 자동 마이그레이션 소스로만 남습니다(원본은 `*.bak`). 배경: [`docs/research/mcp-state-persistence-patterns.md`](./docs/research/mcp-state-persistence-patterns.md).

---

## 릴리스 (발행은 보류)

`.github/workflows/release.yml`은 **release-please 자동화만** 수행합니다: main의 conventional commit → Release PR → 머지 시 버전 bump + 루트 `CHANGELOG.md` + git tag(`transcodes-guard-vX.Y.Z`). **실제 npm publish/배포 단계는 없습니다** — 배포 채널을 아직 확정하지 않았기 때문입니다(npm은 Claude Code 한정 선택 채널, 나머지는 git+네이티브). 기능 개발 동안 버전·CHANGELOG·tag 기록만 유지되고, 채널이 정해지면 publish 단계를 추가합니다. 정리: [`docs/research/multi-host-plugin-distribution.md`](./docs/research/multi-host-plugin-distribution.md).

---

## 개발

```bash
npm install            # 워크스페이스 설치
npm run build:plugin   # 빌드 + dist 동기화 (5곳: packages/* + 4 plugins)
npm run dev:stdio      # stdio 트랜스포트 핫리로드 (Inspector·외부 MCP 클라이언트)
npm run dev:http       # Streamable HTTP, :3000/mcp
npm run dev:hook       # PreToolUse hook 단발 실행 (stdin JSON)
npm run inspect        # MCP Inspector UI
```

요구: Node.js ≥ 20. 소스 수정 후 반드시 `npm run build:plugin` → `dist/` 커밋(CI가 5곳 동기성 + hook smoke test 23종 강제). 새 도구/리소스/프롬프트는 `packages/mcp-server-core/src/server.ts`의 `createServer()` 한 곳에서만 추가합니다 → [`docs/adding-capabilities.md`](./docs/adding-capabilities.md). 에이전트용 작업 규칙은 [`CLAUDE.md`](./CLAUDE.md) + [`.claude/rules/`](./.claude/rules/).

---

## 참고

- 설계 의도(트랜스포트 분리·Streamable HTTP·인증 미비점) → [`docs/architecture.md`](./docs/architecture.md)
- 능력 추가 절차 → [`docs/adding-capabilities.md`](./docs/adding-capabilities.md)
- 수동 hook 설치 → [`docs/hook-installation.md`](./docs/hook-installation.md)
- 다중 호스트 배포 조사 → [`docs/research/multi-host-plugin-distribution.md`](./docs/research/multi-host-plugin-distribution.md)
- 향후 기능 PRD → [`docs/prd/`](./docs/prd/)
- Claude Code hooks 공식 문서 → <https://code.claude.com/docs/en/hooks>

## 라이선스

MIT
