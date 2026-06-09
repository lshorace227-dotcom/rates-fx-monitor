// test/update-data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseValue, applyUpdate } from "../lib/update-data.js";

test("parseValue: empty -> skip", () => {
  assert.deepEqual(parseValue(""), { skip: true });
  assert.deepEqual(parseValue("   "), { skip: true });
});

test("parseValue: valid number -> value", () => {
  assert.deepEqual(parseValue("3.05"), { value: 3.05 });
  assert.deepEqual(parseValue(" 2.71 "), { value: 2.71 });
});

test("parseValue: invalid -> error", () => {
  assert.ok(parseValue("abc").error);
  assert.ok(parseValue("-1").error);
  assert.ok(parseValue("0").error);
  assert.ok(parseValue("150").error);
});

test("applyUpdate appends a new-date point, keeps ascending", () => {
  const out = applyUpdate([{ date: "2026-05-20", value: 3.0 }], 3.1, "2026-06-10");
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { date: "2026-06-10", value: 3.1 });
});

test("applyUpdate replaces same-date point (no duplicate)", () => {
  const out = applyUpdate([{ date: "2026-06-10", value: 3.0 }], 3.1, "2026-06-10");
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 3.1);
});

test("applyUpdate does not mutate input", () => {
  const input = [{ date: "2026-05-20", value: 3.0 }];
  applyUpdate(input, 3.1, "2026-06-10");
  assert.equal(input.length, 1);
});
