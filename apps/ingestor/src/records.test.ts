import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, deduplicationKey, observedAtFrom, rowsFromBatch, toRawEventRow } from "./records";

const RECEIVED = new Date("2026-10-19T21:00:00.000Z");

test("the deduplication key ignores key order but not content", () => {
  const a = {header: {msg_type: "0003"}, body: {train_id: "A", loc_stanox: "12345"}};
  const b = {body: {loc_stanox: "12345", train_id: "A"}, header: {msg_type: "0003"}};
  assert.equal(deduplicationKey(a), deduplicationKey(b));
  const different = {header: {msg_type: "0003"}, body: {train_id: "B", loc_stanox: "12345"}};
  assert.notEqual(deduplicationKey(a), deduplicationKey(different));
});

test("canonical form sorts nested objects and preserves array order", () => {
  assert.equal(canonicalize({b: 1, a: {d: 2, c: [3, 1]}}), '{"a":{"c":[3,1],"d":2},"b":1}');
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test("observed_at resolves the London encoding instead of trusting the raw epoch", () => {
  // 1760000000000 is 09 October 2025 inside BST: one hour is hidden in the value.
  assert.equal(observedAtFrom({actual_timestamp: "1760000000000"})?.toISOString(), "2025-10-09T07:53:20.000Z");
  assert.equal(observedAtFrom({actual_timestamp: "1760000000000"})!.getTime(), 1760000000000 - 3600000);
});

test("absent, empty or out of range timestamps leave observed_at null", () => {
  for (const value of [undefined, null, "", "bad", 0, 1, 9999999999999999]) {
    assert.equal(observedAtFrom({actual_timestamp: value}), null, `unexpected date for ${String(value)}`);
  }
});

test("observed_at may be later than received_at and is not clamped", () => {
  // The London wall-clock encoding plus minute granularity puts events ahead of reception.
  const ahead = observedAtFrom({actual_timestamp: String(Date.UTC(2026, 6, 1, 13, 0, 0))});
  assert.ok(ahead!.getTime() > Date.UTC(2026, 6, 1, 11, 59, 0));
});

test("malformed records are skipped rather than stored as rows", () => {
  assert.equal(toRawEventRow(null, RECEIVED), null);
  assert.equal(toRawEventRow({header: {}}, RECEIVED), null);
  assert.equal(toRawEventRow({header: [], body: {}}, RECEIVED), null);
  assert.equal(rowsFromBatch("not json", RECEIVED).skipped, 1);
  assert.equal(rowsFromBatch('{"not":"an array"}', RECEIVED).skipped, 1);
});

test("a batch yields one row per well formed record and counts the rest", () => {
  const batch = JSON.stringify([
    {header: {msg_type: "0003"}, body: {train_id: "A", actual_timestamp: "1760000000000"}},
    {header: {msg_type: "0001"}, body: {train_id: "B"}},
    {broken: true}
  ]);
  const {rows, skipped} = rowsFromBatch(batch, RECEIVED);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 1);
  assert.equal(rows[0].observedAt?.toISOString(), "2025-10-09T07:53:20.000Z");
  assert.equal(rows[1].observedAt, null);
  assert.equal(rows[0].receivedAt, RECEIVED);
  assert.equal(rows[0].feed, "TRUST_MVT");
  assert.notEqual(rows[0].deduplicationKey, rows[1].deduplicationKey);
});
