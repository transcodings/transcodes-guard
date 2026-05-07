# MCP 서버 생성 및 배포 — 리서치 리포트

> 날짜: 2026-05-07 | 키워드: MCP server 생성 / Hello World / 로컬 npx / remote HTTP 배포

## 한줄 요약
MCP 서버는 `@modelcontextprotocol/sdk`로 `McpServer` 인스턴스를 만든 뒤 로컬은 `stdio` 전송으로 npx 실행, 원격은 2025-03-26 사양에서 도입된 단일 `/mcp` 엔드포인트의 **Streamable HTTP** 전송으로 배포하며, Cloudflare Workers가 가장 빠른 배포(2분), Google Cloud Run이 컨테이너 기반의 표준 선택지로 가장 추천된다.

## 핵심 발견사항
| # | 발견사항 | 소스 유형 | 신뢰도 |
|---|---------|----------|--------|
| 1 | MCP 서버는 Resources / Tools / Prompts 3가지 능력(capability)을 JSON-RPC 2.0으로 노출한다 | 공식 문서 + 5개 기사 | 높음 |
| 2 | 로컬 클라이언트(Claude Desktop, Cursor)는 `stdio` 전송을 spawn 방식으로 사용 — `npx` 명령으로 등록 가능 | 공식 문서 + 6개 기사 | 높음 |
| 3 | 2025-03-26 사양으로 **Streamable HTTP**가 도입되었고, 기존 HTTP+SSE는 **deprecated**(하위호환만 유지) | 공식 spec, Cloud Run 블로그, AWS 블로그 | 높음 |
| 4 | 단일 `/mcp` 엔드포인트가 POST/GET 모두 처리하며 stateless 모드로 수평 확장이 가능 | AWS ECS 블로그, Cloud Run 블로그 | 높음 |
| 5 | 원격 배포 시 OAuth 2.1 인증이 필수에 가까움 (MCP 2026 preview) | Cloudflare 블로그, essamamdani 가이드 | 높음 |
| 6 | `stdio` 서버에서 `console.log`/`stdout`에 쓰면 JSON-RPC가 깨진다 — `console.error`(stderr) 사용 필수 | 공식 문서 | 높음 |
| 7 | 디버깅은 `npx @modelcontextprotocol/inspector` 표준 도구로 수행 | 공식 문서 + 5개 기사 | 높음 |
| 8 | MCP SDK는 월간 9,700만 다운로드, 공개 서버 10,000개 이상으로 사실상 표준화됨 | dev.to 2026 튜토리얼 | 보통 |

## 상세 분석

### 1. MCP 서버 기본 구조 (Hello World)

**의존성 설치:**
```bash
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript tsx @types/node
```

**핵심 패키지:**
- `@modelcontextprotocol/sdk` — 공식 TypeScript SDK (현재 v1.29.x, 2026-03 기준)
- `zod` — 도구 입력 스키마 검증 (LLM이 잘못된 인자를 보낼 가능성에 대비)

**최소 hello-world 서버 (`src/index.ts`):**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "hello-mcp",
  version: "1.0.0",
});

// === RESOURCE: 모델이 "읽는" 데이터 ===
server.resource(
  "hello-world",
  "hello://world",
  async (uri) => ({
    contents: [{ uri: uri.href, text: "Hello, World!" }],
  })
);

// === TOOL: 모델이 "호출하는" 함수 ===
server.tool(
  "echo",
  "Echoes a message back",
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: "text", text: `Echo: ${message}` }],
  })
);

