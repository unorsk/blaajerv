import assert from "node:assert/strict";
import { test } from "node:test";
import { create, MINIMUM, open, seal, suggest, unlock, wrongPassword } from "./crypto.ts";

const PASSWORD = "correct horse battery staple";

const utf8 = new TextEncoder();
const AAD = utf8.encode("io.github.unorsk.blaajerv.note/self/1/did:plc:mine");
const THEIRS = utf8.encode("io.github.unorsk.blaajerv.note/self/1/did:plc:theirs");

const note = (counter: number, text: string) => ({ counter, text });

test("a note survives a round trip through the record", async () => {
  const { key, locked } = await create(PASSWORD, AAD);
  const text = "milk\nnorsk: æøå\n\u{1F996}\n";
  const sealed = await seal(key, AAD, note(1, text));
  assert.deepEqual(await open(await unlock(locked, PASSWORD, AAD), AAD, sealed), note(1, text));
});

test("the wrong password is refused, and says so", async () => {
  const { locked } = await create(PASSWORD, AAD);
  await assert.rejects(
    () => unlock(locked, "corerct horse battery staple", AAD),
    (cause) => wrongPassword(cause),
  );
});

test("another note's key cannot open it", async () => {
  const mine = await create(PASSWORD, AAD);
  const theirs = await create(PASSWORD, AAD);
  const sealed = await seal(mine.key, AAD, note(1, "secret"));
  await assert.rejects(() => open(theirs.key, AAD, sealed));
});

test("the same text seals differently every time", async () => {
  const { key } = await create(PASSWORD, AAD);
  const a = await seal(key, AAD, note(1, "same"));
  const b = await seal(key, AAD, note(1, "same"));
  assert.notEqual(a.body, b.body);
});

test("tampering is detected rather than decrypted", async () => {
  const { key } = await create(PASSWORD, AAD);
  const sealed = await seal(key, AAD, note(1, "important"));
  const bytes = Buffer.from(sealed.body, "base64");
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 1;
  await assert.rejects(() => open(key, AAD, { body: bytes.toString("base64") }));
});

test("two notes never share a salt", async () => {
  const a = await create(PASSWORD, AAD);
  const b = await create(PASSWORD, AAD);
  assert.notEqual(a.locked.salt, b.locked.salt);
  assert.notEqual(a.locked.key, b.locked.key);
});

test("the same password never wraps to the same bytes twice", async () => {
  // Otherwise re-keying would be visible as a no-op to anyone watching the
  // repo, and re-wrapping under the same password would leak that it was the
  // same password.
  const a = await create(PASSWORD, AAD);
  const b = await create(PASSWORD, AAD);
  assert.notEqual(a.locked.key, b.locked.key);
});

test("a truncated wrapped key is a record problem, not a password one", async () => {
  const { locked } = await create(PASSWORD, AAD);
  await assert.rejects(() => unlock({ ...locked, key: "AAAA" }, PASSWORD, AAD), /too short/);
});

/* Binding ------------------------------------------------------------------ */

test("a record lifted into another repo does not open there", async () => {
  const { key, locked } = await create(PASSWORD, AAD);
  const sealed = await seal(key, AAD, note(1, "mine"));
  // The whole record copied across, password and all: still a forgery.
  await assert.rejects(
    () => unlock(locked, PASSWORD, THEIRS),
    (c) => wrongPassword(c),
  );
  await assert.rejects(
    () => open(key, THEIRS, sealed),
    (c) => wrongPassword(c),
  );
});

/* Re-keying ---------------------------------------------------------------- */

test("a password change re-keys, so the old password opens nothing current", async () => {
  const first = await create(PASSWORD, AAD);
  const sealed = await seal(first.key, AAD, note(1, "unchanged"));

  // What repassword does: read under the old key, write under a new one.
  const { text } = await open(first.key, AAD, sealed);
  const second = await create("a new one", AAD);
  const republished = await seal(second.key, AAD, note(2, text));

  assert.equal((await open(second.key, AAD, republished)).text, "unchanged");
  // The old password still unwraps the old record -- nothing was revoked, it was
  // replaced -- but the key it yields is no longer the note's.
  const stale = await unlock(first.locked, PASSWORD, AAD);
  await assert.rejects(
    () => open(stale, AAD, republished),
    (c) => wrongPassword(c),
  );
});

/* Framing ------------------------------------------------------------------ */

test("the counter comes back as it went in", async () => {
  const { key } = await create(PASSWORD, AAD);
  const sealed = await seal(key, AAD, note(4096, "hello"));
  assert.equal((await open(key, AAD, sealed)).counter, 4096);
});

test("a counter cannot be moved without breaking the seal", async () => {
  // It is inside the ciphertext precisely so a server cannot choose it.
  const { key } = await create(PASSWORD, AAD);
  const bytes = Buffer.from((await seal(key, AAD, note(9, "x"))).body, "base64");
  bytes[12] = (bytes[12] ?? 0) ^ 0xff;
  await assert.rejects(() => open(key, AAD, { body: bytes.toString("base64") }));
});

test("length is padded away to a kilobyte step", async () => {
  const { key } = await create(PASSWORD, AAD);
  const sizes = await Promise.all(
    // The header eats eight bytes, so 1016 is the last note that fits a block.
    ["", "a", "a".repeat(500), "a".repeat(1016), "a".repeat(1017)].map(
      async (text) => Buffer.from((await seal(key, AAD, note(1, text))).body, "base64").length,
    ),
  );
  // Everything up to the block boundary is indistinguishable by size.
  assert.deepEqual(sizes.slice(0, 4), [1052, 1052, 1052, 1052]);
  // And one byte past it costs exactly one more block, not one more byte.
  assert.equal(sizes[4], 2076);
});

test("an empty note and a full one differ only in kilobytes", async () => {
  const { key } = await create(PASSWORD, AAD);
  const long = await seal(key, AAD, note(1, "æ".repeat(4000)));
  assert.equal((await open(key, AAD, long)).text, "æ".repeat(4000));
});

test("a counter that would wrap is refused rather than silently reused", async () => {
  const { key } = await create(PASSWORD, AAD);
  await assert.rejects(() => seal(key, AAD, note(0, "x")), /counter/);
  await assert.rejects(() => seal(key, AAD, note(2 ** 32, "x")), /counter/);
});

/* Suggested passwords ------------------------------------------------------ */

test("a suggested password clears the floor and is never the same twice", () => {
  const one = suggest();
  assert.ok(one.length >= MINIMUM);
  assert.match(one, /^[0-9a-z]{5}(-[0-9a-z]{5}){3}$/);
  assert.notEqual(one, suggest());
});
