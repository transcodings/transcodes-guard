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
const scaffoldCommandSource = readFileSync(
  new URL("../src/commands/transcodes/sync.ts", import.meta.url),
  "utf8",
);

test("the CSRF guard stays wired at the request entry point", () => {
  // Both checks live in dashboard-csrf.ts and are unit-tested there. What that
  // cannot see is whether dashboard.ts still calls them -- an unwired guard
  // leaves every POST route open again.
  assert.match(source, /isAllowedRequestOrigin\(\{[\s\S]{0,400}?forbidden origin/);
  assert.match(source, /if \(!hasJsonContentType\(req\)\)/);
});

test("Guide has no Mux player or step timestamp seek buttons", () => {
  assert.doesNotMatch(source, /@mux\/mux-player/);
  assert.doesNotMatch(source, /mux-player/);
  assert.doesNotMatch(source, /GUIDELINE_MUX_PLAYBACK_ID/);
  assert.doesNotMatch(source, /guide-mux-player/);
  assert.doesNotMatch(source, /Watch intro video/i);
  assert.doesNotMatch(source, /guide-step-time/);
  assert.doesNotMatch(source, /data-seek=/);
  assert.doesNotMatch(source, /seekGuideVideo/);
  assert.match(
    source,
    /Create, refine, and apply a Persona to your AI apps/,
  );
});

test("Getting Started focuses on a five-step Persona workflow", () => {
  assert.match(
    source,
    /guide-step-num">1[\s\S]*?Create a Persona with your AI agent[\s\S]*?guide-step-num">2[\s\S]*?Or create a Persona from a preset template[\s\S]*?guide-step-num">3[\s\S]*?Review and edit it[\s\S]*?guide-step-num">4[\s\S]*?Apply it to your AI apps[\s\S]*?guide-step-num">5[\s\S]*?Sync and share with your team/,
  );
  // The template step has to reach the Templates view, not just the tab.
  assert.match(
    source,
    /data-persona-view="templates">Templates<[\s\S]{0,400}?six presets/,
  );
  assert.match(
    source,
    /data-persona-view="remote">Organization[\s\S]*?upload this persona to my organization/,
  );
  assert.doesNotMatch(source, /Set permissions in the Transcodes app/);
  assert.doesNotMatch(source, /try a security check/);
  assert.doesNotMatch(source, /Get notifications on channels/);
  assert.doesNotMatch(source, /View activity histories \/ security log/);
});

test("Guide footer links to the Transcodes tutorial channel", () => {
  assert.match(
    source,
    /Channel: <a href="https:\/\/www\.youtube\.com\/@hellotranscodes"/,
  );
  assert.match(
    source,
    /\.guide-footer-line a \{[\s\S]{0,40}?color: var\(--highlight\);/,
  );
  assert.match(
    source,
    /Channel:[\s\S]*Questions or trouble setting up\?[\s\S]*Full documentation:/,
  );
});

test("Persona Save state is button-only, without a status banner", () => {
  assert.match(source, /class="btn-save" id="persona-save-btn" disabled/);
  assert.match(source, /personaEditor\.value !== personaState\.savedContent/);
  assert.match(source, /\.btn-save:not\(:disabled\) \{[\s\S]{0,80}?background: var\(--accent\);/);
  assert.match(source, /\.actions \.btn-save:disabled \{[\s\S]{0,60}?opacity: 1;/);
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
    /<details class="persona-agent-callout persona-agent-callout--workspace persona-agent-callout--toolbar">/,
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
  assert.match(
    source,
    /ICON_PERSONA\.replace\(\s*'<svg ',\s*'<svg class="persona-agent-callout-icon" ',?\s*\)/,
  );
  assert.match(source, /M9\.813 15\.904/);
  assert.doesNotMatch(source, /m12 3-1\.2 3\.4/);
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
  assert.match(source, /id="persona-bundle-remote-ver"/);
  assert.match(source, /function personaBundleVersionText\(\)/);
  assert.match(
    source,
    /"Current " \+ current \+ " · Remote " \+ remote/,
  );
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
  assert.match(source, /id="persona-file-backdrop"/);
  assert.match(source, /id="persona-file-menu"/);
  assert.match(source, /addEventListener\(\s*"pointerdown"/);
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
  assert.match(source, /class="persona-content-heading"/);
  assert.match(source, /class="persona-content-metrics"/);
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

test("Persona text files open as a rendered preview, not raw source", () => {
  assert.match(source, /id="persona-md-preview"/);
  assert.match(source, /id="persona-edit-btn"/);
  assert.match(source, /id="persona-cancel-btn"/);
  assert.doesNotMatch(source, /id="persona-view-toggle"/);
  assert.match(source, /function canPersonaPreview/);
  assert.match(source, /function setPersonaEditorView/);
  assert.match(source, /function renderPersonaMarkdownPreview/);
  assert.match(source, /personaMdPreview\.classList\.toggle\("is-code"/);
  assert.match(source, /esm\.sh\/marked@15/);
  assert.match(source, /esm\.sh\/dompurify@3/);
  assert.match(source, /setPersonaEditorView\("source"\)/);
  assert.match(source, /personaSaveBtn\.disabled = personaState\.busy;/);
  assert.doesNotMatch(source, /personaSaveBtn\.disabled = personaState\.busy \|\| !dirty/);
  assert.match(
    source,
    /#panel-persona \.persona-md-preview \{[\s\S]{0,120}?flex: 1;[\s\S]{0,80}?min-height: 0;/,
  );
  assert.match(source, /\.persona-md-preview table \{/);
  assert.match(source, /\.persona-md-preview img \{/);
  assert.match(source, /function rewritePersonaPreviewImages/);
  assert.match(source, /\/api\/persona\/asset/);
  assert.match(source, /function renderPersonaMermaidDiagrams/);
  assert.match(source, /esm\.sh\/mermaid@11/);
  assert.match(source, /pre code\.language-mermaid/);
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

test("pull preserves the file the editor actually holds", () => {
  // Both halves are load-bearing. Without `file` the route defaults to
  // SKILL.md, so preserving an edited companion (scripts/extract.py) would
  // write Python into the Skill's instructions and lose both files.
  assert.match(
    source,
    /const preserve =[\s\S]{0,400}?file:\s*\n?\s*personaState\.kind === "skill" \? personaState\.file : undefined,/,
  );
  assert.match(
    source,
    /preservedFile = await savePersonaFile\(\{[\s\S]{0,900}?file: typeof preserve\.file === 'string' \? preserve\.file : undefined,/,
  );
});

test("pull returns the editor to the file it was on", () => {
  // Preserving the companion on disk is only half of it. applyPersonaListing()
  // resets personaState.file to SKILL.md, so without restoring it the editor
  // reloads the instructions and the user reads that as their edit being gone.
  assert.match(source, /const openFile = samePersona \? personaState\.file : "SKILL\.md";/);
  assert.match(
    source,
    /personaState\.name = entries\.some[\s\S]{0,600}?personaState\.file =\s*\n?\s*currentSkillFiles\(\)\.indexOf\(openFile\) !== -1\s*\n?\s*\? openFile\s*\n?\s*: "SKILL\.md";/,
  );
});

test("push reports whether the editor contents reached the disk", () => {
  // `saved` must be a boolean: the catch block hands it to the error handler,
  // which tests `=== true`. A truthy string would be dropped there and a
  // completed write would surface to the browser as "not saved".
  assert.match(
    source,
    /const saved =\s*\n?\s*content\.trim\(\) !== '' && \(kind === 'agent' \|\| name\.trim\(\) !== ''\);/,
  );
  assert.match(source, /\.saved === true/);
});

test("a Skill file that cannot be opened leaves the picker consistent", () => {
  // personaState.file never moves on these paths, but the menu already closed
  // against the clicked entry, so the picker has to be re-rendered.
  assert.match(
    source,
    /if \(data\.binary\) \{[\s\S]{0,400}?renderPersonaFilePicker\(\);\s*\n\s*return;/,
  );
  assert.match(
    source,
    /showToast\(e\.message \|\| "Could not open that file", "error"\);\s*\n\s*renderPersonaFilePicker\(\);/,
  );
});

test("--force refreshes the whole Skill bundle, not only SKILL.md", () => {
  // Without this the flag rewrites SKILL.md from the current template while
  // scripts/ and references/ keep the old one, leaving the two out of step.
  assert.match(
    scaffoldCommandSource,
    /for \(const extra of scaffold\.extraFiles\)[\s\S]{0,600}?if \(\(await fileExists\(extraPath\)\) && !force\)/,
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
  assert.match(source, /Files larger than 5 MB cannot be added/);
  assert.match(personaSource, /MAX_PERSONA_FILE_BYTES = 5 \* 1024 \* 1024/);
});

test("skill files and folders can be deleted from the dropdown", () => {
  assert.match(source, /class="persona-file-remove"/);
  assert.match(
    source,
    /\.persona-file-remove svg,[\s\S]{0,40}?\.persona-file-add svg \{[\s\S]{0,40}?width: 15px;/,
  );
  assert.match(source, /data-remove-' \+[\s\S]{0,40}?\(isDir \? "dir" : "file"\)/);
  assert.match(source, /\[data-remove-file\]/);
  assert.match(source, /\[data-remove-dir\]/);
  assert.match(source, /PERSONA_FILE_TRASH_ICON/);
  assert.match(source, /m14\.74 9-\.346 9m-4\.788 0L9\.26 9/);
  assert.match(source, /async function deleteSkillPathFromMenu/);
  assert.match(source, /"\/api\/persona\/delete-skill-path"/);
  assert.match(source, /url === '\/api\/persona\/delete-skill-path'/);
  assert.match(personaSource, /export async function deleteSkillPath/);
  assert.match(personaSource, /SKILL\.md is required and cannot be deleted/);
  // The mandatory Skill file has no trash control.
  assert.match(source, /if \(file === "SKILL\.md"\) return item;/);
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
  // GET FROM REMOTE / PUBLISH TO REMOTE live on the unified Organization
  // list; Personal does not duplicate them.
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
  assert.match(source, /Sign in to sync your Personas/);
  assert.match(
    source,
    /Set up once\. Every device and every teammate runs the same versions of Persona/,
  );
  assert.match(source, /Get the latest/);
  assert.match(source, /Publish yours/);
  assert.match(
    source,
    /Push Personas from this device so everyone works from one version/,
  );
  assert.match(source, /Stay in sync/);
  assert.match(source, /Sign in to manage your account/);
  assert.match(source, /Your account/);
  assert.match(source, /This device/);
  assert.match(source, /Set AI limits\. Require human approval\. Keep records/);
  assert.match(source, /Control what your AI can do/);
  assert.match(source, /Set limits/);
  assert.match(source, /Confirm with your finger/);
  assert.match(source, /Keep a record/);
  assert.match(source, /id="rbac-signin"/);
  assert.match(source, /id="rbac-signed-in"/);
  assert.match(source, /function renderRbacAuthGate/);
  assert.match(source, /hideCta: true/);
  assert.match(source, /rbacSignInEl\.innerHTML = permissionSignInCardHtml\(\)/);
  assert.match(source, /rbacSignedInEl\.hidden = true/);
  assert.doesNotMatch(source, /rbacSignedInEl\.hidden = false/);
  assert.match(source, /function authViewState/);
  assert.match(source, /let sessionReady = false/);
  assert.match(source, /class="panel-loading">Loading/);
  assert.match(source, /authViewState\(\) === "loading"/);
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
    /\[data-remote-sync\], \[data-remote-upload\], \[data-remote-rollback\][\s\S]*?button\.disabled =\s*!signedIn \|\| personaState\.busy \|\| personaState\.remoteLoading;/,
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
  assert.match(source, /class="persona-group-label persona-library-title">My Personas</);
  assert.match(source, /id="persona-remote-tab">Organization</);
  assert.match(
    source,
    /class="persona-bundle-help">Only Personas on this device are listed here/,
  );
  assert.doesNotMatch(source, /id="persona-local-tab" aria-current="page">Personal</);
  assert.doesNotMatch(source, /id="persona-remote-tab">Team</);
  assert.doesNotMatch(source, /class="persona-mode-tabs"/);
  assert.doesNotMatch(source, /id="persona-sync-card"/);
});

test("Persona submenu offers Templates above My Personas", () => {
  assert.match(
    source,
    /id="persona-templates-tab">Templates<[\s\S]{0,200}?id="persona-local-tab" aria-current="page">My Personas<[\s\S]{0,200}?id="persona-remote-tab">Organization</,
  );
  assert.match(source, /id="persona-templates-view"/);
  assert.match(
    source,
    /class="persona-remote-title">Templates<[\s\S]*?persona-templates-help[\s\S]*?How to use these templates[\s\S]*?1\. Create a Persona\.[\s\S]*?2\. Customize it for your project\.[\s\S]*?3\. Or ask your AI agent to customize it\./,
  );
  assert.match(
    source,
    /<details class="persona-agent-callout persona-agent-callout--workspace persona-templates-help">/,
  );
  assert.match(source, /class="persona-templates-grid">\$\{personaTemplateCardsHtml\(\)\}/);
  // Three sibling views means the tab switch has to drive all three panels.
  assert.match(
    source,
    /\[personaLocalTab, personaLocalView, "local"\],\s*\[personaTemplatesTab, personaTemplatesView, "templates"\],\s*\[personaRemoteTab, personaRemoteView, "remote"\],/,
  );
  assert.match(
    source,
    /personaTemplatesTab\.addEventListener\("click", \(\) =>\s*setPersonaView\("templates"\)/,
  );
  assert.match(source, /PERSONA_TEMPLATE_TABS\[key\]\) return "templates"/);
});

test("Templates cards create a Persona from the server-side catalog", () => {
  assert.match(source, /function personaTemplateCardsHtml\(\)/);
  assert.match(source, /personaTemplateSummaries\(\)/);
  assert.match(source, /data-template-card="\$\{id\}"/);
  assert.match(source, /data-template-open="\$\{id\}"/);
  assert.match(source, /data-template-cancel="\$\{id\}"/);
  assert.match(source, /data-template-form="\$\{id\}"/);
  assert.match(
    source,
    /createPersonaFromTemplate\(template, name\)[\s\S]{0,700}?"\/api\/persona\/create-from-template"/,
  );
  // A named Persona is required before the request goes out.
  assert.match(
    source,
    /const persona = \(name \|\| ""\)\.trim\(\);\s*if \(!persona\) \{\s*showToast\("Enter a Persona name\.", "error"\);/,
  );
  // Creating from a card lands the user in the editor with the new bundle open.
  assert.match(
    source,
    /await renderPersonaSyncState\(\);[\s\S]{0,140}?setPersonaView\("local"\);/,
  );
  // A failed Rule or Skill write must not leave half a bundle behind.
  assert.match(
    source,
    /url === '\/api\/persona\/create-from-template'[\s\S]{0,1600}?await deletePersona\(persona\)\.catch\(\(\) => \{\}\);/,
  );
});

test("dashboard pages use path URLs, with Persona subviews as ?tab=my|templates|team", () => {
  assert.match(source, /function routeFromUrl/);
  assert.match(source, /function pathForRoute/);
  assert.match(source, /url\.pathname = pathForRoute/);
  assert.match(
    source,
    /url\.searchParams\.set\(\s*"tab",\s*personaView === "remote"\s*\? "team"\s*: personaView === "templates"\s*\? "templates"\s*: "my"\s*\)/,
  );
  assert.match(source, /guideline: "\/guide"/);
  assert.match(source, /persona: "\/persona"/);
  assert.match(source, /tokens: "\/profile"/);
  assert.match(source, /rbac: "\/permission"/);
  assert.match(source, /\? "team"/);
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

test("dashboard palette matches the Transcodes console grayscale", () => {
  assert.match(source, /--bg: #F9FAFB;/);
  assert.match(source, /--line: #E5E7EB;/);
  assert.match(source, /--ink: #111827;/);
  assert.match(source, /--muted: #6B7280;/);
  assert.match(source, /--accent: #111827;/);
  assert.match(source, /--accent-soft: #F3F4F6;/);
  assert.match(source, /--highlight: #5b54e6;/);
  assert.match(source, /--highlight-soft: #eeedfb;/);
  assert.match(source, /--action: var\(--highlight\);/);
  assert.match(source, /class="btn-action persona-deploy-btn"/);
  assert.match(
    source,
    /\.persona-agent-callout \{[\s\S]{0,220}?background: var\(--highlight-soft\);/,
  );
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
    /<div class="sidebar-version">[\s\S]*?Ver \$\{CLI_VERSION\}[\s\S]*?id="cli-version-cmd">transcodes version/,
  );
  assert.match(source, /url === '\/api\/cli-version'/);
  assert.match(source, /function refreshCliVersionHint\(\)/);
  assert.match(
    source,
    /\.card > #panel-rbac \{[\s\S]{0,80}?width: 100%;[\s\S]{0,160}?overflow-y: auto;/,
  );
  assert.match(source, /cmd\.textContent = "Require Update"/);
  assert.match(
    source,
    /data-tab="tokens"[\s\S]*?Profile[\s\S]*?sidebar-divider[\s\S]*?data-tab="rbac"[\s\S]*?Permission/,
  );
  assert.doesNotMatch(
    source,
    /data-tab="rbac"[\s\S]{0,200}?<span class="tab-beta">/,
  );
  assert.match(
    source,
    /panel-page-title">Permission<\/h2>[\s\S]{0,80}?<span class="tab-beta">Upcoming<\/span>/,
  );
  assert.match(
    source,
    /guide-topic-title">Getting Started[\s\S]*?guide-topic-title">Persona[\s\S]*?guide-topic-title">Profile[\s\S]*?guide-topic-title">Permission <span class="tab-beta">Upcoming<\/span>/,
  );
  assert.doesNotMatch(
    source,
    /\.tab-beta \{[\s\S]{0,280}?text-transform: uppercase;/,
  );
  assert.match(
    source,
    /\.tab-beta \{[\s\S]{0,220}?background: var\(--highlight-soft\);[\s\S]{0,40}?color: var\(--highlight\);/,
  );
  assert.match(
    source,
    /\.card > \.tabs > \.tab,[\s\S]{0,180}?padding: 11px 24px 11px 13px;/,
  );
  assert.match(
    source,
    /\.card > \.tabs > \.tab\.active,[\s\S]{0,120}?background: var\(--accent-soft\);/,
  );
  assert.doesNotMatch(source, /class="dashboard-footer"/);
  assert.match(
    source,
    /#panel-guideline \{[\s\S]{0,80}?scrollbar-width: none;/,
  );
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
    /#panel-persona \.persona-registry-body \{[\s\S]{0,160}?flex: 1;[\s\S]{0,120}?width: 100%;[\s\S]{0,100}?min-height: 0;[\s\S]{0,180}?overflow-x: hidden;[\s\S]{0,80}?overflow-y: auto;[\s\S]{0,40}?scrollbar-width: none;/,
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
    /#panel-persona \.persona-remote-view,[\s\S]{0,80}?\{[\s\S]{0,220}?width: 100%;[\s\S]{0,180}?padding: 30px 36px 40px;/,
  );
  assert.match(
    source,
    /#panel-persona \.persona-remote-list,[\s\S]{0,140}?\{[\s\S]{0,80}?max-width: 1160px;/,
  );
  assert.doesNotMatch(source, /id="persona-remote-local"/);
  assert.doesNotMatch(source, /class="persona-remote-title">Local Personas</);
  assert.doesNotMatch(source, /function renderLocalPersonaCards/);
  assert.match(
    source,
    /id="persona-remote-refresh-btn"[\s\S]*?class="persona-remote-refresh-icon"[\s\S]*?Refresh/,
  );
  assert.match(
    source,
    /persona-remote-head-actions[\s\S]*?data-app-tab="personas"[\s\S]*?View Personas/,
  );
  assert.match(
    source,
    /function appPersonasUrl\(organizationId\)[\s\S]*?\/access\?section=personas/,
  );
  assert.match(source, /function personaSyncRowHtml\(personaId, withActions\)/);
  assert.match(source, /function personaSyncGroupsHtml\(ids, signedIn\)/);
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

test("Organization list groups by what needs attention", () => {
  assert.match(source, /remote\.updated_by_name \|\| remote\.updated_by_email/);
  assert.match(source, /formatPersonaRelativeTime\(remote\.updated_at\)/);
  assert.match(source, /class="persona-remote-title">Organization</);
  assert.match(
    source,
    /\.persona-sync-group-title \{[\s\S]{0,160}?font-size: var\(--text-lg\);/,
  );
  assert.match(source, /persona-sync-actions-card/);
  assert.doesNotMatch(source, /persona-sync-actions-card" open>/);
  assert.match(source, /What Each Action Does/);
  assert.doesNotMatch(source, /What each action does/);
  assert.match(source, /id="persona-sync-actions-card"/);
  assert.match(source, /personaSyncActionsCard\.hidden = !signedIn/);
  assert.match(source, /ICON_BOLT\.replace\(/);
  assert.match(source, /m3\.75 13\.5 10\.5-11\.25L12 10\.5h8\.25/);
  assert.match(
    source,
    /\.persona-sync-actions-help \{[\s\S]{0,200}?text-align: left;/,
  );
  assert.match(source, /class="persona-sync-actions-help"/);
  assert.match(source, /<strong>Download<\/strong> — Get your team's latest version/);
  assert.match(source, /<strong>Download · backup<\/strong> — Get your team's latest version/);
  assert.match(source, /<strong>Upload<\/strong> — Make your current local work/);
  assert.match(source, /<strong>Publish<\/strong> — Share this with your team/);
  assert.match(source, /<strong>Roll Back<\/strong> — Undo your changes/);
  // Action first: rows that need Get/Publish, then a collapsed Up to date list.
  assert.match(source, /NEEDS ATTENTION \(/);
  // Count 0 still shows the heading. No empty-state copy under it.
  assert.match(
    source,
    /NEEDS ATTENTION \(' \+[\s\S]*?attention\.length[\s\S]*?if \(attention\.length\)/,
  );
  assert.doesNotMatch(source, /Nothing needs attention/);
  assert.doesNotMatch(source, /No Personas need attention/);
  assert.match(source, /UP TO DATE \(/);
  assert.match(source, /id="persona-sync-current-toggle"/);
  assert.match(source, /personaState\.currentExpanded/);
  assert.match(source, /function personaSyncHeadHtml/);
  assert.match(source, /class="persona-sync-row-ver">Remote</);
  assert.match(source, /class="persona-sync-row-ver">Local</);
  assert.match(
    source,
    /\.persona-sync-row-ver \{[\s\S]{0,200}?text-align: center;/,
  );
  assert.doesNotMatch(source, /persona-sync-row-arrow/);
  assert.doesNotMatch(source, /This device → Remote/);
  assert.match(
    source,
    /status\.local === null \? "—" : String\(status\.local\)/,
  );
  assert.match(source, /status\.org === null \? "—" : String\(status\.org\)/);
  assert.doesNotMatch(source, /class="persona-update-chip"/);
  assert.doesNotMatch(source, /function personaCardHtml/);
  assert.doesNotMatch(source, /class="persona-version-row"/);
  assert.match(source, /function personaSyncReason\(status\)/);
  assert.match(source, /class="persona-sync-row-status">Status</);
  assert.match(source, /class="persona-sync-row-updated">Updated</);
  assert.match(source, /describeRemotePersona\(status\.remote\)/);
  assert.match(source, /case "local-only":\s*return "Not published"/);
  assert.match(source, /case "remote-only":\s*return "Remote only"/);
  assert.match(source, /case "edited":\s*return "Edited"/);
  assert.match(source, /case "behind":\s*return "Remote newer"/);
  // Apostrophes inside the outer HTML template literal become real quotes
  // in the browser script and break every click handler.
  assert.doesNotMatch(source, /Couldn\\'t/);
});

test("the status classifier maps every state to exactly one safe action", () => {
  // org newer + unedited → GET FROM REMOTE; org same + edited → UPDATE REMOTE;
  // org newer + edited → conflict (Get from remote with backup); equal → nothing.
  assert.match(source, /function personaSyncStatus\(personaId\)/);
  assert.match(source, /const edited = currentHash !== syncedHash;/);
  assert.match(source, /const behind = org > synced;/);
  assert.match(source, /state: "behind",\s*label: "UPDATE REQUIRED"/);
  assert.match(source, /state: "edited",\s*label: "EDITED"/);
  assert.match(source, /state: "conflict",\s*label: "CONFLICT"/);
  assert.match(source, /state: "current",\s*label: "LATEST"/);
  assert.match(source, /state: "local-only",\s*label: ""/);
  assert.doesNotMatch(source, /class="persona-local-version-grid"/);
  assert.doesNotMatch(source, /UNVERSIONED/);
  assert.doesNotMatch(source, /class="persona-local-sync-state"/);
  assert.match(source, /id="persona-bundle-remote-ver"/);
  // A conflict never offers Update — the only button downloads with a backup.
  assert.match(source, /action: "get-backup"/);
  assert.match(source, />Download · backup<\/button>/);
  assert.match(source, />Download<\/button>/);
  assert.match(
    source,
    /status\.state === "local-only" \? "Publish" : "Upload"/,
  );
  assert.match(source, /data-remote-rollback="/);
  assert.match(source, />Roll Back<\/button>/);
  assert.match(
    source,
    /\.persona-sync-row-action \{[\s\S]{0,80}?flex-direction: column;/,
  );
  assert.match(source, /rollback: true/);
  assert.match(source, /Discard local edits on /);
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
    /if \(samePersona\) \{[\s\S]{0,1300}?\} else \{[\s\S]{0,300}?must not switch the Personal editor/,
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

test("signed-in Profile and header show the organization plan badge", () => {
  assert.match(
    source,
    /path: '\/membership\/customer\/status\/organization'/,
  );
  assert.match(source, /query: \{ organization_id: config\.organizationId \}/);
  assert.match(source, /function normalizePlanName\(name: string\): PlanName/);
  assert.match(source, /plan\?: PlanName;/);
  assert.match(source, /id="profile-row-plan"/);
  assert.match(source, /function planBadgeHtml\(plan\)/);
  assert.match(source, /class="plan-badge plan-badge--'/);
  assert.match(source, /\.plan-badge--free \{/);
  assert.match(source, /\.plan-badge--paid \{/);
  assert.match(source, /planBadgeHtml\(am\.plan\)/);
  assert.match(source, /setProfilePlanRow\(am\.plan\)/);
  assert.match(
    source,
    /headerProfileNameEl\.textContent = am\.email \|\| "Signed in"/,
  );
  assert.match(
    source,
    /am\.organizationName \|\| am\.organizationId \|\| activeTok\.organizationId/,
  );
  assert.match(source, /profileWorkspaceEl\.textContent = am\.name \|\| ""/);
  assert.doesNotMatch(source, /\[am\.organizationName, am\.projectName\]/);
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
