import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/commands/transcodes/dashboard.ts", import.meta.url),
  "utf8",
);

test("the CSRF guard stays wired at the request entry point", () => {
  // Both checks live in dashboard-csrf.ts and are unit-tested there. What that
  // cannot see is whether dashboard.ts still calls them -- an unwired guard
  // leaves every POST route open again.
  assert.match(source, /isAllowedRequestOrigin\(\{[\s\S]{0,400}?forbidden origin/);
  assert.match(source, /if \(!hasJsonContentType\(req\)\)/);
});

test("Persona Save and Apply states stay explicit", () => {
  assert.match(source, /id="persona-save-btn" disabled/);
  assert.match(source, /personaEditor\.value !== personaState\.savedContent/);
  assert.match(source, /Saved · Not applied yet/);
  assert.match(source, /Apply failed · Review the log and try again/);
  assert.match(source, /Current edits will be saved first/);
});

test("Persona sync is gated on being signed in", () => {
  assert.match(source, /id="persona-push-btn"/);
  assert.match(source, /id="persona-pull-btn"/);
  // The notice must keep saying local work still works signed out --
  // otherwise it reads as though the whole tab is locked.
  assert.match(source, /Creating, editing, and applying still work/);
  assert.match(
    source,
    /personaPushBtn\.disabled = disabled;[\s\S]*?personaPullBtn\.disabled = disabled;/,
  );
  assert.match(source, /const disabled = !signedIn \|\| personaState\.busy;/);
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
  // Push/Pull must stay out of the bulk disabled = busy list; sync state
  // decides last so being signed out wins over an unlock.
  assert.doesNotMatch(body, /personaPushBtn,/);
  assert.doesNotMatch(body, /personaPullBtn,/);
  assert.match(body, /renderPersonaSyncButtons\(\);/);
});

test("sign-in changes reach the Persona tab", () => {
  // initPersona() runs once, so refresh() -- which login, logout and the
  // poll all funnel through -- has to drive the sync row.
  assert.match(
    source,
    /renderGuardStatus\(lastStatus\);[\s\S]{0,200}?renderPersonaSyncState\(\);/,
  );
  assert.match(source, /if \(tab === "persona"\) \{[\s\S]{0,200}?renderPersonaSyncState\(\);/);
});

test("pull reports kept local files instead of implying deletion", () => {
  assert.match(source, /kept \(not shared yet\)/);
  assert.match(source, /pull\.local_only/);
});

test("push clears the unsaved marker only when the route wrote the file", () => {
  // The route skips the disk write for an empty editor, so the browser must
  // follow its `saved` answer rather than assume the write happened.
  assert.match(source, /sendJson\(res, 200, \{\s*ok: true,\s*saved,/);
  assert.match(source, /if \(data\.saved\) \{\s*personaState\.savedContent = content;/);
});

test("pull restores the file the user had open", () => {
  // applyPersonaListing() blanks the name, and renderPersonaPicker() then
  // falls back to the first entry -- so pull has to put the selection back.
  assert.match(source, /const openName = personaState\.name;/);
  assert.match(source, /selectPersonaTab\(openKind\);[\s\S]{0,300}?personaState\.name = openName;/);
});

test("dashboard sync actions confirm before mutating", () => {
  // The agent prompt promises a confirmation; the dashboard is a third entry
  // point and must not be the one place that skips it.
  assert.match(source, /Everyone in the organization will be able to read and pull it/);
  assert.match(source, /Local files whose contents differ will be overwritten/);
});

test("a malformed sync response fails instead of toasting undefined", () => {
  assert.match(source, /if \(!push\) throw new Error\("Push returned no result"\);/);
  assert.match(source, /if \(!pull\) throw new Error\("Pull returned no result"\);/);
});
