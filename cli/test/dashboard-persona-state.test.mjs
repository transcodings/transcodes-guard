import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/commands/transcodes/dashboard.ts", import.meta.url),
  "utf8",
);
const syncSource = readFileSync(
  new URL("../src/commands/transcodes/persona-sync.ts", import.meta.url),
  "utf8",
);
const personaSource = readFileSync(
  new URL("../src/commands/transcodes/persona.ts", import.meta.url),
  "utf8",
);

test("the CSRF guard stays wired at the request entry point", () => {
  // Both checks live in dashboard-csrf.ts and are unit-tested there. What that
  // cannot see is whether dashboard.ts still calls them -- an unwired guard
  // leaves every POST route open again.
  assert.match(source, /isAllowedRequestOrigin\(\{[\s\S]{0,400}?forbidden origin/);
  assert.match(source, /if \(!hasJsonContentType\(req\)\)/);
});

test("Guide footer links to the Transcodes tutorial channel", () => {
  assert.match(
    source,
    /More tutorials: <a href="https:\/\/www\.youtube\.com\/@hellotranscodes"/,
  );
  assert.match(
    source,
    /More tutorials:[\s\S]*Questions or trouble setting up\?[\s\S]*Full documentation:/,
  );
});

test("Persona Save state is button-only, without a status banner", () => {
  assert.match(source, /id="persona-save-btn" disabled/);
  assert.match(source, /personaEditor\.value !== personaState\.savedContent/);
  assert.match(
    source,
    /Set a project folder path, then use <strong>Apply<\/strong> to apply the selected Persona to the project folder/,
  );
  // The inline status line (Unsaved changes / Saved · Not applied yet /
  // Applied / Apply failed) was removed — feedback stays in toasts and the
  // Save button state.
  assert.doesNotMatch(source, /id="persona-apply-status"/);
  assert.doesNotMatch(source, /Unsaved changes/);
  assert.doesNotMatch(source, /Saved · Not applied yet/);
  assert.doesNotMatch(source, /Apply failed · Review the log and try again/);
  assert.match(source, /Current edits will be saved first/);
});

test("Persona AI agent callout is a collapsible accordion", () => {
  assert.match(
    source,
    /<details class="persona-agent-callout persona-agent-callout--workspace">/,
  );
  assert.doesNotMatch(
    source,
    /<details class="persona-agent-callout persona-agent-callout--workspace" open>/,
  );
  assert.match(source, /class="persona-agent-callout-summary"/);
  assert.match(source, /class="persona-agent-callout-chevron"/);
  assert.match(
    source,
    /\.persona-agent-callout--workspace\[open\] \.persona-agent-callout-chevron/,
  );
  assert.match(source, /Create Personas with Your AI/);
  assert.match(source, /Your AI can handle every Persona action in this panel/);
  assert.match(
    source,
    /create, edit, update, apply, sync, upload, or download Personas/,
  );
  assert.match(source, /upload this persona to my organization/);
  assert.match(
    source,
    /When applying without a project path, the Persona is applied globally/,
  );
});

test("mandatory Rule and Skill attribution has no dashboard toggle", () => {
  assert.doesNotMatch(source, /id="persona-output-toggle"/);
  assert.doesNotMatch(source, /Show applied Rules &amp; Skills/);
  assert.doesNotMatch(source, /function updateAppliedRulesSkillsOutput/);
});

test("the file list renders inside the selected Persona bundle", () => {
  // Instruction/Rule/Skill sit inside the bundle card so the sidebar reads as
  // containment rather than three unrelated lists.
  assert.match(
    source,
    /'<div class="persona-bundle-card">' \+\s*bundleHead \+\s*'<div class="persona-child-tree">'/,
  );
  assert.match(source, /class="persona-bundle-card-head"/);
  assert.doesNotMatch(source, /class="persona-bundle-card-count"/);
  assert.doesNotMatch(source, /class="persona-group-count"/);
  assert.doesNotMatch(source, /\.persona-child-tree::before/);
  assert.doesNotMatch(source, /\.persona-group::before/);
});

test("Skills expose their bundle files in a dropdown above the editor", () => {
  // The picker mirrors Claude's skill view: a file button + count + tree menu.
  assert.match(source, /id="persona-file-picker"/);
  assert.match(source, /id="persona-file-btn"/);
  assert.match(source, /id="persona-file-count"/);
  assert.match(source, /id="persona-file-menu"/);
  assert.match(source, /function renderPersonaFilePicker/);
  assert.match(source, /async function openSkillFile/);
  // Every skill-file request carries the skill-root-relative path.
  assert.match(source, /&file=" \+ encodeURIComponent/);
  // Binary companions are view-blocked instead of corrupted by the editor.
  assert.match(source, /is a binary file and can’t be edited here/);
  // Opening another entry always lands back on the mandatory SKILL.md.
  assert.match(
    source,
    /personaState\.name = kind === "agent" \? "" : name;\s*personaState\.file = "SKILL\.md";/,
  );
});

test("token statistics show the full selected file name", () => {
  assert.match(source, /id="persona-content-file">agents\.md</);
  assert.match(
    source,
    /id="persona-content-file">agents\.md<\/span>\s*<div class="persona-content-metrics">/,
  );
  assert.match(source, /function currentPersonaFileLabel/);
  assert.match(
    source,
    /personaState\.name \+ "\/" \+ \(personaState\.file \|\| "SKILL\.md"\)/,
  );
  assert.match(
    source,
    /personaContentFile\.textContent = currentPersonaFileLabel\(\)/,
  );
  assert.match(
    source,
    /\.persona-content-file \{[\s\S]{0,240}?overflow-wrap: anywhere;/,
  );
  assert.match(
    source,
    /\.persona-content-stats \{[\s\S]{0,160}?flex-direction: column;/,
  );
});

test("skill bundles enumerate every file and sync them all", () => {
  assert.match(personaSource, /async function listSkillTree/);
  assert.match(personaSource, /files: tree\.files,\s*dirs: tree\.dirs,/);
  assert.match(personaSource, /export function assertSkillFilePath/);
  // Push/pull hashes the whole folder, not only SKILL.md.
  assert.match(
    personaSource,
    /for \(const skillFile of skill\.files \?\? \[SKILL_FILE_NAME\]\)/,
  );
});

test("skill files and folders can be created from the dropdown", () => {
  // Every folder header carries a "+" that opens an inline name input.
  assert.match(source, /class="persona-file-add" data-add-dir="/);
  assert.match(source, /id="persona-file-new-input"/);
  assert.match(source, /id="persona-file-new-confirm"/);
  assert.match(source, /id="persona-file-new-folder"/);
  assert.match(source, /async function submitPersonaFileDraft/);
  // New files go through the regular save endpoint; folders get their own.
  assert.match(source, /"\/api\/persona\/create-folder"/);
  assert.match(source, /url === '\/api\/persona\/create-folder'/);
  assert.match(personaSource, /export async function createSkillFolder/);
  // Empty folders still show up in the dropdown via the dirs listing.
  assert.match(source, /function currentSkillDirs/);
  assert.match(personaSource, /dirs\?: string\[\]/);
  // Duplicate names are rejected client-side instead of overwriting.
  assert.match(source, /already exists/);
});

test("Persona group explanations live in accessible info tooltips", () => {
  assert.match(source, /class="persona-group-help"/);
  assert.match(source, /data-tooltip="/);
  assert.match(
    source,
    /\.persona-group-label > span \+ \.persona-group-help \{\s*margin-left: auto;/,
  );
  assert.match(
    source,
    /\.persona-group-tooltip \{\s*position: fixed;\s*z-index: 1000;/,
  );
  assert.match(source, /personaGroupTooltip\.setAttribute\("role", "tooltip"\)/);
  assert.match(source, /function showPersonaGroupTooltip\(button\)/);
  assert.match(source, /function bindPersonaGroupHelp\(\)/);
  assert.match(
    source,
    /button\.setAttribute\("aria-describedby", personaGroupTooltip\.id\)/,
  );
  assert.match(source, /window\.innerWidth - margin - width/);
  assert.match(source, /window\.innerHeight - margin - height/);
  assert.match(
    source,
    /m11\.25 11\.25\.041-.02a\.75\.75 0 0 1 1\.063\.852/,
  );
  assert.doesNotMatch(source, /\.persona-group-help::after/);
  assert.doesNotMatch(source, /id="persona-about"/);
});

test("Persona sync is gated on being signed in", () => {
  // GET LATEST / UPDATE live on the unified Organization list; Personal does not
  // duplicate them.
  assert.doesNotMatch(source, /id="persona-push-btn"/);
  assert.match(source, /data-remote-sync="/);
  assert.match(source, /data-remote-upload="/);
  assert.doesNotMatch(source, /id="persona-pull-btn"/);
  assert.match(source, /Editing and Apply still work without signing in/);
  assert.match(source, /personaSyncWarning\.hidden = true;/);
  assert.match(source, /class="signin-pitch-card"/);
  assert.match(source, /class="signin-pitch-features"/);
  assert.match(source, /data-open-login/);
  // Signed-out Organization is a pitch, not an error: a neutral card that
  // explains organization sharing and offers Login right there.
  assert.match(
    source,
    /personaRemoteList\.innerHTML = personaSignInCardHtml\(\);\s*personaRemoteList\.hidden = false;/,
  );
  assert.match(source, /Sign in to use organization persona sharing/);
  assert.match(source, /Get the latest/);
  assert.match(source, /Publish yours/);
  assert.match(source, /Stay in sync/);
  assert.match(source, /Sign in to manage your account/);
  assert.match(source, /Your account/);
  assert.match(source, /This device/);
  assert.match(source, /Sign in to control what your AI can do/);
  assert.match(source, /Set limits/);
  assert.match(source, /Confirm with your finger/);
  assert.match(source, /Keep a record/);
  assert.match(source, /id="rbac-signin"/);
  assert.match(source, /id="rbac-signed-in"/);
  assert.match(source, /function renderRbacAuthGate/);
  assert.doesNotMatch(source, /id="rbac-token-warning"/);
  assert.doesNotMatch(
    source,
    /Not signed in — use <strong>Login<\/strong> in the header \(or run <code>transcodes login<\/code>\)\./,
  );
  assert.doesNotMatch(
    source,
    /personaRemoteNotice\.dataset\.tone = "warn";\s*personaRemoteList\.innerHTML = "";/,
  );
  assert.match(
    source,
    /\.persona-remote-notice\[data-tone="warn"\][\s\S]{0,280}?border: 1px dashed var\(--line\);/,
  );
  assert.doesNotMatch(
    source,
    /Sign in to view the latest organization version/,
  );
  assert.match(
    source,
    /\[data-remote-sync\], \[data-remote-upload\][\s\S]*?button\.disabled =\s*!signedIn \|\| personaState\.busy \|\| personaState\.remoteLoading;/,
  );
});

test("Persona exposes My Personas and Organization from a sidebar accordion", () => {
  assert.match(source, /id="persona-nav-toggle"[\s\S]*?aria-expanded="false"/);
  assert.match(source, /id="persona-nav-submenu" hidden/);
  assert.match(source, /id="persona-local-tab"/);
  assert.match(source, /id="persona-remote-tab"/);
  assert.match(source, /id="persona-local-view"/);
  assert.match(source, /id="persona-remote-view"/);
  assert.match(source, /id="persona-remote-list"/);
  assert.match(source, /data-remote-sync="/);
  assert.match(source, /id="persona-local-tab" aria-current="page">My Personas</);
  assert.match(source, /id="persona-remote-tab">Organization</);
  assert.doesNotMatch(source, /id="persona-local-tab" aria-current="page">Personal</);
  assert.doesNotMatch(source, /id="persona-remote-tab">Team</);
  assert.doesNotMatch(source, /class="persona-mode-tabs"/);
  assert.doesNotMatch(source, /id="persona-sync-card"/);
});

test("dashboard pages use path URLs, with Persona subviews as ?tab=my|team", () => {
  assert.match(source, /function routeFromUrl/);
  assert.match(source, /function pathForRoute/);
  assert.match(source, /url\.pathname = pathForRoute/);
  assert.match(source, /url\.searchParams\.set\(\s*"tab",\s*personaView === "remote" \? "team" : "my"\s*\)/);
  assert.match(source, /guideline: "\/guide"/);
  assert.match(source, /persona: "\/persona"/);
  assert.match(source, /tokens: "\/profile"/);
  assert.match(source, /rbac: "\/permission"/);
  assert.match(source, /"team" : "my"/);
  assert.match(source, /function isDashboardPagePath/);
  assert.match(source, /isDashboardPagePath\(url\)/);
  assert.match(
    source,
    /function normalizePathname\(pathname\) \{[\s\S]{0,220}?trimmed\.endsWith\("\/"\)/,
  );
  assert.match(
    source,
    /openTab\(route\.tab, \{ skipUrl: true, personaView: route\.personaView \}/,
  );
  assert.match(
    source,
    /syncRouteUrl\("persona", personaState\.view, !!options\.replaceUrl\)/,
  );
});

test("dashboard keeps the desktop sidebar layout at narrow window widths", () => {
  assert.match(source, /\.card \{\s*min-width: 1100px;/);
  assert.doesNotMatch(source, /@media \(max-width: 1000px\)/);
  assert.doesNotMatch(source, /@media \(max-width: 680px\)/);
});

test("dashboard fills the viewport and keeps version at sidebar bottom", () => {
  assert.match(
    source,
    /body \{[\s\S]{0,160}?height: 100vh;[\s\S]{0,100}?padding: 24px;/,
  );
  assert.match(source, /\.card \{[\s\S]{0,180}?height: 100%;/);
  assert.match(
    source,
    /\.sidebar-version \{[\s\S]{0,100}?margin-top: auto;/,
  );
  assert.match(
    source,
    /<div class="sidebar-version">[\s\S]*?Ver \$\{CLI_VERSION\}[\s\S]*?transcodes version/,
  );
  assert.doesNotMatch(source, /class="dashboard-footer"/);
});

test("signed-out header uses a direct sign-in prompt", () => {
  assert.match(source, /class="header-profile-name">Please Sign In</);
  assert.doesNotMatch(source, /class="header-profile-name">Not signed in</);
});

test("Persona editor fills available height and keeps actions at the bottom", () => {
  assert.match(
    source,
    /#panel-persona \.persona-library-panel \{[\s\S]{0,180}?display: flex;[\s\S]{0,120}?min-height: 0;[\s\S]{0,220}?overflow: hidden;/,
  );
  assert.match(
    source,
    /#panel-persona \.persona-registry-body \{[\s\S]{0,160}?flex: 1;[\s\S]{0,120}?width: 100%;[\s\S]{0,100}?min-height: 0;[\s\S]{0,180}?overflow-x: hidden;[\s\S]{0,80}?overflow-y: auto;/,
  );
  assert.match(
    source,
    /#panel-persona \.persona-editor-panel \{[\s\S]{0,220}?display: flex;[\s\S]{0,160}?height: 100%;[\s\S]{0,100}?min-height: 0;/,
  );
  assert.match(
    source,
    /#panel-persona \.persona-code-editor \{[\s\S]{0,180}?flex: 1;[\s\S]{0,140}?min-height: 0;/,
  );
  assert.match(
    source,
    /#panel-persona \.persona-code-editor \.cm-editor \{[\s\S]{0,160}?height: 100%;[\s\S]{0,80}?min-height: 0;/,
  );
  assert.match(
    source,
    /#panel-persona \.persona-actions \{\s*flex: none;\s*margin-top: 16px;/,
  );
});

test("Organization view renders one unified Persona list", () => {
  // The two stacked sections (Organization / Local) are gone; both sides of
  // every Persona meet on one card.
  assert.match(
    source,
    /#panel-persona \.persona-remote-view \{[\s\S]{0,220}?width: calc\(100% - 68px\);[\s\S]{0,180}?max-width: 1160px;[\s\S]{0,180}?padding: 30px 0 40px;/,
  );
  assert.doesNotMatch(source, /id="persona-remote-local"/);
  assert.doesNotMatch(source, /class="persona-remote-title">Local Personas</);
  assert.doesNotMatch(source, /function renderLocalPersonaCards/);
  assert.match(
    source,
    /id="persona-remote-refresh-btn"[\s\S]*?class="persona-remote-refresh-icon"[\s\S]*?Refresh/,
  );
  assert.match(source, /function personaCardHtml\(personaId, withActions\)/);
  // Organization order first, then local-only Personas appended once.
  assert.match(
    source,
    /remoteIds\.concat\(\s*localPersonas\.filter\(\(persona\) => remoteIds\.indexOf\(persona\) === -1\)\s*\)/,
  );
  // Sharing a Persona other than the open one must not push editor text
  // that belongs to a different bundle.
  assert.match(source, /const isOpen = persona === personaState\.persona;/);
  assert.match(source, /const content = isOpen \? personaEditor\.value : "";/);
});

test("each card shows both versions, a status badge, and updater metadata", () => {
  assert.match(source, /remote\.updated_by_name \|\| remote\.updated_by_email/);
  assert.match(source, /formatPersonaRelativeTime\(remote\.updated_at\)/);
  // Version comparison reads as two labeled blocks, followed by one compact
  // metadata chip for who published the Remote version and when.
  assert.match(source, /class="persona-remote-title">Organization</);
  assert.match(
    source,
    /"Current Version",\s*status\.local === null \? "—" : String\(status\.local\)/,
  );
  assert.match(source, /"Remote Version",\s*String\(status\.org\)/);
  assert.match(
    source,
    /\.persona-version-row \{[\s\S]{0,180}?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    source,
    /\.persona-version-block \{[\s\S]{0,180}?display: flex;[\s\S]{0,120}?justify-content: space-between/,
  );
  assert.doesNotMatch(source, /persona-version-arrow/);
  assert.match(source, /class="persona-update-chip"/);
  assert.match(source, /Updated by /);
  // Current comes before Remote — the same order as the version card on
  // My Personas, so both screens read in one direction.
  assert.match(
    source,
    /"Current Version",[\s\S]*?personaVersionBlockHtml\(\s*"Remote Version"/,
  );
  assert.doesNotMatch(source, /persona-update-chip svg/);
  assert.match(source, /class="persona-sync-state" data-state="/);
});

test("the status classifier maps every state to exactly one safe action", () => {
  // org newer + unedited → GET LATEST; org same + edited → UPDATE;
  // org newer + edited → conflict (Get with backup); equal → nothing.
  assert.match(source, /function personaSyncStatus\(personaId\)/);
  assert.match(source, /const edited = currentHash !== syncedHash;/);
  assert.match(source, /const behind = org > synced;/);
  assert.match(source, /state: "behind",\s*label: "UPDATE REQUIRED"/);
  assert.match(source, /state: "edited",\s*label: "EDITED"/);
  assert.match(source, /state: "conflict",\s*label: "CONFLICT"/);
  assert.match(source, /state: "current",\s*label: "LATEST"/);
  assert.match(source, /state: "local-only",\s*label: ""/);
  assert.match(
    source,
    /status\.label\s*\?\s*'<span class="persona-sync-state"/,
  );
  assert.match(source, /class="persona-local-version-grid"/);
  assert.doesNotMatch(source, /UNVERSIONED/);
  assert.match(
    source,
    /const currentVersion = status\.local === null \? "—" : "v" \+ status\.local;/,
  );
  assert.match(source, /class="persona-local-sync-state"/);
  assert.match(
    source,
    /personaLocalRemoteStatus\.innerHTML =[\s\S]{0,900}?persona-local-version-label">Current<[\s\S]{0,400}?persona-local-version-label">Remote</,
  );
  // A conflict never offers UPDATE — the only button downloads with a backup.
  assert.match(source, /action: "get-backup"/);
  assert.match(source, /BACK UP LOCAL<\/button>/);
  // Sharing still includes unsaved Personal editor text after the confirm.
  assert.match(
    source,
    /const hasUnsavedChanges =\s*isOpen && personaEditor\.value !== personaState\.savedContent;/,
  );
  assert.match(source, /Your open editor changes will be saved and included/);
});

test("sync state pairs the revision with a content hash", () => {
  // The revision alone cannot tell "behind" apart from "edited here"; the
  // route ships the synced hash and the current local hash side by side.
  assert.match(source, /synced: await readPersonaSyncRevisions\(\)/);
  assert.match(source, /local_hashes: localHashes/);
  assert.match(source, /computePersonaContentHash\(persona\)/);
  assert.match(
    source,
    /personaState\.syncedRevisions =\s*data\.synced && typeof data\.synced === "object" \? data\.synced : \{\}/,
  );
  // Signing out must drop the internal comparison state too.
  assert.match(
    source,
    /personaState\.remotePersonas = \[\];\s*personaState\.syncedRevisions = \{\};\s*personaState\.localHashes = \{\};/,
  );
});

test("a never-synced Persona reads as never synced, not as revision 0", () => {
  // `local: 0` would render "v0", which looks like a real revision. Both
  // copies existing without a sync record is a conflict: downloading would
  // overwrite files of unknown history, so it must back up first.
  assert.match(
    source,
    /entry && typeof entry\.revision === "number" \? entry\.revision : null/,
  );
  assert.match(source, /state: "remote-only",\s*label: "REMOTE ONLY"/);
  assert.match(
    source,
    /synced === null \? "CONFLICT" : "STATUS UNKNOWN"/,
  );
});

test("an update conflict offers GET-with-backup, never a force overwrite", () => {
  assert.match(source, /e\.errorCode === "PERSONA_REVISION_MISMATCH"/);
  assert.match(source, /e\.errorCode === "PERSONA_MANIFEST_CONFLICT"/);
  assert.match(source, /Your local changes will be backed up first/);
  assert.match(source, /pullPersona\(persona, \{ skipConfirm: true \}\)/);
  assert.doesNotMatch(source, /[Ff]orce overwrite/);
  assert.match(source, /pull\.backup_dir/);
});

test("personaBusy never re-enables sync for a signed-out user", () => {
  const start = source.indexOf("function personaBusy(busy)");
  const end = source.indexOf("function renderPersonaSyncButtons()");
  // Both indexes are checked before slicing: a missing name yields -1, and
  // slice(start, -1) would happily return most of the file, so the guard
  // below would pass while scanning the wrong region.
  assert.ok(start >= 0, "personaBusy(busy) must exist");
  assert.ok(end > start, "personaBusy must precede renderPersonaSyncButtons");
  const body = source.slice(start, end);
  // Organization actions must stay out of the bulk disabled = busy list; sync state
  // decides last so being signed out wins over an unlock.
  assert.doesNotMatch(body, /personaPushBtn,/);
  assert.match(body, /renderPersonaSyncButtons\(\);/);
});

test("sign-in changes reach the Persona tab", () => {
  // initPersona() runs once, so refresh() -- which login, logout and the
  // poll all funnel through -- has to drive the sync row.
  assert.match(
    source,
    /renderGuardStatus\(lastStatus\);[\s\S]{0,600}?renderPersonaSyncState\(\);/,
  );
  assert.match(
    source,
    /if \(tab === "persona"\) \{[\s\S]{0,400}?initPersona\(\)\.then\(\(\) => renderPersonaSyncState\(\)\)/,
  );
});

test("pull reports kept local files instead of implying deletion", () => {
  assert.match(source, /kept \(not published yet\)/);
  assert.match(source, /pull\.local_only/);
});

test("push clears the unsaved marker only when the route wrote the file", () => {
  // The route skips the disk write for an empty editor, so the browser must
  // follow its `saved` answer rather than assume the write happened.
  assert.match(
    source,
    /sendJson\(res, 200, \{\s*ok: true,\s*saved,\s*file: savedFile,/,
  );
  assert.match(
    source,
    /if \(data\.saved\) \{\s*setPersonaEditorContent\(/,
  );
});

test("pull restores the file the user had open", () => {
  // applyPersonaListing() blanks the name, so pull validates and restores the
  // selected entry without calling removed tab/picker helpers.
  assert.match(
    source,
    /const openName = samePersona[\s\S]{0,160}?: draftName/,
  );
  assert.match(source, /selectPersonaKind\(openKind\);[\s\S]{0,400}?entry\.name === openName/);
  assert.match(
    source,
    /if \(samePersona\) \{[\s\S]{0,900}?\} else \{[\s\S]{0,300}?must not switch the Personal editor/,
  );
  assert.doesNotMatch(source, /selectPersonaTab\(/);
  assert.doesNotMatch(source, /renderPersonaPicker\(/);
});

test("dashboard sync actions confirm before mutating", () => {
  // The agent prompt promises a confirmation; the dashboard is a third entry
  // point and must not be the one place that skips it.
  assert.match(
    source,
    /This device\\\\u2019s version will become the latest organization version/,
  );
  assert.match(source, /Local files whose contents differ will be overwritten/);
  assert.match(source, /they are backed up first/);
});

test("a malformed sync response fails instead of toasting undefined", () => {
  assert.match(source, /if \(!push\) throw new Error\("Push returned no result"\);/);
  assert.match(source, /if \(!pull\) throw new Error\("Pull returned no result"\);/);
});

test("unsaved Persona edits are guarded or preserved before navigation", () => {
  assert.match(source, /async function confirmDiscardPersonaChanges\(destination\)/);
  assert.match(source, /confirmDiscardPersonaChanges\("the selected file"\)/);
  assert.match(source, /confirmDiscardPersonaChanges\("another project folder"\)/);
  assert.match(source, /confirmDiscardPersonaChanges\("another Persona"\)/);
  assert.match(
    source,
    /const preserve =[\s\S]{0,300}?content: personaEditor\.value/,
  );
  const pullRoute = source.slice(
    source.indexOf("url === '/api/persona/pull'"),
    source.indexOf("url === '/api/persona/save'"),
  );
  assert.match(pullRoute, /body\.preserve/);
  assert.ok(
    pullRoute.indexOf("await savePersonaFile") <
      pullRoute.indexOf("pull = await pullPersonaSync"),
    "the unsaved draft must reach disk before pull creates its backup",
  );
  assert.match(source, /window\.addEventListener\("beforeunload"/);
});

test("Apply rejects empty content before the server can truncate a file", () => {
  assert.match(
    source,
    /if \(!content\.trim\(\)\) \{[\s\S]{0,250}?before applying/,
  );
  assert.match(
    source,
    /if \(!content\.trim\(\)\) \{[\s\S]{0,250}?Save or select another file before applying/,
  );
  assert.match(source, /saved: true,\s*file: savedFile,\s*deploy: deployed/);
});

test("pull downloads and verifies everything before an atomic bundle swap", () => {
  const downloadIndex = syncSource.indexOf("const replacements:");
  const replaceIndex = syncSource.indexOf("await replacePersonaBundleFiles");
  assert.ok(downloadIndex >= 0, "pull must stage downloaded bytes");
  assert.ok(replaceIndex > downloadIndex, "bundle swap must happen after downloads");
  assert.match(syncSource, /No local files were changed/);
  assert.match(personaSource, /export async function replacePersonaBundleFiles/);
  assert.match(personaSource, /await rename\(bundleRoot, previousRoot\)/);
  assert.match(
    personaSource,
    /catch \(error\) \{[\s\S]{0,200}?await rename\(previousRoot, bundleRoot\)/,
  );
});

test("sync state writes are locked, atomic, and cleared with Persona deletion", () => {
  assert.match(syncSource, /await open\(syncStateLockFile\(\), 'wx'\)/);
  assert.match(syncSource, /await rename\(temporary, syncStateFile\(\)\)/);
  assert.match(syncSource, /export async function clearPersonaSyncRevision/);
  assert.match(
    source,
    /const deletedPersona = await deletePersona\(body\.persona\);[\s\S]{0,120}?clearPersonaSyncRevision\(deletedPersona\)/,
  );
  assert.match(
    syncSource,
    /bundleContentHash\(detail\.files\)/,
  );
});

test("remote refresh ignores stale responses and reports local hash failures", () => {
  assert.match(source, /\+\+personaState\.remoteLoadSequence/);
  assert.match(
    source,
    /if \(requestId !== personaState\.remoteLoadSequence\) return;/,
  );
  assert.match(source, /local_hash_errors: localHashErrors/);
  assert.match(source, /state: "unknown",\s*label: "UNAVAILABLE"/);
});