// === PROMPT: 미리 정의된 입력 템플릿 ===
server.prompt(
  "greeting",
  { name: z.string() },
  ({ name }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Hello ${name}!` },
    }],
  })
);

// === stdio 전송으로 시작 ===
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running on stdio"); // 반드시 stderr!
```

**3가지 능력의 의미 차이 (공식 정의):**
| 종류 | 용도 | 호출 시점 |
|------|------|----------|
| **Tools** | 모델이 **행동(action)**을 취할 때 — API 호출, 계산 등 | 모델 자율 호출 |
| **Resources** | 모델이 **컨텍스트(data)**를 읽을 때 — 파일, DB 쿼리 결과 등 | 모델/유저가 읽기 요청 |
| **Prompts** | 재사용 가능한 **템플릿** — 슬래시 명령처럼 사용 | 유저가 명시적 호출 |

**아키텍처 권장 패턴 (chuckm 2026 가이드):** 전송 계층(`stdio.js` / `server.js`)과 MCP 서버 정의(`mcp.js`)를 분리하면 동일 서버를 stdio와 HTTP 둘 다로 노출하기 쉽다.

### 2. 로컬 실행 — stdio Transport + npx

**stdio가 무엇인가:**
- 서버가 자식 프로세스로 spawn되고, **stdin으로 JSON-RPC 요청 / stdout으로 응답**을 주고받는다.
- 네트워크 오버헤드가 없고 OS 수준 프로세스 격리(parent의 권한 상속)가 보안 모델.
- Claude Desktop, Cursor, VS Code Copilot 등 모든 데스크탑 클라이언트가 이 방식을 사용.

**중요 함정:** `console.log` / `print` / `System.out.println` 같이 **stdout에 어떤 텍스트라도 쓰면 JSON-RPC 프레임이 깨진다.** 모든 로깅은 `console.error` (stderr) 또는 MCP 프로토콜 자체의 log 메시지로 보내야 함.

**`package.json` bin 필드 설정 — npx 배포 가능하게 만들기:**
```json
{
  "name": "@yourorg/my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "my-mcp-server": "dist/index.js" },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```
`dist/index.js` 첫 줄에 `#!/usr/bin/env node` 셰뱅을 넣어야 한다. `npm publish --access public` 후 누구나 `npx my-mcp-server`로 실행 가능.

**Claude Desktop 등록 (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "hello": {
      "command": "npx",
      "args": ["-y", "@yourorg/my-mcp-server"],
      "env": { "MCP_API_KEY": "..." }
    }
  }
}
```
(macOS 경로: `~/Library/Application Support/Claude/claude_desktop_config.json`)

**개발 중 디버깅 (npm 게시 없이 로컬 경로 실행):**
```json
{
  "mcpServers": {
    "hello-dev": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/dist/index.js"]
    }
  }
}
```

**Claude Code에서 등록:**
```bash
claude mcp add --transport stdio hello -- npx -y @yourorg/my-mcp-server
```

**MCP Inspector로 검사:**
```bash
npx @modelcontextprotocol/inspector npx my-mcp-server
# 또는 빌드된 로컬 파일
npx @modelcontextprotocol/inspector node dist/index.js
```

### 3. 원격 배포 — Streamable HTTP Transport

**왜 Streamable HTTP인가:**
- MCP 사양 **2025-03-26**에서 도입된 새 전송. 기존 **HTTP+SSE(2024-11-05)**의 단점을 해결.
- 구식 SSE 방식: `/sse` (서버→클라 스트림) + `/messages` (클라→서버 POST) — 두 엔드포인트, 단일 연결, 멀티 클라이언트 어려움.
- 신식 Streamable HTTP: **단일 `/mcp` 엔드포인트가 POST와 GET을 모두 처리.** stateless 모드로 동작 가능 → 세션 어피니티 없이 수평 확장.
- 장기 세션이 필요하면 `Mcp-Session-Id` 헤더로 stateful 모드도 지원.
- SSE는 `deprecated`이지만 하위호환 목적으로 남아있음 (Cloud Run 공식 문서 기재).

**Node http로 구현한 최소 hello-world HTTP 서버:**
```typescript
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const server = new McpServer({ name: "hello-mcp", version: "1.0.0" });
server.tool("echo", "Echo", { message: z.string() }, async ({ message }) => ({
  content: [{ type: "text", text: `Echo: ${message}` }],
}));

const PORT = Number(process.env.PORT) || 3000;

const httpServer = http.createServer(async (req, res) => {
  if (req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
    req.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }
  res.writeHead(404).end("Not found");
});

