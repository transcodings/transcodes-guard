# 호스트별 plugin variant 다운로드·배포 방식 — 브리프

> 날짜: 2026-05-31 | 키워드: Codex / Antigravity / Cursor plugin 설치·배포
> 생성: /web-research --brief (Perplexity + Brave, 15+ 소스 종합)
> 관련: [plugin-vs-mcp-server-deployment.md](./plugin-vs-mcp-server-deployment.md) (1차 — MCP 서버 vs plugin 배포)

## 요약

네 플랫폼은 **배포 메커니즘이 완전히 다르며, 어느 것도 plugin을 npm publish하지 않는다.** Claude Code만 전용 plugin marketplace를 쓰고, Codex는 자체 1st-party plugin directory, Antigravity는 VS Code 확장 생태계(VSX/.vsix), Cursor는 로컬 JSON config를 쓴다. 공통점은 **plugin이 MCP 서버를 번들**하고 호스트별 네이티브 등록 방식으로 설치된다는 것 — npm은 CLI 바이너리 배포 채널일 뿐 plugin 배포 채널이 아니다.

## 핵심 포인트

- **Codex CLI** — 1st-party plugin 시스템(앱 Plugins 패널 + CLI `plugin` 디렉토리). `~/.codex/config.toml`로 enable/disable, repo "sources"로 사설/org 레지스트리 지원. **Codex plugin은 npm 패키지가 아님** — Codex 전용 배포. (신뢰도 높음)
- **Antigravity** — VS Code fork. 전용 marketplace 없이 **VS Code Marketplace/VSX 또는 `.vsix`**로 확장 설치. `engines.vscode` 메타데이터로 다수 VS Code 호환 호스트를 한 패키지가 타겟 가능. npm 아님. (신뢰도 높음)
- **Cursor** — VS Code 호환 + 자체 Hooks. ① VSX 확장, ② Cursor 전용 `.cursor/hooks.json` + `mcp.json`(project) 또는 `~/.cursor/`(user). `beforeMCPExecution`이 PreToolUse 등가. npm 아님. (신뢰도 높음)
- **각 CLI 바이너리 자체**(Codex 등)는 npm/Homebrew/shell installer로 설치되지만, **그 위의 plugin은 호스트별 메커니즘**으로 깔린다 — 둘을 혼동하면 안 됨. (신뢰도 높음)
- 웹은 "Codex/Antigravity의 lifecycle-hook API가 미문서화"라 보고하지만, **실제로는 Codex 공식 hooks 문서가 존재**(`developers.openai.com/codex/hooks`)하고 Antigravity 2.0은 native `PreInvocation`을 쓴다 — 웹 종합이 약간 outdated. 이 프로젝트의 CLAUDE.md/research 문서가 더 최신·정확. (신뢰도 보통)

## 이 프로젝트(ai-action-tracker) 적용 — 답: 어느 variant도 npm publish 불필요

배포 단위는 **이 git repo 하나**이고, 각 호스트가 자기 plugin 디렉토리를 네이티브 방식으로 등록한다:

| 호스트 | 사용자가 받는 법 | npm publish? |
|---|---|---|
| **Claude Code** | marketplace add `<repo>` → `/plugin install` (repo 루트가 marketplace) | ❌ |
| **Codex** | repo의 `plugins/codex-ai-action-tracker` 등록 + `config.toml`에 `[features] codex_hooks = true` | ❌ |
| **Antigravity** | README의 global/workspace 설치 (plugin root 자동 인식) | ❌ |
| **Cursor** | `install.sh` 실행 (`__AI_ACTION_TRACKER_ROOT__` 절대경로 치환 → `.cursor/hooks.json` + `mcp.json`) | ❌ |

4개 variant 모두 **같은 monorepo에서 빌드된 dist를 각 호스트 방식으로 설치**한다. npm에 올리는 건 `@bigstrider/transcodes-cli`(독립 CLI)뿐이고, plugin/MCP variant는 git repo 배포 + 호스트별 등록이 전부다.

**핵심 통찰 — "배포"의 두 층:** ① CLI 바이너리(Codex 등)는 npm/brew로 깔리지만, ② 그 위 plugin은 호스트별 네이티브 채널(marketplace / config.toml / .vsix / install.sh)로 깔린다. 이 프로젝트는 4개 호스트 plugin을 하나의 git repo에 담아, 각 호스트가 자기 디렉토리를 자기 방식으로 등록하게 한다 — variant마다 npm 패키지를 따로 만들 필요가 전혀 없다.

