# `@bigstrider/transcodes-mcp`

[English](./README.md) | **한국어**

Transcodes Guard의 step-up MFA 감사 **MCP 서버**를 단독 npm 패키지로 떼어낸 것으로, 발행을 앞두고 있습니다. 호스트 플러그인 4종(Claude Code / Codex / Antigravity / Cursor)이 공유하는 MCP 코어(`createServer()`)를 그대로 stdio 전송으로 노출하므로, 발행되면 플러그인을 따로 깔지 않고도 **Claude Desktop / claude.ai 커넥터**나 임의의 MCP 클라이언트에 곧바로 붙일 수 있습니다.

`cli/`를 본떠 만든 얇은 전송 어댑터 패키지입니다.

> **아직 미발행.** 단독 패키지는 발행 예정이며, 아래 명령은 발행 이후 연결 방법을 설명합니다. 그전까지는 호스트 플러그인 4종 중 하나를 사용하세요.

## 연결

### Claude Desktop / Claude Code (stdio)

`npx`로 바로 띄울 수 있습니다. MCP 설정에 다음을 추가하세요.

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

Claude Code CLI에서는 다음과 같이 등록합니다.

```bash
claude mcp add transcodes-guard -- npx -y @bigstrider/transcodes-mcp
```

### 직접 실행

```bash
npx -y @bigstrider/transcodes-mcp
# 또는 전역 설치 후
transcodes-mcp
```

stdio 전송이므로 표준 입출력으로 MCP 메시지를 주고받습니다. 준비가 끝나면 stderr에 `transcodes-guard-mcp: stdio transport ready`를 출력합니다.

## 동작 방식

- step-up 세션 생성·폴링, RBAC 좌표 검증 같은 백엔드 게이트 도구까지 모두 번들에 담은 **풀 백엔드 내장** 빌드라, 백엔드를 따로 설치할 필요가 없습니다.
- step-up은 에이전트가 안전하게 켤 수 있지만, **끄는 일은 사람만** 할 수 있습니다. 사람이 직접 다루는 통제 도구는 `@bigstrider/transcodes-cli`입니다.

## 버전 관리

플러그인 4종과 **같은 버전 트레인**으로 릴리스되며, release-please가 버전을 맞춰 줍니다. 이 트레인에서 빠져 따로 움직이는 것은 CLI(`@bigstrider/transcodes-cli`)뿐입니다.

## 배포

유지보수자를 위한 수동 배포 절차는 `PUBLISHING.md`를 참고하세요. 이 문서는 npm 패키지에 포함되지 않습니다.
