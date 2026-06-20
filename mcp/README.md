# `@bigstrider/transcodes-mcp`

Transcodes Guard의 step-up MFA 감사 **MCP 서버**를 단독 npm 패키지로 배포한 것입니다. 4종 호스트 플러그인(Claude Code / Codex / Antigravity / Cursor)이 공유하는 동일한 MCP 코어(`createServer()`)를 stdio 전송으로 노출하며, 플러그인 설치 없이 **Claude Desktop / claude.ai 커넥터**나 임의의 MCP 클라이언트에 직접 연결할 수 있습니다.

## 연결

### Claude Desktop / Claude Code (stdio)

`npx`로 바로 띄울 수 있습니다. MCP 설정에 다음을 추가하세요:

```json
{
  "mcpServers": {
    "transcodes-guard": {
      "command": "npx",
      "args": ["-y", "@bigstrider/transcodes-mcp"]
    }
  }
}
```

Claude Code CLI라면:

```bash
claude mcp add transcodes-guard -- npx -y @bigstrider/transcodes-mcp
```

### 직접 실행

```bash
npx -y @bigstrider/transcodes-mcp
# 또는 전역 설치 후
transcodes-mcp
```

stdio 전송이므로 표준입출력으로 MCP 메시지를 주고받습니다. 준비되면 stderr에 `transcodes-guard-mcp: stdio transport ready`를 출력합니다.

## 동작

- step-up 세션 생성/폴링, RBAC 좌표 검증 등 백엔드 게이트 도구를 포함한 **풀 백엔드 내장** 빌드입니다. 별도 백엔드 설치가 필요 없습니다.
- step-up 활성화는 에이전트가 안전하게 호출할 수 있지만, **비활성화는 사람만** 가능합니다(human-only 컨트롤 플레인은 `@bigstrider/transcodes-cli`).

## 버전

플러그인 4종과 **동일 버전 트레인**으로 릴리스됩니다(release-please가 동기화). CLI(`@bigstrider/transcodes-cli`)만 트레인에서 독립입니다.

## 배포

유지보수자용 수동 배포 절차는 `PUBLISHING.md`를 참고하세요(이 문서는 npm 패키지에 포함되지 않습니다).
