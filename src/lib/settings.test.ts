import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, parseSeen, parseSettings } from "./settings.ts";

test("a device that has never been configured has both switches off", () => {
  assert.deepEqual(parseSettings(null), DEFAULTS);
  assert.deepEqual(parseSettings(""), DEFAULTS);
  assert.deepEqual(parseSettings("{not json"), DEFAULTS);
});

test("only true is true", () => {
  assert.deepEqual(parseSettings('{"autosave":"yes","remember":1}'), DEFAULTS);
  assert.deepEqual(parseSettings('{"autosave":true}'), { autosave: true, remember: false });
  assert.deepEqual(parseSettings('{"autosave":true,"remember":true}'), {
    autosave: true,
    remember: true,
  });
});

test("a device that has seen nothing has nothing to compare against", () => {
  // Zero is below every counter a record can carry, so a fresh device trusts
  // what it is given -- and every later read is measured against it.
  assert.equal(parseSeen(null), 0);
  assert.equal(parseSeen(""), 0);
  assert.equal(parseSeen("not a number"), 0);
  assert.equal(parseSeen("-3"), 0);
  assert.equal(parseSeen("1e400"), 0);
  assert.equal(parseSeen("7"), 7);
});
