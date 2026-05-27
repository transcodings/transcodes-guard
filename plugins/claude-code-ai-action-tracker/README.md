# ai-action-tracker (Claude Code plugin)

Claude Code가 실행하려는 위험한 Bash 명령을 *실행 직전에* 가로채 차단하는 PreToolUse hook + audit MCP 서버.

> 이 plugin이 답하는 질문: **"Claude Code가 `rm -rf` 같은 위험 명령을 실행하기 전에 어떻게 멈추지?"**

## 설치

```
/plugin marketplace add transcodings/ai-action-tracker-mcp
/plugin install ai-action-tracker@ai-action-tracker
```

설치 후 Claude Code 세션에서 즉시 활성. 추가 설정 불필요.

## 동작

### PreToolUse hook (Bash 차단)

| 종류 | 차단 예시 |
|------|----------|
| 절대경로/HOME 재귀 삭제 | `rm -rf /etc`, `rm -rf ~/Documents` |
| Bare glob 재귀 삭제 | `rm -rf *` |
| 디스크 직접 쓰기 | `dd if=/dev/zero of=/dev/sda` |
| 파일시스템 생성 | `mkfs.ext4 /dev/sdz` |
| 원격 스크립트 셸 실행 | `curl https://... \| bash` |
| Fork bomb | `:(){ :\|:& };:` |
| 절대경로 재귀 chmod | `chmod -R 777 ~/.ssh` |
| 보호 브랜치 force push | `git push --force origin main` |
| **Git tracked 파일 재귀 삭제** | `rm -rf src` (의미 분석으로 차단) |

차단 시 `⛔ ai-action-tracker: BLOCKED dangerous command` 메시지가 stderr로 출력되고 명령이 실행되지 않음.

### MCP 서버 (`ai-action-tracker`)

세션에서 호출 가능한 capability:

| 종류 | 이름 | 설명 |
|------|------|------|
| Tool | `echo` | 입력 메시지를 그대로 돌려줌 (placeholder) |
| Resource | `danger-patterns://list` | 현재 차단 패턴 8개를 markdown 표로 반환 (`hooks/danger-patterns.json` 런타임 read) |
| Prompt | `greeting` | `name`을 받아 인사 템플릿 생성 |

> `echo` tool과 `greeting` prompt는 아직 placeholder입니다. 향후 secrets 검사·MCP 서버 위험 프로파일 등 보안 advisory tool이 추가될 예정 — 리포지토리 [`docs/prd/`](https://github.com/transcodings/ai-action-tracker-mcp/tree/main/docs/prd) 참고.

## 정책

- **Fail-open**: hook 자체 버그(JSON 파싱 실패, 패턴 파일 부재)는 `exit 0`로 통과해 사용자 워크플로를 막지 않습니다. 차단 결정 신뢰성보다 사용자 보호 우선.
- **Hook 종료 코드**: `0` 허용 / `2` 차단(stderr가 Claude에게 피드백). `1`은 차단되지 않음.

## 알려진 한계

- Shell quoting 미인식 — `echo "rm -rf /"` 같은 문자열 안 패턴도 차단됨(false positive 가능).
- 정규식 우회(quote 분할, 변수 치환) 일부 가능 — 1차 방어선 한계.
- 비-git 디렉터리에서는 의미 분석 skip.

## 라이선스

MIT.