## 주요 출처
- [Codex Plugins (공식)](https://developers.openai.com/codex/plugins)
- [Codex Hooks (공식)](https://developers.openai.com/codex/hooks)
- [Codex CLI (공식)](https://developers.openai.com/codex/cli)
- [Antigravity: coming from VS Code](https://www.appsoftware.com/blog/setting-up-google-antigravity-coming-from-vscode)
- [Cursor Hooks (InfoQ)](https://www.infoq.com/news/2025/10/cursor-hooks/)
- [Cursor Hooks Integration (GitButler)](https://blog.gitbutler.com/cursor-hooks-integration)
- [Cursor CLI/IDE plugin parity gap (forum)](https://forum.cursor.com/t/cursor-agent-cli-does-not-register-skills-from-plugins-ide-does-parity-gap/158947)

---

## 부록 (2026-05-31 재조사): 공식 배포 메커니즘 확정 + 이 repo 배포 계획

> 위 1차 브리프를 공식 문서 기준으로 재검증. **수정 포인트:** "어느 variant도 npm publish 불필요"는 Codex/Antigravity/Cursor엔 맞지만, **Claude Code는 npm이 *선택적* 지원 채널**이라는 nuance가 빠져 있었다(아래 ①). 결론(plugin마다 npm 패키지 따로 만들 필요 없음)은 유지.
>
> **현재 배포 결정: 전면 보류.** `.github/workflows/release.yml`은 release-please 자동화(버전 bump·CHANGELOG·git tag)만 수행하고 **publish step은 없다**. 기능 개발 동안 버전·CHANGELOG·tag 기록만 유지하고, 채널이 정해지면 그때 발행 단계를 추가한다.

### ① Claude Code — marketplace가 정식, npm은 선택적 source

- **배포 단위 = marketplace 카탈로그**(`.claude-plugin/marketplace.json`). 각 plugin이 `source`로 fetch 위치를 가리킨다. source 타입 5종: **상대경로 / `github` / `url`(git) / `git-subdir` / `npm`**.
- **이 repo의 현재 방식(비-npm):** 루트가 곧 marketplace이고 plugin을 상대경로(`"./plugins/claude-code-ai-action-tracker"`)로 참조. 사용자: `/plugin marketplace add <owner/repo>` → repo git clone → `/plugin install ai-action-tracker@ai-action-tracker`. 커밋된 `dist/`·`hooks/hooks.json`·`.mcp.json`·`.claude-plugin/plugin.json`을 그대로 읽어 hook·MCP 등록. **npm·레지스트리 불필요.** (이래서 dist를 repo에 커밋하고 CI가 동기성을 강제한다.)
- **npm을 쓰려면(선택):** `@bigstrider/transcodes-guard-claude-code`를 npm 발행 + marketplace 엔트리를 `"source": {"source":"npm","package":"...","version":"^x"}`로. 사용자 명령은 동일(`marketplace add`+`install`)하나 fetch가 `npm install`로 바뀜. **`/plugin install @npm패키지` 직접 명령은 없다** — npm은 항상 marketplace 엔트리의 fetch 백엔드.
- **public 필요 여부:** marketplace add는 설치자 로컬 git 자격으로 clone하므로, **공개 배포 → public repo 필요**, **사내/팀 한정 → private 유지 가능**(권한 있는 멤버만 설치). 기술적 필수조건은 "설치자가 clone 가능한가"일 뿐.
- 출처: [discover-plugins](https://code.claude.com/docs/en/discover-plugins) · [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) · [plugins-reference](https://code.claude.com/docs/en/plugins-reference)

### ② Codex CLI — 네이티브 marketplace(git), npm 아님

- 1st-party plugin 시스템: 카탈로그 `marketplace.json`(`$REPO/.agents/plugins/marketplace.json` 또는 `~/.agents/plugins/marketplace.json`), 설치 시 `~/.codex/plugins/cache/...`로 복사. 매니페스트는 **`.codex-plugin/plugin.json`**.
- 설치: `codex plugin marketplace add owner/repo` (+ `--sparse`/`--ref`) → CLI `/plugins`에서 install. 서브디렉토리 plugin은 엔트리에 `"source":"git-subdir"` + `path`.
- **npm 미사용.** git source가 배포 채널.
- **drift 발견(추후 정합 필요):** 이 repo는 bare `plugin.json`을 쓰는데 공식은 `.codex-plugin/plugin.json` 기대. 또 hook 활성화는 `[features] hooks`(기본 on)이고 CLAUDE.md의 `[features] codex_hooks = true`는 **deprecated alias**.
- 출처: [Plugins](https://developers.openai.com/codex/plugins) · [Build plugins](https://developers.openai.com/codex/plugins/build) · [Hooks](https://developers.openai.com/codex/hooks) · [Config](https://developers.openai.com/codex/config-reference)

### ③ Antigravity 2.0 — `agy plugin install <git-url>`, npm 아님

- 두 층 구분: (a) **VS Code 확장**은 Open VSX/`.vsix`(에디터 툴링, 이 repo와 무관) (b) **agent plugin**(skills+MCP+hooks+rules 번들)은 **git repo URL로 설치**.
- 설치: `agy plugin install https://github.com/<org>/<repo>` → `~/.gemini/antigravity-cli/plugins/<name>/`(MCP는 같은 폴더 `mcp_config.json`). IDE는 `~/.gemini/antigravity-ide/plugins/` symlink로 공유. plugin root 자동 인식.
- **npm은 배포 채널 아님**(npm/npx는 skills content fetch 용도로만 등장).
- **불확실:** 공식 `antigravity.google/docs/hooks`·`/docs/plugins`가 JS 렌더라 fetcher로 전문 확인 불가 — hooks.json 정확한 schema/이벤트명은 브라우저 확인 권장.
- 출처: [data-cloud-extension CLI plugins](https://docs.cloud.google.com/data-cloud-extension/antigravity/use-cli-plugins) · [gemini-cli-extensions/data-cloud-extension](https://github.com/gemini-cli-extensions/data-cloud-extension) · [hooks in antigravity (discuss)](https://discuss.ai.google.dev/t/hooks-in-antigravity/120458)

### ④ Cursor — 로컬 JSON config + `install.sh`(git), npm 아님

- 두 층: (a) VS Code 호환 확장 = Open VSX/`.vsix` (b) **Cursor Hooks**(1.7+, 에이전트 lifecycle) = **로컬 JSON config + 스크립트**, 경로로 참조.
- 설치: `.cursor/hooks.json`(`version:1`, project) 또는 `~/.cursor/hooks.json`(user) + `mcp.json`을 배치. git에 커밋하거나 MDM/클라우드 배포. **npm·레지스트리 불필요.** 이 repo의 `install.sh`(`__AI_ACTION_TRACKER_ROOT__` 절대경로 치환)가 정석 — user-level hook은 `~/.cursor/`에서 실행되므로 절대경로 필수.
- wire format은 FLAT(`{permission,user_message,agent_message}`, `hookSpecificOutput` 래퍼 없음) — repo 설계와 일치.
- **caveat:** 일부 빌드가 `sessionStart`를 "Unknown hook type"으로 거부한 보고 있음 — 타겟 버전에서 runtime smoke 확인 권장.
- 출처: [Cursor Hooks (공식)](https://cursor.com/docs/agent/hooks) · [Cursor MCP](https://cursor.com/docs/context/mcp) · [extensions→Open VSX](https://forum.cursor.com/t/extension-marketplace-changes-transition-to-openvsx/109138) · [Unknown hook type: sessionStart](https://forum.cursor.com/t/unknown-hook-type-sessionstart/149566)

### 배포 계획 요약 (채널 확정 시 실행)

| 호스트 | 채널 | 발행/배포 액션 (추후) | npm? |
|---|---|---|---|
| **Claude Code** | marketplace + git source (정식) | repo 공개(또는 팀 접근) + git tag. **선택**: npm 발행 + marketplace.json npm source 엔트리 | 선택 |
| **Codex** | `.agents/plugins/marketplace.json` + git-subdir | 매니페스트 `.codex-plugin/`로 정합 + marketplace 엔트리; `codex plugin marketplace add` 안내 | ❌ |
| **Antigravity** | `agy plugin install <git-url>` | README의 git URL 설치 안내(global/workspace) | ❌ |
| **Cursor** | `install.sh` → `.cursor/hooks.json`+`mcp.json` | install.sh 배포 + README 안내 | ❌ |

→ **공통 배포 단위는 이 git repo 하나.** Claude Code만 npm을 옵션으로 가질 수 있고, 나머지는 git + 호스트 네이티브 설치가 전부다. 지금은 release-please 기록만 유지하고 발행은 미룬다.
