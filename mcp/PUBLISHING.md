# 배포 가이드 — `@bigstrider/transcodes-mcp`

이 패키지를 npm(`@bigstrider` org)에 **수동** 배포하는 절차입니다. `@bigstrider/transcodes-cli`와 동일한 패턴이며, `package.json`의 `files`가 `dist`/`README.md`만 포함하므로 **이 문서는 npm에 배포되지 않습니다**.

> TL;DR
>
> ```bash
> cd mcp
> npm publish --otp=<인증앱 6자리>
> ```

CLI와 달리 **mcp는 플러그인 4종과 같은 버전 트레인**입니다 — 버전은 release-please가 `mcp/package.json`에 자동 스탬프하므로 손으로 `npm version`을 올리지 마세요. publish 시점에 트레인 버전을 그대로 사용합니다(같은 버전 재배포는 불가하니, 새 릴리스 PR이 머지된 뒤 배포).

---

## 0. 사전 준비 (최초 1회)

- **npm 계정**: `@bigstrider` org에 publish 권한이 있는 계정 (예: `han55776`).
- **2FA**: publish 시 OTP 필요.
- **로그인**:

  ```bash
  npm login
  npm whoami
  ```

---

## 1. 빌드 정합성 확인 (루트에서)

```bash
npm run type-check -w @bigstrider/transcodes-mcp
```

`dist/`는 gitignore 대상(번들 산출물)이라 커밋되지 않습니다. publish 시 `prepublishOnly`가 자동 빌드합니다.

---

## 2. mcp 폴더로 이동

```bash
cd mcp
```

---

## 3. dry-run 으로 배포물 미리보기

```bash
npm publish --dry-run
```

정상이면 **3개 파일**만 보여야 합니다:

```
npm notice 📦  @bigstrider/transcodes-mcp@<version>
npm notice README.md
npm notice dist/stdio.js      ← 번들된 단일 파일 (mcp-server-core + gate-backend 내장)
npm notice package.json
npm notice total files: 3
```

`node_modules`나 `src`가 보이면 안 됩니다. 런타임 `dependencies`는 0개여야 합니다(전부 `devDependencies` + 번들).

---

## 4. 실제 배포 (2FA OTP 필수)

```bash
npm publish --otp=123456
```

- `123456` 자리에 인증 앱의 현재 6자리. 30초마다 갱신되니 뜨자마자 즉시 실행.
- `publishConfig.access: "public"`이 설정돼 있어 `--access public`은 불필요.

---

## 5. 배포 확인

```bash
npm view @bigstrider/transcodes-mcp version
npx -y @bigstrider/transcodes-mcp     # stderr에 "stdio transport ready"
```

---

## 트러블슈팅

CLI의 `PUBLISHING.md`와 동일합니다(403 OTP, 401 로그인, 버전 중복 등). 한 가지만 다릅니다: **버전을 손으로 올리지 마세요** — mcp는 release-please 트레인에 묶여 있어 버전은 릴리스 PR이 결정합니다.
