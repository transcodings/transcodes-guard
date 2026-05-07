# ai-action-tracker-mcp

MCP(Model Context Protocol) 서버 hello-world 스캐폴드. **stdio**(로컬)와 **Streamable HTTP**(원격) 두 가지 전송을 모두 지원합니다.

> 자세한 배경과 배포 플랫폼 비교는 [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md) 참고.

## 디렉토리 구조

```
src/
  server.ts              # McpServer 정의 (transport-agnostic)
  stdio.ts               # 로컬 진입점 (stdio transport)
  http.ts                # 원격 진입점 (Streamable HTTP transport)
hooks/
  pre-tool-use.ts        # Claude Code PreToolUse hook (위험 명령 차단)
  danger-patterns.json   # 차단 정규식 목록
```

전송 계층과 MCP 서버 정의를 분리해 동일 서버를 로컬·원격 양쪽으로 노출합니다. `hooks/`는 Claude Code의 도구 호출을 가로채는 보안 게이트로, MCP 서버와 독립적으로 동작합니다.

## 노출된 능력 (capabilities)

| 종류 | 이름 | 설명 |
|------|------|------|
| Resource | `hello://world` | "Hello, World!" 텍스트 반환 |
| Tool | `echo` | 입력 메시지를 그대로 돌려줌 |
| Prompt | `greeting` | `name`을 받아 인사 메시지 템플릿 생성 |

## 설치

```bash
npm install
```

요구 사항: Node.js >= 20

## 로컬 실행 — stdio transport

개발 중 (TypeScript 직접 실행):
```bash
npm run dev:stdio
```

빌드 후 실행:
```bash
npm run build
npm run start:stdio
```

### Claude Desktop 등록

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "ai-action-tracker": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/ai-action-tracker/dist/src/stdio.js"]
    }
  }
}
```

### Claude Code 등록

```bash
claude mcp add --transport stdio ai-action-tracker -- node /ABSOLUTE/PATH/TO/dist/src/stdio.js
```

### npm 게시 후 npx로 등록 (선택)

`npm publish`로 게시했다면:
```bash
claude mcp add --transport stdio ai-action-tracker -- npx -y ai-action-tracker-mcp
```

## 원격 실행 — Streamable HTTP transport

개발 중:
```bash
npm run dev:http
# → http://localhost:3000/mcp
```

빌드 후:
```bash
npm run build
PORT=8080 npm run start:http
```

엔드포인트는 단일 `/mcp` (POST·GET 모두 처리). stateless 모드로 동작하므로 세션 어피니티 없이 수평 확장 가능합니다.

### Claude Code에 원격 서버 등록

```bash
claude mcp add --transport http ai-action-tracker https://your-host.example.com/mcp
```

## PreToolUse Hook — 위험 Bash 명령 차단

Claude Code가 위험한 Bash 명령(`rm -rf /`, `dd of=/dev/sd*`, `curl ... | sh` 등)을 실행하려 할 때 차단하는 hook을 제공합니다. 차단 시 채팅 트랜스크립트에 경고와 명령 원문이 표시됩니다.

```bash
npm run build
# settings.json에 등록 (자세한 절차는 docs/hook-installation.md):
# {
#   "hooks": {
#     "PreToolUse": [
#       { "matcher": "Bash", "hooks": [{ "type": "command",
#         "command": "node /ABS/PATH/dist/hooks/pre-tool-use.js" }] }
#     ]
#   }
# }
```

설치/커스터마이징 가이드: [`docs/hook-installation.md`](./docs/hook-installation.md).

## 디버깅 — MCP Inspector

```bash
npm run inspect
```

브라우저에서 도구·리소스·프롬프트를 직접 호출해볼 수 있습니다.

## 배포

### Cloudflare Workers (가장 빠른 셋업)

`McpAgent` 클래스 + Durable Objects로 OAuth/세션을 자동 처리. 자세한 가이드는 [`docs/research/mcp-server-creation-and-deployment.md`](./docs/research/mcp-server-creation-and-deployment.md#4-배포-플랫폼-비교) 참고.

### Google Cloud Run (표준 컨테이너)

```bash
gcloud run deploy ai-action-tracker \
  --source . \
  --port 3000 \
  --allow-unauthenticated \
  --region us-central1
```

`Dockerfile`은 별도 작성 필요. (현재 미포함 — 배포 단계에서 추가)

### 기타 옵션

AWS ECS Fargate, Vercel, Fly.io, Render 비교 표는 리서치 리포트 4번 섹션 참고.

## 주의 사항

- **stdio 모드에서 `console.log`/`stdout` 쓰기 금지.** JSON-RPC 프레임이 깨집니다. 로깅은 모두 `console.error`(stderr) 사용.
- **원격 배포 시 인증 필요.** 현재 스캐폴드는 인증 없음 — 프로덕션 전 OAuth 2.1 또는 Bearer 토큰 추가 필수.
- **stateful 세션이 필요하면** `StreamableHTTPServerTransport`의 `sessionIdGenerator` 옵션으로 활성화하고 외부 스토어(Redis 등) 연동.

## 라이선스

MIT (필요 시 추가).