httpServer.listen(PORT, () => console.error(`MCP at http://localhost:${PORT}/mcp`));
```

**원격 배포에서 추가로 필요한 것:**
1. **인증/인가**: 로컬은 OS 프로세스 격리가 보안이지만, 원격은 OAuth 2.1이 사실상 표준 (MCP 2026 spec preview). Cloudflare는 `McpAgent` + Workers OAuth Provider로 자동화 제공.
2. **CORS 처리**: 브라우저 기반 클라이언트 지원 시 필요.
3. **DNS rebinding 방지**: SDK 옵션으로 `allowedHosts` 검증.
4. **세션 관리**: stateless 권장. stateful이 필요하면 `Mcp-Session-Id` + 외부 스토어(Redis/Durable Objects).

### 4. 배포 플랫폼 비교

| 플랫폼 | 장점 | 단점 / 제약 | 무료 티어 | 적합한 시나리오 |
|--------|------|-----------|----------|--------------|
| **Cloudflare Workers** | 가장 빠른 셋업(2분), `McpAgent` 클래스로 OAuth 자동, Durable Objects로 stateful 세션 자동 처리, 글로벌 엣지 | Node.js 전체 호환 아님(Workers 런타임), CPU 시간 제한 | 항상 무료 (10만 req/일) | 빠른 프로토타입, OAuth 필요한 SaaS형 MCP, 멀티테넌트 |
| **Google Cloud Run** | 표준 컨테이너, Streamable HTTP 공식 가이드 존재, 자동 스케일 0→N, gcloud CLI 한 줄 배포 | 콜드스타트(수백 ms~수 초), 컨테이너 빌드 필요 | 월 200만 req | 일반 Node/Python 워크로드, 사내 도구, 컨테이너 친숙한 팀 |
| **AWS ECS Fargate** | 장기 연결/스트리밍 지원 우수, ALB·VPC·IAM 통합, 사이드카·warm 캐시 가능 | 셋업 복잡(태스크 정의·서비스·SD), 비용↑, 스케일0 불가 | 12개월 한정 | 엔터프라이즈, 기존 AWS 인프라, 멀티스텝 stateful 워크플로 |
| **AWS Lambda** | 진정한 서버리스, stateless MCP에 적합, 폭발적 트래픽 대응 | 장기 연결/스트리밍 제약, 콜드스타트 | 월 100만 req | 가벼운 stateless 도구 (단일 API 호출 wrapper) |
| **Vercel** | 가장 친숙한 DX, GitHub 연동 자동 배포, Next.js Route로 `/mcp` 구현 가능 | Functions 실행 시간 제한 (Hobby 10초), 스트리밍 한계 | Hobby 무제한 (개인용) | TypeScript/Next.js 팀, 가벼운 stateless MCP |
| **Fly.io** | VM 기반(전체 Node 호환), 글로벌 리전 분산, 영속 볼륨 | 대시보드 단순함, 무료 한도 변경 잦음 | 3 머신 (소형) | 컨테이너 + low-latency 글로벌 분산 |
| **Render** | Heroku 대체로 가장 단순, render.yaml로 IaC | 무료 티어 휴면(웹 서비스 무료 제거됨) | 정적 사이트만 | 사이드 프로젝트, PoC |
| **Amazon Bedrock AgentCore** | 풀 매니지드 에이전트 오케스트레이션, identity·memory·tool 디스커버리 내장 | AWS 락인, 신생 서비스 | 미정 | AWS Bedrock 에이전트와 깊은 통합 |

**Cloudflare 1분 배포 예시:**
```bash
npm create cloudflare@latest my-mcp -- --type=worker
cd my-mcp
# src/index.ts에 McpAgent 작성
npx wrangler deploy
```

**Cloud Run 1분 배포 예시:**
```bash
gcloud run deploy hello-mcp --source . --port 3000 --allow-unauthenticated --region us-central1
```

**AWS ECS 핵심 (간략):**
```bash
aws ecs create-service \
  --cluster $CLUSTER_NAME --service-name mcp-server \
  --task-definition mcp-server --desired-count 2 \
  --launch-type FARGATE --network-configuration "..."
