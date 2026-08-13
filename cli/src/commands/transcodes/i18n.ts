/**
 * Minimal CLI locale for `transcodes install` (and later other commands).
 * Persists to ~/.transcodes/locale so the next run can default to the last pick.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Locale = 'en' | 'ko';

const LOCALE_FILE = path.join(os.homedir(), '.transcodes', 'locale');

let current: Locale = 'en';

const MESSAGES = {
  en: {
    installBanner: 'transcodes install — set up plugins and dashboard.',
    langTitle: 'Select language / 언어를 선택하세요:',
    chooseKeys: '↑/↓ move · enter select',
    platformTitle: 'Please select platforms that you want to install:',
    platformHint1: 'Installing a plugin enables both its CLI and desktop app.',
    platformHint2: '(Transcodes supports Claude Cowork, Claude Code Only)',
    platformInstalledApps: 'Currently installed applications: {list}',
    platformInstalledNone: 'No applications are installed yet.',
    nextStep: 'Next Step →',
    platformKeys:
      '↑/↓ move · space select · a all/none · enter confirm · q quit/exit',
    platformNumberedHint:
      'Enter numbers to install (e.g. 1,2), "all" or Enter to install all.',
    platformNumberedNext:
      'Type {n} (or "next") for Next Step, "exit"/"q" to quit.',
    installed: '[Installed ✓]',
    nothingSelected: 'Nothing selected.',
    noPlatforms: 'No platforms selected — nothing to install.',
    installing: 'Installing: {list}',
    cancelHint: 'To open the dashboard later, type `transcodes`',
    nonInteractive:
      'Non-interactive shell detected. Specify platforms explicitly, e.g.:',
    loginPleaseSignIn: 'Please sign in to Transcodes in your browser first.',
    loginWaiting: 'Waiting for authorization to finish…',
    loginBrowserOpenFailed:
      'Could not open the browser automatically. Run `transcodes login` again and complete sign-in when the browser opens.',
    loginNoOpenHint:
      'Browser open was skipped (--no-open). Run `transcodes login` without --no-open to continue.',
    tokenWhy:
      'The MAT is the ID card / key attached to every request to Transcodes. It verifies your identity so you can use Transcodes.',
    tokenQuestion:
      'Do you have a Member Access Token (MAT) to access Transcodes?',
    tokenYes: 'Yes',
    tokenNo: 'No',
    tokenSkip: 'Skip — token already configured',
    tokenChoose123: 'Please choose 1, 2, or 3.',
    tokenSkipLog: 'Skipping token setup — using the token already configured.',
    tokenNoIntro1:
      'No token yet — open the Transcodes console to create a project and issue a MAT.',
    tokenNoIntro2:
      'When you return, paste the token here (or run `transcodes install` again).',
    tokenPressEnterConsole: 'Press ENTER to open the console ({url}) …',
    tokenOpening: 'Opening {url} …',
    tokenSteps1: '1) After sign-in, create a new project on the dashboard.',
    tokenSteps2: '2) Open the "Members & Tokens" tab and add a new member.',
    tokenSteps3:
      '3) Generate a new token for that member, or ask your manager to get a token.',
    tokenSteps4: '4) Paste it here.',
    registerTitle: '── Register MAT token ───────────────────────────────',
    pasteToken: 'Paste your token: ',
    tokenRequired: 'Token is required.',
    tokenRejected: 'Token rejected: {err}',
    labelPrompt: 'Label (e.g. transcodes-myproject-prod): ',
    labelRequired: 'Label is required.',
    tokenSaved: 'Saved token to {path} (label={label}).',
    tokenTooMany:
      'Too many invalid attempts — run `transcodes install` again later.',
    congratsBar: '────────────────────────────────────────────────────',
    congrats1: 'Plugin installation complete.',
    congrats2: 'Opening the Transcodes dashboard…',
    congratsBody:
      'Next steps:\n  1) Start a new AI app session.\n  2) Review and trust the plugin hooks when prompted.\n  3) Open the Transcodes Skill and choose what to set up first:\n     • Standardize repeat work with a Persona, Rules, and Skills.\n     • Protect sensitive work with Guard and step-up approval.\n     • Finish for now.\n\nSign in from the dashboard only when the selected task needs organization or Guard access.',
    setupIncomplete: 'Setup incomplete.',
    setupIncompleteBody:
      'One or more plugins failed to install. Review the install summary above and retry; the dashboard was not opened.',
    pressEnterDashboard: 'Press ENTER to open the transcodes CLI dashboard … ',
    installSummary: '── Install summary ──',
    dashboardOpened: 'Transcodes dashboard is open: {url}',
    dashboardHowToUse:
      'Please read how to use Transcodes in the CLI dashboard.',
    dashboardStopHint: 'Running in the background — stop with: transcodes stop',
    dashboardStopped: 'Transcodes dashboard stopped.',
    dashboardNotRunning: 'Transcodes dashboard is not running.',
    loginTokenSaved: 'Login complete. Your Transcodes access is ready.',
  },
  ko: {
    installBanner: 'transcodes install — 플러그인과 대시보드를 설정합니다.',
    langTitle: 'Select language / 언어를 선택하세요:',
    chooseKeys: '↑/↓ 이동 · enter 선택',
    platformTitle: '설치할 플랫폼을 선택하세요:',
    platformHint1: '플러그인 설치 시 CLI·데스크톱 앱에 모두 적용됩니다.',
    platformHint2: '(Transcodes는 Claude Cowork의 Claude Code만 지원합니다)',
    platformInstalledApps: '현재 설치되어 있는 어플리케이션: {list}',
    platformInstalledNone: '아직 설치된 Application이 없습니다.',
    nextStep: '다음 단계 →',
    platformKeys: '↑/↓ 이동 · space 선택 · a 전체 · enter 확인 · q 종료',
    platformNumberedHint:
      '설치할 번호를 입력하세요 (예: 1,2). "all" 또는 Enter면 전체 설치.',
    platformNumberedNext:
      '{n} (또는 "next")는 다음 단계, "exit"/"q"는 종료입니다.',
    installed: '[설치됨 ✓]',
    nothingSelected: '선택된 항목이 없습니다.',
    noPlatforms: '선택된 플랫폼이 없어 설치를 건너뜁니다.',
    installing: '설치 중: {list}',
    cancelHint: '나중에 대시보드를 열려면 `transcodes`를 입력하세요',
    nonInteractive: '비대화형 셸입니다. 플랫폼을 직접 지정하세요. 예:',
    loginPleaseSignIn: '먼저 브라우저에서 Transcodes에 로그인해 주세요.',
    loginWaiting: '승인 완료를 기다리는 중…',
    loginBrowserOpenFailed:
      '브라우저를 자동으로 열지 못했습니다. `transcodes login`을 다시 실행한 뒤, 열린 브라우저에서 로그인을 완료해 주세요.',
    loginNoOpenHint:
      '브라우저 자동 열기가 건너뛰어졌습니다 (--no-open). `--no-open` 없이 `transcodes login`을 다시 실행해 주세요.',
    tokenWhy:
      'MAT는 Transcodes에 요청할 때 같이 첨부되는 ID Card / Key입니다. Transcodes를 이용하기 위해 신원을 확인하는 데 필요합니다.',
    tokenQuestion:
      'Transcodes 에 접속하기 위한 Member Access Token(MAT)이 있나요?',
    tokenYes: '예',
    tokenNo: '아니오',
    tokenSkip: '건너뛰기 — 토큰이 이미 설정되어 있음',
    tokenChoose123: '1, 2, 또는 3을 선택하세요.',
    tokenSkipLog: '토큰 설정을 건너뜁니다 — 이미 설정된 토큰을 사용합니다.',
    tokenNoIntro1:
      '토큰이 없습니다 — Transcodes 콘솔에서 프로젝트를 만들고 MAT를 발급하세요.',
    tokenNoIntro2:
      '돌아온 뒤 여기에 토큰을 붙여넣거나 `transcodes install`을 다시 실행하세요.',
    tokenPressEnterConsole: 'ENTER를 누르면 콘솔을 엽니다 ({url}) …',
    tokenOpening: '{url} 여는 중 …',
    tokenSteps1: '1) 로그인 후 대시보드에서 새 프로젝트를 만드세요.',
    tokenSteps2: '2) "Members & Tokens" 탭에서 멤버를 추가하세요.',
    tokenSteps3:
      '3) 해당 멤버의 토큰을 발급하거나, 관리자에게 토큰을 요청하세요.',
    tokenSteps4: '4) 여기에 붙여넣으세요.',
    registerTitle: '── MAT 토큰 등록 ───────────────────────────────',
    pasteToken: '토큰을 붙여넣으세요: ',
    tokenRequired: '토큰이 필요합니다.',
    tokenRejected: '토큰이 거부되었습니다: {err}',
    labelPrompt: '라벨 (예: transcodes-myproject-prod): ',
    labelRequired: '라벨이 필요합니다.',
    tokenSaved: '토큰을 {path}에 저장했습니다 (label={label}).',
    tokenTooMany:
      '잘못된 입력이 너무 많습니다 — 나중에 `transcodes install`을 다시 실행하세요.',
    congratsBar: '────────────────────────────────────────────────────',
    congrats1: '플러그인 설치가 완료되었습니다.',
    congrats2: 'Transcodes 대시보드를 엽니다…',
    congratsBody:
      '다음 단계:\n  1) 새 AI 앱 세션을 시작하세요.\n  2) 표시되는 플러그인 hook 신뢰 요청을 검토·승인하세요.\n  3) Transcodes Skill을 열고 이어서 설정할 항목을 선택하세요:\n     • Persona·Rules·Skills로 반복 업무 표준화\n     • Guard·step-up 승인으로 민감 작업 보호\n     • 지금은 종료\n\n조직 공유나 Guard 기능이 필요할 때만 대시보드에서 로그인하세요.',
    setupIncomplete: '설정이 완료되지 않았습니다.',
    setupIncompleteBody:
      '하나 이상의 플러그인 설치에 실패했습니다. 위 설치 요약을 확인한 뒤 다시 시도하세요. 대시보드는 열지 않았습니다.',
    pressEnterDashboard: 'ENTER를 누르면 transcodes CLI 대시보드를 엽니다 … ',
    installSummary: '── 설치 요약 ──',
    dashboardOpened: 'Transcodes 대시보드가 열렸습니다: {url}',
    dashboardHowToUse: 'CLI 대시보드에서 사용 방법을 읽어보시기 바랍니다.',
    dashboardStopHint: '백그라운드에서 실행 중 — 종료: transcodes stop',
    dashboardStopped: 'Transcodes 대시보드를 종료했습니다.',
    dashboardNotRunning: '실행 중인 Transcodes 대시보드가 없습니다.',
    loginTokenSaved:
      '로그인이 완료되었습니다. 이제 Transcodes를 사용할 수 있습니다.',
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)['en'];

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    const dir = path.dirname(LOCALE_FILE);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(LOCALE_FILE, `${locale}\n`, { mode: 0o600 });
  } catch {
    // Non-fatal — in-memory locale still applies for this session.
  }
}

/** Last saved locale, or null if never chosen. */
export function readSavedLocale(): Locale | null {
  try {
    const raw = fs.readFileSync(LOCALE_FILE, 'utf8').trim().toLowerCase();
    if (raw === 'en' || raw === 'ko') return raw;
  } catch {
    // absent
  }
  return null;
}

export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let s: string = MESSAGES[current][key] ?? MESSAGES.en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
