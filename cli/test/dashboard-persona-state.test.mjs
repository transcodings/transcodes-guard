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
