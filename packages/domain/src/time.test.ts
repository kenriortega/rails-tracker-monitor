import { test } from "node:test";
import assert from "node:assert/strict";
import { londonOffsetMs, resolveLondonLocalEpoch } from "./time";

test("a summer local time is resolved by subtracting the BST offset", () => {
  const resolved = resolveLondonLocalEpoch(Date.UTC(2026, 6, 1, 12, 0, 0));
  assert.equal(resolved.resolution, "unique");
  assert.equal(resolved.offsetSeconds, 3600);
  assert.equal(new Date(resolved.utc!).toISOString(), "2026-07-01T11:00:00.000Z");
});

test("a winter local time is already UTC and is left untouched", () => {
  const local = Date.UTC(2026, 0, 15, 12, 0, 0);
  const resolved = resolveLondonLocalEpoch(local);
  assert.equal(resolved.resolution, "unique");
  assert.equal(resolved.offsetSeconds, 0);
  assert.equal(resolved.utc, local);
});

test("the autumn fold is reported as ambiguous instead of guessed silently", () => {
  // 01:30 local occurs twice on 25 October 2026: once in BST, once in GMT.
  const resolved = resolveLondonLocalEpoch(Date.UTC(2026, 9, 25, 1, 30, 0));
  assert.equal(resolved.resolution, "ambiguous");
  assert.equal(resolved.offsetSeconds, 0);
  // Either side of the fold stays unique.
  assert.equal(resolveLondonLocalEpoch(Date.UTC(2026, 9, 25, 0, 30, 0)).resolution, "unique");
  assert.equal(resolveLondonLocalEpoch(Date.UTC(2026, 9, 25, 2, 30, 0)).resolution, "unique");
});

test("the spring gap yields no instant at all", () => {
  // 01:30 local never happens on 29 March 2026: the clock jumps 01:00 to 02:00.
  const resolved = resolveLondonLocalEpoch(Date.UTC(2026, 2, 29, 1, 30, 0));
  assert.equal(resolved.resolution, "nonexistent");
  assert.equal(resolved.utc, null);
  assert.equal(resolved.offsetSeconds, null);
});

test("the offset follows the transition rather than a fixed one hour shift", () => {
  assert.equal(londonOffsetMs(Date.UTC(2026, 9, 19, 21, 0, 0)), 3600000);
  assert.equal(londonOffsetMs(Date.UTC(2026, 9, 26, 12, 0, 0)), 0);
  // Sub-second input must not shift the offset itself.
  assert.equal(londonOffsetMs(Date.UTC(2026, 6, 1, 12, 0, 0) + 742), 3600000);
});
