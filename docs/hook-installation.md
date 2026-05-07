# Hook 설치 가이드

이 리포지토리는 Claude Code의 **PreToolUse hook**으로 동작하는 위험 명령 차단 스크립트(`hooks/pre-tool-use.ts`)를 제공합니다. 사용자가 자신의 Claude Code 설정에 등록하면, 모델이 위험한 Bash 명령을 실행하려 할 때 즉시 차단되고 채팅 트랜스크립트에 경고가 표시됩니다.

## 동작 개요

```
모델이 Bash 호출 시도
       ↓
Claude Code가 PreToolUse hook 실행 (이 스크립트)
       ↓
hooks/danger-patterns.json 의 정규식과 매칭
       ↓
   매칭됨? ─yes─→ exit 2 + stderr 경고 → 호출 차단
       │
       no
       ↓
   exit 0 → 호출 정상 진행
```

차단 시 stderr 메시지는 모델에게 피드백되며, 사용자는 채팅창에서 **차단된 명령 원문**과 **매칭된 패턴**을 확인할 수 있습니다.

## 1단계 — 빌드

```bash
npm install
npm run build
```

빌드 산출물: `dist/hooks/pre-tool-use.js` (실행 가능 JS).

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
            "command": "node /ABSOLUTE/PATH/TO/ai-action-tracker-mcp/dist/hooks/pre-tool-use.js"
          }
        ]
      }
    ]
  }
}
```

`/ABSOLUTE/PATH/TO/ai-action-tracker-mcp` 부분을 실제 클론 경로로 교체합니다. 예: `/home/cyprien/Documents/transcodes/ai-action-tracker`.

### npm 전역 설치 사용 시

```bash
npm install -g .   # 리포지토리 루트에서
```

설치 후 `command` 부분을 다음으로 단순화 가능:

```json
"command": "ai-action-tracker-hook"
```

## 3단계 — 검증

Claude Code 세션에서 다음을 시도:

```
"`rm -rf ~/Documents` 실행해 줘"
```

기대 동작: 명령이 실행되지 않고, 채팅 트랜스크립트에 다음과 유사한 경고가 표시됨:

```
⛔ ai-action-tracker: BLOCKED dangerous command
   Pattern: rm-rf-root — Recursive removal of /, ~, or $HOME
   Command: rm -rf ~/Documents
```

## 차단 패턴 커스터마이징

`hooks/danger-patterns.json`을 직접 수정하면 즉시 반영됩니다(스크립트 재빌드 불필요 — 매 호출마다 파일을 새로 읽음).

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

- **정규식 우회**: `r''m -rf /` 같은 quote 분할이나 base64 디코드 후 eval 같은 우회는 단순 정규식으로 잡지 못합니다. 1단계의 한계로 수용합니다.
- **거짓 양성**: 정상 사용에도 매칭되는 패턴은 `danger-patterns.json`에서 직접 조정.
- **Hook 시작 지연**: 매 Bash 호출마다 약 50–80ms(Node 시작) 추가됩니다.
- **추가 인증 미연결**: 현재는 차단만 수행하며, 사용자가 인증을 거쳐 일시 우회하는 흐름은 다음 단계에서 추가됩니다.

## 다른 모드와의 관계

| 보호 메커니즘 | 작동 모드 | bypassPermissions에서 동작? |
|---------------|----------|-----------------------------|
| `permissions.deny` (settings.json) | 일반 모드 | ❌ 무시됨 |
| **이 hook (exit 2)** | 모든 모드 | ✅ 작동 |

즉 사용자가 `--dangerously-skip-permissions`로 실행하더라도 hook은 차단을 강제합니다. 이것이 hook이 deny 리스트보다 강력한 이유입니다.

## 참고

- Claude Code 공식 hooks 문서: <https://code.claude.com/docs/en/hooks>
- 본 hook 소스: [`hooks/pre-tool-use.ts`](../hooks/pre-tool-use.ts)
- 패턴 정의: [`hooks/danger-patterns.json`](../hooks/danger-patterns.json)
