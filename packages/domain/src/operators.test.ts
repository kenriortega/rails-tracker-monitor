import { test } from "node:test";
import assert from "node:assert/strict";
import { operator } from "./operators";

test("a known operator resolves to its commercial name", () => {
  assert.equal(operator("25")?.label, "Great Western Railway");
  assert.equal(operator("23")?.label, "Northern");
  assert.equal(operator("33")?.label, "Elizabeth line");
  assert.equal(operator("25")?.atocCode, "GW");
});

test("a derived code without a curated name shows the code, never a guess", () => {
  // LF se derivó de los datos pero no está en la lista de nombres.
  const resolved = operator("12");
  assert.equal(resolved?.atocCode, "LF");
  assert.equal(resolved?.name, null);
  assert.equal(resolved?.label, "LF");
});

test("an unseen operator keeps showing its number", () => {
  const resolved = operator("66");
  assert.equal(resolved?.atocCode, null);
  assert.equal(resolved?.label, "Operador 66");
});

test("absent or blank identifiers yield null", () => {
  for (const value of [null, undefined, "", "  "]) assert.equal(operator(value), null);
});
