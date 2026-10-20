import { test } from "node:test";
import assert from "node:assert/strict";
import { coversDate, parseScheduleLine, readSchedules, type ScheduleRecord } from "./schedule";

const schedule = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  JsonScheduleV1: {
    CIF_train_uid: "C11288", schedule_start_date: "2026-05-18", schedule_end_date: "2026-12-12",
    CIF_stp_indicator: "P",
    schedule_segment: {
      signalling_id: "5N79",
      schedule_location: [
        {tiploc_code: "EUSTON", departure: "0900"},
        {tiploc_code: "WATFDJ"},
        {tiploc_code: "BHAMNWS", arrival: "1015"}
      ]
    },
    ...overrides
  }
});

test("a schedule line yields identity, window, endpoints and signalling id", () => {
  const record = parseScheduleLine(schedule())!;
  assert.equal(record.uid, "C11288");
  assert.equal(record.validFrom, "2026-05-18");
  assert.equal(record.validTo, "2026-12-12");
  assert.equal(record.stpIndicator, "P");
  assert.equal(record.originTiploc, "EUSTON");
  assert.equal(record.destinationTiploc, "BHAMNWS");
  assert.equal(record.signallingId, "5N79");
});

test("non schedule lines and malformed JSON are rejected", () => {
  assert.equal(parseScheduleLine('{"JsonTimetableV1":{"type":"full"}}'), null);
  assert.equal(parseScheduleLine('{"TiplocV1":{"tiploc_code":"EUSTON"}}'), null);
  assert.equal(parseScheduleLine("no es json"), null);
  assert.equal(parseScheduleLine(JSON.stringify({JsonScheduleV1: {CIF_train_uid: ""}})), null);
});

test("a schedule without locations keeps identity but has no endpoints", () => {
  const record = parseScheduleLine(schedule({schedule_segment: {signalling_id: "1A01"}}))!;
  assert.equal(record.originTiploc, null);
  assert.equal(record.destinationTiploc, null);
});

test("the validity window is inclusive at both ends", () => {
  const record = parseScheduleLine(schedule())!;
  assert.equal(coversDate(record, "2026-05-18"), true);
  assert.equal(coversDate(record, "2026-12-12"), true);
  assert.equal(coversDate(record, "2026-05-17"), false);
  assert.equal(coversDate(record, "2026-12-13"), false);
});

test("the stream keeps what covers the date and counts the rest", async () => {
  const lines = [
    '{"JsonTimetableV1":{"type":"full"}}',
    schedule(),
    schedule({schedule_start_date: "2020-01-01", schedule_end_date: "2020-02-01"}),
    schedule({CIF_stp_indicator: "C"}),
    "",
    '{"TiplocV1":{}}'
  ].join("\n");
  const kept: ScheduleRecord[] = [];
  // Partido a mitad de línea a propósito: el lector debe recomponerla.
  const chunks = [lines.slice(0, 120), lines.slice(120)];
  const totals = await readSchedules((async function* () { for (const c of chunks) yield c; })(), "2026-10-20", r => { kept.push(r); });
  assert.equal(kept.length, 1);
  assert.equal(totals.schedules, 1);
  assert.equal(totals.outsideWindow, 1);
  assert.equal(totals.cancellations, 1);
  assert.equal(totals.skipped, 2);
});
