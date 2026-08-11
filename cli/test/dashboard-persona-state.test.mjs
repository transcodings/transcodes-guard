import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/commands/transcodes/dashboard.ts", import.meta.url),
  "utf8",
);

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
  const body = source.slice(
    source.indexOf("function personaBusy(busy)"),
    source.indexOf("function renderPersonaSyncButtons()"),
  );
  assert.ok(body.length > 0, "personaBusy must precede renderPersonaSyncButtons");
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
