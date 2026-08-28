import assert from "node:assert/strict";
import { test } from "node:test";
import { asValue, COLLECTION, context, type Note, parse, VERSION } from "./record.ts";

const note: Note = {
  v: VERSION,
  salt: "salt",
  key: "wrapped",
  body: "ciphertext",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

test("what is written is what is read", () => {
  const value = asValue(note);
  assert.equal(value.$type, COLLECTION);
  assert.deepEqual(parse(value), note);
});

test("a record without a timestamp still opens", () => {
  assert.equal(parse({ ...asValue(note), updatedAt: undefined }).updatedAt, "");
});

test("a missing field is named", () => {
  assert.throws(() => parse({ ...asValue(note), key: undefined }), /missing key/);
  assert.throws(() => parse({ v: VERSION, salt: "salt" }), /missing key/);
  assert.throws(() => parse("nonsense"), /not an object/);
  assert.throws(() => parse(null), /not an object/);
});

test("an empty string is as missing as no string", () => {
  assert.throws(() => parse({ ...asValue(note), body: "" }), /missing body/);
});

test("a record from another scheme is refused, not guessed at", () => {
  // Records live in other people's repos, so there is no migration to run --
  // only a reader that can say plainly it is not the one being addressed.
  assert.throws(() => parse({ ...asValue(note), v: VERSION + 1 }), /version/);
  assert.throws(() => parse({ ...asValue(note), v: undefined }), /version/);
  assert.throws(() => parse({ ...asValue(note), v: String(VERSION) }), /version/);
});

test("the context names the account, the record and the scheme", () => {
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  assert.equal(decode(context("did:plc:abc")), `${COLLECTION}/self/${VERSION}/did:plc:abc`);
  assert.notDeepEqual(context("did:plc:abc"), context("did:plc:xyz"));
});
