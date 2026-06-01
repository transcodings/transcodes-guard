# 배포 가이드 — `@bigstrider/transcodes-cli`

이 패키지를 npm(`@bigstrider` org)에 배포하는 전체 절차입니다. 유지보수용 내부 문서이며, `package.json`의 `files`가 `dist`/`README.md`만 포함하므로 **이 문서는 npm에 배포되지 않습니다**.

> TL;DR
>
> ```bash
> cd packages/cli
> npm publish --otp=<인증앱 6자리>
> ```

---

## 0. 사전 준비 (최초 1회)

- **npm 계정**: `@bigstrider` org에 publish 권한이 있는 계정 (예: `han55776`).
- **2FA**: 이 계정은 2단계 인증이 켜져 있어 publish 시 OTP가 필요합니다 (아래 5번 참고).
- **로그인**:

  ```bash
  npm login          # 브라우저 또는 CLI 프롬프트로 로그인
  npm whoami         # 로그인된 계정 확인
  ```

  로그인은 위치와 무관합니다(계정 전역). `cli` 폴더가 아니어도 됩니다.

---

## 1. 코드/빌드 정합성 확인 (루트에서)

소스를 수정했다면 먼저 전체 빌드와 dist 동기성을 확인합니다.

```bash
# 레포 루트에서
npm run build:plugin          # packages/* + plugins/* dist 동기화
npm run type-check -w @bigstrider/transcodes-cli
```

> `dist/index.js`는 gitignore 대상(번들 산출물)이라 커밋되지 않습니다. publish 시점에 `prepublishOnly`가 자동 빌드하므로 수동 커밋 불필요.

---

## 2. 버전 결정 (변경이 있었다면)

같은 버전은 재배포가 **불가능**합니다. 코드가 바뀌었으면 버전을 올립니다.

```bash
# packages/cli 안에서
npm version patch    # 0.1.0 → 0.1.1  (버그 수정)
npm version minor    # 0.1.0 → 0.2.0  (기능 추가, 하위호환)
npm version major    # 0.1.0 → 1.0.0  (호환성 깨짐)
```

`npm version`은 `package.json`을 수정하고 git 태그를 만듭니다. 최초 배포(0.1.0)는 그대로 두면 됩니다.

---

## 3. CLI 폴더로 이동

```bash
cd packages/cli
```

이 폴더 안에서는 `-w` 플래그가 필요 없습니다. (루트에서 하려면 모든 명령에 `-w @bigstrider/transcodes-cli`를 붙이세요.)

---

## 4. dry-run 으로 배포물 미리보기

실제 배포 전에 어떤 파일이 들어가는지 확인합니다.

```bash
npm publish --dry-run
```

정상이면 **3개 파일**만 보여야 합니다:

```
npm notice 📦  @bigstrider/transcodes-cli@<version>
npm notice Tarball Contents
npm notice 1.7kB README.md
npm notice 7.2kB dist/index.js      ← 번들된 단일 파일 (stepup-core 등 내장)
npm notice 662B package.json
npm notice total files: 3
```

`node_modules`나 `src`가 보이면 안 됩니다. 런타임 `dependencies`는 0개여야 합니다(전부 `devDependencies` + 번들).

---

## 5. 실제 배포 (2FA OTP 필수)

이 계정은 2FA가 켜져 있어 OTP 없이는 `403 Forbidden` (Two-factor authentication required)이 납니다.

인증 앱(Google Authenticator / 1Password / Authy 등 npm 계정에 연결된 것)의 **현재 6자리 코드**를 확인하고 바로 실행:

```bash
npm publish --otp=123456
```

- `123456` 자리에 그 6자리를 넣습니다.
- 코드는 30초마다 갱신되니 **뜨자마자 즉시** 실행하세요. 늦으면 다시 403 → 새 코드로 재시도.
- `publishConfig.access: "public"`이 이미 설정돼 있어 `--access public`은 불필요(스코프 패키지 공개 배포).

---

## 6. 배포 확인

```bash
npm view @bigstrider/transcodes-cli version      # 배포된 버전 확인
npx @bigstrider/transcodes-cli help              # 실제 실행 확인
```

npm 웹의 `bigstrider` org 패키지 목록에도 노출됩니다.

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `403 Forbidden ... Two-factor authentication ... is required` | 2FA 계정인데 OTP 누락 | `npm publish --otp=<6자리>` |
| `401 Unauthorized` (`npm whoami` 포함) | 로그인 안 됨/세션 만료 | `npm login` 다시 |
| `403 ... cannot publish over previously published version` | 같은 버전 재배포 | `npm version patch` 후 재시도 |
| `402 Payment Required` | 스코프 패키지를 private로 배포 시도 | `publishConfig.access: "public"` 확인 (이미 설정됨) |
| dry-run에 `src/`·`node_modules` 포함 | `files` 필드 누락/오설정 | `package.json`의 `"files": ["dist","README.md"]` 확인 |
| `dist/index.js` 없음/구버전 | 빌드 누락 | `npm run build` (publish는 `prepublishOnly`가 자동 처리) |

---

## CI 자동 배포로 전환할 경우 (선택)

매번 OTP 입력이 번거로우면 **Granular Access Token**(Bypass 2FA 허용)을 발급해 사용합니다.

1. <https://www.npmjs.com/settings/~/tokens> → Generate New Token → **Granular Access Token**
2. `@bigstrider` org / 이 패키지에 read-write 권한, "Bypass 2FA" 활성화
3. CI 환경변수 `NODE_AUTH_TOKEN`(또는 `~/.npmrc`의 `//registry.npmjs.org/:_authToken=<TOKEN>`)으로 주입 후 `npm publish`

> 토큰은 절대 커밋하지 말 것. CI secret으로만 보관.
