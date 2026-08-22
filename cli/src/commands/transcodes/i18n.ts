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
    platformTitle:
      'Please make sure you installed the desktop app, NOT the web version.',
    platformHint1: 'Installing a plugin enables both its CLI and desktop app.',
    platformHint2: '(For Claude, Transcodes supports Cowork and Claude Code)',
    platformSelectHint:
      'Select AI Application(s) with Space and Enter Key to Install/Update',
    skipThisProcess: 'Skip This Process →',
    platformKeys: '↑/↓ move · space select · s skip this step · q exit',
    platformSelectedCount: '{n} selected · press Enter to install/update',
    platformSelectedNone: '0 selected · press Enter to skip this step',
    platformSkipped:
      'Skipped. Run `transcodes install` anytime to set this up.',
    platformNumberedHint:
      'Enter numbers to install (e.g. 1,2). Enter or "s" skips this step. "all" installs all.',
    platformNumberedNext:
      'Type {n} (or "skip") to skip this step, "exit"/"q" to quit.',
    selectedInstall: 'Install/Update',
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
    congrats1: 'Setup complete.',
    congrats2: 'Opening the Transcodes dashboard…',
    congratsBody:
      'Plugins are installed. Sign in from the dashboard to get started.',
    pressEnterDashboard: 'Press ENTER to open the transcodes CLI dashboard … ',
    installSummary: '── Install summary ──',
    dashboardOpened: 'Transcodes dashboard is open: {url}',
    dashboardHowToUse:
      'Please read how to use Transcodes in the CLI dashboard.',
    dashboardStopHint: 'Running in the background — stop with: transcodes stop',
    dashboardOpenFallback:
      'If the page did not open automatically, type `transcodes` in your terminal or PowerShell.',
    dashboardStopped: 'Transcodes dashboard stopped.',
    dashboardNotRunning: 'Transcodes dashboard is not running.',
    loginTokenSaved: 'Login complete. Your Transcodes access is ready.',
    uninstallBanner:
      'transcodes uninstall — remove Transcodes from this computer.',
    uninstallPlanTitle: 'Will remove:',
    uninstallGroupLocal: 'Local settings',
    uninstallNothing:
      'Nothing to remove — Transcodes is not installed on this computer.',
    uninstallKeepNote:
      'Untouched: the transcodes CLI, and .transcodes/ folders in your projects.',
    uninstallConfirm: 'Remove these? Type "y" to continue: ',
    uninstallAborted: 'Aborted — nothing was removed.',
    uninstallDryRun:
      'Dry run — nothing was removed. Re-run without --dry-run to apply.',
    uninstallDone: 'Uninstall complete.',
    uninstallLeftovers: 'Could not remove (delete these by hand):',
    uninstallRestartNote:
      'Restart your AI apps, then run `transcodes install` to set up again.',
  },
  ko: {
    installBanner: 'transcodes install — 플러그인과 대시보드를 설정합니다.',
    langTitle: 'Select language / 언어를 선택하세요:',
    chooseKeys: '↑/↓ 이동 · enter 선택',
    platformTitle:
      '웹 버전이 아닌 데스크톱 앱이 설치되어 있는지 확인해 주세요.',
    platformHint1: '플러그인 설치 시 CLI·데스크톱 앱에 모두 적용됩니다.',
    platformHint2: '(For Claude, Transcodes supports Cowork and Claude Code)',
    platformSelectHint: 'Space로 선택하고 Enter로 설치/업데이트하세요',
    skipThisProcess: '이 과정 건너뛰기 →',
    platformKeys: '↑/↓ 이동 · space 선택 · s 이 단계 건너뛰기 · q 종료',
    platformSelectedCount: '{n}개 선택 · Enter로 설치/업데이트',
    platformSelectedNone: '0개 선택 · Enter로 이 단계 건너뛰기',
    platformSkipped:
      '건너뛰었습니다. 나중에 `transcodes install`로 다시 설정할 수 있습니다.',
    platformNumberedHint:
      '설치할 번호를 입력하세요 (예: 1,2). Enter 또는 "s"는 이 단계 건너뛰기. "all"은 전체 설치.',
    platformNumberedNext:
      '{n} (또는 "skip")는 이 단계 건너뛰기, "exit"/"q"는 종료입니다.',
    selectedInstall: '설치/업데이트',
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
    congrats1: '설정이 완료되었습니다.',
    congrats2: 'Transcodes 대시보드를 엽니다…',
    congratsBody: '플러그인 설치가 끝났습니다. 대시보드에서 로그인하세요.',
    pressEnterDashboard: 'ENTER를 누르면 transcodes CLI 대시보드를 엽니다 … ',
    installSummary: '── 설치 요약 ──',
    dashboardOpened: 'Transcodes 대시보드가 열렸습니다: {url}',
    dashboardHowToUse: 'CLI 대시보드에서 사용 방법을 읽어보시기 바랍니다.',
    dashboardStopHint: '백그라운드에서 실행 중 — 종료: transcodes stop',
    dashboardOpenFallback:
      '페이지가 자동으로 열리지 않았다면 터미널이나 PowerShell에서 `transcodes`를 입력해 보세요.',
    dashboardStopped: 'Transcodes 대시보드를 종료했습니다.',
    dashboardNotRunning: '실행 중인 Transcodes 대시보드가 없습니다.',
    loginTokenSaved:
      '로그인이 완료되었습니다. 이제 Transcodes를 사용할 수 있습니다.',
    uninstallBanner:
      'transcodes uninstall — 이 컴퓨터에서 Transcodes를 제거합니다.',
    uninstallPlanTitle: '삭제할 항목:',
    uninstallGroupLocal: '로컬 설정',
    uninstallNothing:
      '삭제할 항목이 없습니다 — 이 컴퓨터에 Transcodes가 설치되어 있지 않습니다.',
    uninstallKeepNote:
      '유지되는 항목: transcodes CLI, 그리고 프로젝트 안의 .transcodes/ 폴더.',
    uninstallConfirm: '위 항목을 삭제할까요? 계속하려면 "y" 입력: ',
    uninstallAborted: '취소했습니다 — 아무것도 삭제하지 않았습니다.',
    uninstallDryRun:
      '미리보기입니다 — 아무것도 삭제하지 않았습니다. 실제로 지우려면 --dry-run 없이 다시 실행하세요.',
    uninstallDone: '제거가 완료되었습니다.',
    uninstallLeftovers: '자동으로 삭제하지 못했습니다 (직접 지워주세요):',
    uninstallRestartNote:
      'AI 앱을 재시작한 뒤 `transcodes install`로 다시 설치하세요.',
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)['en'];

export function getLocale(): Locale {
  return current;
}

/**
 * Applies a locale for this process only. Use instead of {@link setLocale}
 * when persisting would fight the command itself — `uninstall` deletes
 * `~/.transcodes/locale`, so writing it back would resurrect the file.
 */
export function useLocale(locale: Locale): void {
  current = locale;
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
