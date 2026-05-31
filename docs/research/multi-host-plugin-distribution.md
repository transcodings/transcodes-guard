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
