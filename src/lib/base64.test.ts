import assert from "node:assert/strict";
import { test } from "node:test";
import { type Bytes, fromBase64, join, toBase64 } from "./base64.ts";

const bytes = (...values: number[]): Bytes => new Uint8Array(values);

test("round trips every byte value", () => {
  const all = new Uint8Array(256).map((_, index) => index);
  assert.deepEqual(fromBase64(toBase64(all)), all);
});

test("survives a payload too big to spread over an argument list", () => {
  const big = new Uint8Array(200_000).fill(7);
  assert.deepEqual(fromBase64(toBase64(big)), big);
});

test("rejects a field that is not base64", () => {
  assert.throws(() => fromBase64("not base64!"));
});

test("join concatenates", () => {
  assert.deepEqual(join(bytes(1, 2), bytes(3)), bytes(1, 2, 3));
  assert.deepEqual(join(bytes(), bytes(9)), bytes(9));
});
