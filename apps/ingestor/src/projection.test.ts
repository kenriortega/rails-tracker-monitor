import { test } from "node:test";
import assert from "node:assert/strict";
import { delaySecondsFrom, projectMovement, stanoxFrom } from "./projection";

const RECEIVED = new Date("2026-10-19T21:00:00.000Z");
const movement = (body: Record<string, unknown>) => ({header: {msg_type: "0003"}, body});

test("delay takes its sign from variation_status, not from the number", () => {
  assert.equal(delaySecondsFrom({timetable_variation: "3", variation_status: "LATE"}), 180);
  assert.equal(delaySecondsFrom({timetable_variation: "3", variation_status: "EARLY"}), -180);
  assert.equal(delaySecondsFrom({timetable_variation: "0", variation_status: "ON TIME"}), 0);
});

test("an uninterpretable variation yields no delay rather than a wrong zero", () => {
  assert.equal(delaySecondsFrom({timetable_variation: "2", variation_status: "OFF ROUTE"}), null);
  assert.equal(delaySecondsFrom({timetable_variation: "", variation_status: "LATE"}), null);
  assert.equal(delaySecondsFrom({variation_status: "LATE"}), null);
});

test("location codes are padded and rejected when not numeric", () => {
  assert.equal(stanoxFrom({loc_stanox: "123"}), "00123");
  assert.equal(stanoxFrom({loc_stanox: "87701"}), "87701");
  assert.equal(stanoxFrom({loc_stanox: "0"}), null);
  assert.equal(stanoxFrom({loc_stanox: "ABC"}), null);
  assert.equal(stanoxFrom({}), null);
});

test("only movement reports are projected", () => {
  assert.equal(projectMovement({header: {msg_type: "0001"}, body: {train_id: "A"}}, RECEIVED), null);
  assert.equal(projectMovement(movement({}), RECEIVED), null);
  assert.equal(projectMovement(null, RECEIVED), null);
});

test("the service date comes from the London date of the event", () => {
  // 1760000000000 is 09 October 2025 08:53 London, 07:53 UTC once decoded.
  const projected = projectMovement(movement({train_id: "725N79M919", actual_timestamp: "1760000000000"}), RECEIVED);
  assert.equal(projected?.serviceDate, "2025-10-09");
  assert.equal(projected?.observedAt.toISOString(), "2025-10-09T07:53:20.000Z");
});

test("without a usable timestamp the reception time dates the run", () => {
  const projected = projectMovement(movement({train_id: "A", actual_timestamp: "bad"}), RECEIVED);
  assert.equal(projected?.observedAt, RECEIVED);
  assert.equal(projected?.serviceDate, "2026-10-19");
});

test("the headcode is extracted from the train identifier", () => {
  assert.equal(projectMovement(movement({train_id: "725N79M919"}), RECEIVED)?.headcode, "5N79");
  assert.equal(projectMovement(movement({train_id: "ABCDEFGHIJ"}), RECEIVED)?.headcode, null);
});

test("the operator code is carried through when present", () => {
  assert.equal(projectMovement(movement({train_id: "A", toc_id: "23"}), RECEIVED)?.tocId, "23");
  assert.equal(projectMovement(movement({train_id: "A"}), RECEIVED)?.tocId, null);
  assert.equal(projectMovement(movement({train_id: "A", toc_id: ""}), RECEIVED)?.tocId, null);
});

test("termination and renumbering are carried through", () => {
  const terminated = projectMovement(movement({train_id: "A", train_terminated: "true"}), RECEIVED);
  assert.equal(terminated?.status, "terminated");
  assert.equal(projectMovement(movement({train_id: "A"}), RECEIVED)?.status, "running");
  const renamed = projectMovement(movement({train_id: "A", current_train_id: "B"}), RECEIVED);
  assert.equal(renamed?.renamedTo, "B");
  assert.equal(projectMovement(movement({train_id: "A", current_train_id: "A"}), RECEIVED)?.renamedTo, null);
});