```

### 합의점
- **전송 분리 패턴**: 코드는 `McpServer` 정의를 transport-agnostic하게 두고, stdio 진입점과 HTTP 진입점을 분리. (chuckm, fka.dev, oneuptime 모두 동일 권장)
- **Streamable HTTP 채택**: SSE는 deprecated. 신규 원격 배포는 무조건 Streamable HTTP. (공식 spec, Cloud Run, AWS, Cloudflare 일치)
- **stdio = 로컬, HTTP = 원격** 이분법이 명확.
- **MCP Inspector**가 사실상 표준 디버깅 도구.
- **Zod로 입력 검증**은 모든 가이드의 공통 권장 (LLM의 hallucinated 파라미터에 대비).
- **stdout 오염 금지** — stdio 모드에서 가장 흔한 초보자 실수.

### 논쟁점 / 의견 분화
- **SDK 선택**: 공식 `@modelcontextprotocol/sdk`(저수준, 최대 제어) vs `FastMCP`(데코레이터 기반, Python에 가까운 DX) vs 신생 `MCP Fusion`(npx fusion 스캐폴드). 공식 SDK가 대세지만 보일러플레이트가 많다는 비판.
- **Workers vs 컨테이너**: Cloudflare 진영은 Workers + Durable Objects가 OAuth/세션을 다 해결한다고 주장. AWS/Google 진영은 컨테이너 표준이 락인 회피와 운영 친숙성 면에서 우위라 주장.
- **Stateless vs Stateful**: AWS ECS 가이드는 기본 stateless를 권장하지만, 멀티스텝 워크플로(예: 카운터, 장기 대화 상태)에는 stateful이 필요. Cloudflare는 Durable Objects로 stateful을 default로 미는 편.
- **인증**: OAuth 2.1이 spec 권장이지만 구현 부담이 커서 현재는 API Key/Bearer 토큰을 쓰는 사례가 많음.

### 정량 데이터
- MCP SDK 월간 다운로드: **9,700만+**, 공개 서버: **10,000개+** (2026-05 기준, dev.to)
- SDK 최신 버전: `@modelcontextprotocol/sdk@1.29.0` (2026-03-30 npm)
- Cloud Run 무료 티어: 월 **200만 요청**
- Cloudflare Workers 무료 티어: 일 **10만 요청** 항시 무료
- AWS ECS 워크스루 셋업: **30~40분**
- Cloud Run 셋업: **10분 미만** (공식 가이드 제목)
- Cloudflare 셋업: **2분** (Perplexity 합성)

## 소스 상세

### 기사 및 문서
| 소스 | 핵심 내용 | URL |
|------|----------|-----|
| Model Context Protocol 공식 문서 | MCP 서버 빌드 공식 가이드. stdio 로깅 함정, Claude Desktop 통합 방법, 다국어 SDK(Go/Java/C#/TS) 예시 | [modelcontextprotocol.io/docs/develop/build-server](https://modelcontextprotocol.io/docs/develop/build-server) |
| fka.dev — Hello World MCP Server | Resources/Tools/Prompts 3가지 능력 모두 구현하는 hello-world. SSE 모드 옵션 포함. 2025-03 시점 기준 | [blog.fka.dev/.../building-hello-world-mcp-server](https://blog.fka.dev/blog/2025-03-22-building-hello-world-mcp-server/) |
| dev.to (chuckm) — JS Hello World MCP 2026 | 전송 계층과 MCP 코어 분리하는 권장 디렉토리 구조. tools/ resources/ 별 파일 분리 | [dev.to/chuckm/building-a-javascript-helloworld-mcp-server-in-2026-2lbc](https://dev.to/chuckm/building-a-javascript-helloworld-mcp-server-in-2026-2lbc) |
| Cloudflare Blog — Remote MCP servers | `McpAgent` 클래스 + Durable Objects로 stateful 세션 + OAuth 자동. 15줄 minimal 서버 예시 | [blog.cloudflare.com/remote-model-context-protocol-servers-mcp](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/) |
| Google Cloud Blog — Cloud Run 배포 | uv + Python으로 10분 내 Cloud Run 배포. Streamable HTTP 단일 엔드포인트 설명, SSE deprecated 명시 | [cloud.google.com/.../build-and-deploy-a-remote-mcp-server-to-google-cloud-run-in-under-10-minutes](https://cloud.google.com/blog/topics/developers-practitioners/build-and-deploy-a-remote-mcp-server-to-google-cloud-run-in-under-10-minutes) |
| AWS Blog — ECS 배포 | Fargate 위에서 Streamable HTTP stateless 서버. ALB/VPC/SG 구성, Mcp-Session-Id로 stateful 옵션 | [aws.amazon.com/blogs/containers/deploying-model-context-protocol-mcp-servers-on-amazon-ecs](https://aws.amazon.com/blogs/containers/deploying-model-context-protocol-mcp-servers-on-amazon-ecs/) |
| OneUptime — Build MCP Server in Node.js | TypeScript 프로덕션 서버. package.json bin 필드, npm publish, 통합 테스트 패턴, MCP_LOG_LEVEL env | [oneuptime.com/.../2025-12-17-build-mcp-server-nodejs](https://oneuptime.com/blog/post/2025-12-17-build-mcp-server-nodejs/view) |
| essamamdani — Complete Guide MCP 2026 | Host/Client/Server 3계층 아키텍처, OAuth 2.1, Zod/Pydantic 검증, 샌드박싱·감사 로그 베스트프랙티스 | [essamamdani.com/blog/complete-guide-model-context-protocol-mcp-2026](https://www.essamamdani.com/blog/complete-guide-model-context-protocol-mcp-2026) |

### 영상
| 소스 | 제목 | 핵심 내용 | URL |
|------|------|----------|-----|
| YouTube | MCP Tutorial: Build Your First MCP Server and Client from Scratch | 서버·클라이언트 양쪽 빌드 (입문) | [youtube.com/watch?v=RhTiAOGwbYE](https://www.youtube.com/watch?v=RhTiAOGwbYE) |
| YouTube | Build a custom MCP server in 15 mins | 15분 내 커스텀 서버 빌드 핸즈온 | [youtube.com/watch?v=nTMSyldeVSw](https://www.youtube.com/watch?v=nTMSyldeVSw) |
| YouTube | MCP In 26 Minutes (Model Context Protocol) | MCP 개념·아키텍처·SDK 전반 26분 개요 | [youtube.com/watch?v=kOhLoixrJXo](https://www.youtube.com/watch?v=kOhLoixrJXo) |
| YouTube | Ultimate MCP Tutorial - Learn MCP and Deploy your MCP Server | 빌드부터 배포까지 종합 튜토리얼 | [youtube.com/watch?v=DAuZuj0BUZA](https://www.youtube.com/watch?v=DAuZuj0BUZA) |
| YouTube | you need to learn MCP RIGHT NOW!! | MCP 학습 동기 부여형 입문 | [youtube.com/watch?v=GuTcle5edjk](https://www.youtube.com/watch?v=GuTcle5edjk) |

### 커뮤니티/저장소
| 플랫폼 | 주요 내용 | URL |
|--------|----------|-----|
| GitHub | `lobehub/mcp-hello-world` — CI/CD 테스트용 미니멀 MCP 서버. STDIO + HTTP/SSE 둘 다 지원하는 test double. echo, debug 도구 + helpful-assistant 프롬프트 제공. dev dependency로 `npx mcp-hello-world` 실행 | [github.com/lobehub/mcp-hello-world](https://github.com/lobehub/mcp-hello-world) |
| npm | `@modelcontextprotocol/sdk` v1.29.0 (2026-03-30). McpServer/Client 전체 spec 구현, stdio + Streamable HTTP 표준 전송 | [npmjs.com/package/@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |

## 미비점 및 추가 조사 필요 영역
- **한국어 자료 부족**: 추출된 8개 기사·문서 모두 영문. 한국어 1차 자료가 거의 없어 사내 가이드 작성 시 영문 참조 필요.
- **프로덕션 모니터링/로깅 베스트 프랙티스**: 가이드 대부분이 hello-world 수준에서 끝남. OpenTelemetry 통합, MCP 트레이스 기반 디버깅, 에러 율 알람 등은 추가 조사 필요.
- **실제 운영 비용 비교 데이터**: 무료 티어 한도는 명확하나, 동일 트래픽(예: 일 100만 도구 호출) 기준 5개 플랫폼 실제 청구액 비교 데이터는 없음.
- **OAuth 2.1 구현 상세**: spec preview 단계라 SDK별 구현 수준 차이가 큼. Cloudflare는 자동 제공하지만 자체 구현 시 PKCE/Dynamic Client Registration 등 복잡도 정량 평가 부족.
- **stateful 세션 디자인 패턴**: `Mcp-Session-Id` 기반 멀티스텝 워크플로의 모범 사례(Redis vs Durable Objects vs DynamoDB)가 표준화되지 않음.

(각주: npm SDK 페이지 추출은 실패했으나 Brave 결과 + Cloudflare/공식 문서로 SDK 정보는 충분히 확보됨.)

## 전체 출처

**공식 문서 / Spec**
1. [modelcontextprotocol.io — Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server)
2. [MCP Spec 2025-03-26 (Streamable HTTP 도입)](https://modelcontextprotocol.io/specification/2025-03-26)

**튜토리얼 기사 (코드 중심)**
3. [fka.dev — Building a Hello World MCP Server (2025-03)](https://blog.fka.dev/blog/2025-03-22-building-hello-world-mcp-server/)
4. [dev.to (chuckm) — JS Hello World MCP 2026](https://dev.to/chuckm/building-a-javascript-helloworld-mcp-server-in-2026-2lbc)
5. [dev.to (Jangwook Kim) — TypeScript MCP 2026 Tutorial](https://dev.to/jangwook_kim_e31e7291ad98/build-an-mcp-server-with-typescript-2026-tutorial-1ipk)
6. [OneUptime — Build MCP Server in Node.js (2025-12)](https://oneuptime.com/blog/post/2025-12-17-build-mcp-server-nodejs/view)
7. [Coderslexicon — Building Your Own MCP Server with Node and Python](https://www.coderslexicon.com/building-your-own-model-context-protocol-mcp-server-with-node-and-python/)
8. [Medium (Chris McKenzie) — Getting Started: Build an MCP Server](https://medium.com/@kenzic/getting-started-build-a-model-context-protocol-server-9d0362363435)
9. [essamamdani — Complete Guide to MCP 2026](https://www.essamamdani.com/blog/complete-guide-model-context-protocol-mcp-2026)

**플랫폼 배포 가이드**
10. [Cloudflare Blog — Remote MCP servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
11. [Google Cloud Blog — Deploy MCP to Cloud Run in <10 min](https://cloud.google.com/blog/topics/developers-practitioners/build-and-deploy-a-remote-mcp-server-to-google-cloud-run-in-under-10-minutes)
12. [AWS Blog — Deploying MCP servers on Amazon ECS](https://aws.amazon.com/blogs/containers/deploying-model-context-protocol-mcp-servers-on-amazon-ecs/)
13. [Continue Docs — Setting up MCP](https://docs.continue.dev/customize/deep-dives/mcp)

**저장소 / 패키지**
14. [GitHub — lobehub/mcp-hello-world](https://github.com/lobehub/mcp-hello-world)
15. [npm — @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

**영상**
16. [YouTube — MCP Tutorial: Build Your First MCP Server and Client](https://www.youtube.com/watch?v=RhTiAOGwbYE)
17. [YouTube — Build a custom MCP server in 15 mins](https://www.youtube.com/watch?v=nTMSyldeVSw)
18. [YouTube — MCP In 26 Minutes](https://www.youtube.com/watch?v=kOhLoixrJXo)
19. [YouTube — Ultimate MCP Tutorial: Learn MCP and Deploy](https://www.youtube.com/watch?v=DAuZuj0BUZA)
20. [YouTube — you need to learn MCP RIGHT NOW!!](https://www.youtube.com/watch?v=GuTcle5edjk)
