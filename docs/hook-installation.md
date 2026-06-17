# Hook 설치 가이드

이 리포지토리는 Claude Code의 **PreToolUse hook**으로 동작하는 위험 명령 차단 스크립트(`plugins/claude-code/hooks/pre-tool-use.ts`)를 제공합니다. 사용자가 자신의 Claude Code 설정에 등록하면, 모델이 위험한 Bash 명령을 실행하려 할 때 즉시 차단되고 채팅 트랜스크립트에 경고가 표시됩니다.

> 권장 설치 경로는 **Plugin**(루트 [`README.md`](../README.md) "빠른 시작"). 이 문서는 plugin 시스템 없이 hook만 직접 등록하려는 사용자를 위한 백업 가이드.

## 동작 개요

```
모델이 Bash 호출 시도
       ↓
Claude Code가 PreToolUse hook 실행 (이 스크립트)
       ↓
   ┌── 1차: 정규식 패턴 매칭 (danger-patterns.json) ──┐
   │     매칭? ─yes─→ exit 2 + reason: pattern X     │
   │     no                                          │
   │      ↓                                          │
   ├── 2차: rm -rf 의미 분석 (git ls-files 검사) ────┤
   │     target이 tracked? ─yes─→ exit 2 +          │
   │                              reason: tracked   │
   │     no                                          │
   │      ↓                                          │
   └── exit 0 → 호출 정상 진행 ──────────────────────┘
```

**1차 (정규식 패턴)**: `rm -rf /`, `dd of=/dev/sda`, `curl ... | bash` 같은 *명백히 위험한 형태*를 즉시 매칭. 빠르고 결정적.

**2차 (의미 분석)**: 정규식이 잡지 못하는 상대경로 (`rm -rf src`, `rm -rf hooks/...`)에 대해 cwd 기준으로 절대경로 변환 후 `git ls-files`로 tracked 여부 확인. tracked 파일을 포함한 디렉터리·파일 삭제 시도면 차단.

차단 시 stderr 메시지에는 **차단 사유(Reason)**, **영향받는 파일 샘플(Affected)**, **차단된 명령 원문(Command)**이 구조화돼 표시됩니다.

### 차단 메시지 예시

정규식 매칭 차단:

```
⛔ transcodes-guard: BLOCKED dangerous command

Reason: matched pattern `rm-rf-root` — Recursive removal of an absolute path, ~, or $HOME

Command: rm -rf /tmp/foo
```

git tracking 기반 차단:

```
⛔ transcodes-guard: BLOCKED dangerous command

Reason: rm -rf would delete 3 file(s) tracked in git

Affected:
  - src — 3 tracked file(s): src/http.ts, src/server.ts, src/stdio.ts

Command: rm -rf src
```

## 1단계 — 빌드

```bash
npm install
npm run build:plugin
```

빌드 산출물: `plugins/claude-code/dist/hooks/pre-tool-use.js` (실행 가능 JS, danger-patterns.json 동기화 포함).

## 2단계 — Hook 등록

다음 두 위치 중 하나에 hook 설정을 추가합니다.

| 위치 | 적용 범위 |
|------|----------|
| `~/.claude/settings.json` | 모든 프로젝트(전역) |
| `<project>/.claude/settings.json` | 해당 프로젝트만 |

### settings.json 예시

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node /ABSOLUTE/PATH/TO/transcodes-guard/plugins/claude-code/dist/hooks/pre-tool-use.js"
          }
        ]
      }
    ]
  }
}
```

`/ABSOLUTE/PATH/TO/transcodes-guard` 부분을 실제 클론 경로로 교체합니다. 예: `/home/cyprien/Documents/transcodes/ai-action-tracker`.

### npm 전역 설치 사용 시

```bash
npm install -g ./plugins/claude-code   # plugin 디렉터리 기준
```

설치 후 `command` 부분을 다음으로 단순화 가능:

```json
"command": "transcodes-guard-hook"
```

## 3단계 — 검증

Claude Code 세션에서 다음을 시도:

```
"`rm -rf ~/Documents` 실행해 줘"
```

기대 동작: 명령이 실행되지 않고, 채팅 트랜스크립트에 다음과 유사한 경고가 표시됨:

```
⛔ transcodes-guard: BLOCKED dangerous command
   Pattern: rm-rf-root — Recursive removal of /, ~, or $HOME
   Command: rm -rf ~/Documents
```

## 차단 패턴 커스터마이징

시스템 패턴은 `packages/danger-patterns/src/data/danger-patterns.json`에 정의되며 **빌드 시 번들에 임베드**됩니다 — 수정 후 `npm run build:plugin`으로 재빌드해야 반영됩니다. 재빌드 없이 패턴을 추가하려면 사용자 패턴 파일(JSONC)이나 MCP 도구 `add_user_pattern`을 쓰세요(매 호출마다 새로 읽힘).

**패턴 추가 예시:**

```json
{
  "id": "no-sudo",
  "regex": "\\bsudo\\b",
  "reason": "sudo invocation requires manual review"
}
```

**필드 의미:**

| 필드 | 역할 |
|------|------|
| `id` | 패턴 식별자. 차단 메시지에 표시됨 |
| `regex` | JavaScript `RegExp`로 컴파일되는 정규식 문자열. JSON이므로 백슬래시는 `\\` |
| `reason` | 사용자/모델에게 표시되는 차단 사유 |

## 알려진 한계

- **Shell 의미 무시**: 토큰화는 단순 공백 분리. quote(`rm -rf "src"`), 변수 확장(`rm -rf $DIR`), 명령 치환(`rm -rf $(ls)`), 체이닝(`rm -rf src && ...`)은 정확히 처리하지 못합니다.
- **정규식 패턴 우회**: `r''m -rf /` 같은 quote 분할은 잡지 못함. 단순 정규식의 한계.
- **거짓 양성**: 추적되지 않는 파일이라도 패턴(예: `/tmp/foo` 절대경로)에 매칭되면 차단됩니다 — 1차 패턴은 의도적으로 broad. 필요 시 `danger-patterns.json`에서 조정.
- **Hook 시작 지연**: 매 Bash 호출마다 Node 시작 ~50–80ms. `rm -rf` 호출 시 추가로 git 서브프로세스(~30–50ms)가 포함됩니다.
- **추가 인증 미연결**: 현재는 차단만 수행하며, 사용자가 인증을 거쳐 일시 우회하는 흐름은 다음 단계에서 추가됩니다.

## 다른 모드와의 관계

| 보호 메커니즘 | 작동 모드 | bypassPermissions에서 동작? |
|---------------|----------|-----------------------------|
| `permissions.deny` (settings.json) | 일반 모드 | ❌ 무시됨 |
| **이 hook (exit 2)** | 모든 모드 | ✅ 작동 |

즉 사용자가 `--dangerously-skip-permissions`로 실행하더라도 hook은 차단을 강제합니다. 이것이 hook이 deny 리스트보다 강력한 이유입니다.

## 참고

- Claude Code 공식 hooks 문서: <https://code.claude.com/docs/en/hooks>
- 본 hook 소스: [`plugins/claude-code/hooks/pre-tool-use.ts`](../plugins/claude-code/hooks/pre-tool-use.ts)
- 패턴 정의: [`packages/danger-patterns/src/data/danger-patterns.json`](../packages/danger-patterns/src/data/danger-patterns.json)
