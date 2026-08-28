/**
 * The flow App.svelte drives, with the PDS and the device's memory as two plain
 * variables. It is here because the properties worth having are properties of
 * the sequence -- what a password change does to yesterday's key, what a device
 * does when the repo goes backwards -- and none of them are visible one call at
 * a time.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { create, open, seal, unlock, wrongPassword } from "./crypto.ts";
import { asValue, context, type Note, parse, VERSION } from "./record.ts";

const DID = "did:plc:example";
const aad = context(DID);
const OLD = "a password long enough";
const NEW = "a different long password";

test("create, save, re-key, and refuse a wound-back repo", async () => {
  // The PDS, and what this device remembers of it.
  let pds: Record<string, unknown> = {};
  let seen = 0;

  /** What `enter` does: decrypt, then refuse a note older than one already read. */
  const enter = async (key: CryptoKey) => {
    const plain = await open(key, aad, parse(pds));
    if (plain.counter < seen) throw new Error("older than this device has seen");
    seen = plain.counter;
    return plain;
  };

  const put = async (key: CryptoKey, text: string, locked?: Note) => {
    pds = asValue({
      ...(locked ?? parse(pds)),
      ...(await seal(key, aad, { counter: seen + 1, text })),
      updatedAt: new Date().toISOString(),
    });
  };

  // Setting a password writes the record straight away.
  const first = await create(OLD, aad);
  await put(first.key, "", { v: VERSION, ...first.locked, body: "", updatedAt: "" });
  assert.equal((await enter(first.key)).text, "");

  await put(first.key, "milk");
  // Anyone watching a public repo keeps a copy of every version that goes by.
  const archived = structuredClone(pds);
  assert.equal((await enter(first.key)).text, "milk");

  // A fresh tab, opened with the password rather than a remembered key.
  assert.equal((await enter(await unlock(parse(pds), OLD, aad))).text, "milk");

  // The password change: read under the old key, publish under a new one.
  const carried = (await open(first.key, aad, parse(pds))).text;
  const second = await create(NEW, aad);
  await put(second.key, carried, { v: VERSION, ...second.locked, body: "", updatedAt: "" });
  assert.equal((await enter(second.key)).text, "milk");

  // H1, which is the whole reason the change re-keys: someone who kept the old
  // record and later broke the old password holds a key to nothing current.
  const cracked = await unlock(parse(archived), OLD, aad);
  assert.equal((await open(cracked, aad, parse(archived))).text, "milk");
  await assert.rejects(
    () => open(cracked, aad, parse(pds)),
    (cause) => wrongPassword(cause),
  );

  // M3: the server serves yesterday's record instead of today's. It is intact,
  // it is authentic, and it is a lie.
  pds = archived;
  await assert.rejects(() => enter(cracked), /older than this device has seen/);
});
