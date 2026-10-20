import { test } from "node:test";
import assert from "node:assert/strict";
import { headcodeFromTrainId } from "./identity";

test("the headcode comes from positions three to six", () => {
  assert.equal(headcodeFromTrainId("725N79M919"), "5N79");
  assert.equal(headcodeFromTrainId("505G81M919"), "5G81");
  assert.equal(headcodeFromTrainId("125E68M919"), "5E68");
});

test("anything that does not match the headcode shape yields null", () => {
  assert.equal(headcodeFromTrainId("7255555919"), null); // sin letra
  assert.equal(headcodeFromTrainId("72NN79M919"), null); // sin dígito inicial
  assert.equal(headcodeFromTrainId("725N7XM919"), null); // letra donde van dígitos
});

test("absent or short identifiers yield null instead of throwing", () => {
  for (const value of [null, undefined, "", "725N", 12345 as unknown as string]) {
    assert.equal(headcodeFromTrainId(value as string), null);
  }
});
