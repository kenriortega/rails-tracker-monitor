import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { MovementAudit, corpusRecords } from "./audit";
import { fetchFeed, readJson, readScheduleSample, safeErrorCode } from "./http";

test("signed download redirects never receive the portal credentials", async () => {
  const requests: {url: string; authorization: string | null}[] = [];
  const request: typeof fetch = async (input, options) => {
    requests.push({url: String(input), authorization: new Headers(options?.headers).get("authorization")});
    return requests.length === 1
      ? new Response(null, {status: 302, headers: {location: "https://example.s3.amazonaws.com/schedule?signature=example"}})
      : new Response("{}");
  };
  await fetchFeed("/ntrod/example", {username: "test-user", password: "test-secret"}, request);
  assert.ok(requests[0].authorization?.startsWith("Basic "));
  assert.equal(requests[1].authorization, null);
});

test("untrusted or insecure redirects are rejected before requesting them", async () => {
  let requests = 0;
  const request: typeof fetch = async () => {
    requests++;
    return new Response(null, {status: 302, headers: {location: "https://untrusted.example/download"}});
  };
  await assert.rejects(fetchFeed("/ntrod/example", {username: "u", password: "p"}, request), /REDIRECT_REJECTED/);
  assert.equal(requests, 1);
});

test("CORPUS gzip is decoded even when its magic bytes arrive separately", async () => {
  const expected = {TIPLOCDATA: [{STANOX: "00123", TIPLOC: "EXAMPLE"}]};
  const compressed = gzipSync(JSON.stringify(expected));
  const stream = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(compressed.subarray(0, 1));
    controller.enqueue(compressed.subarray(1, 7));
    controller.enqueue(compressed.subarray(7)); controller.close();
  }});
  assert.deepEqual(await readJson(new Response(stream)), expected);
});

test("schedule sampling cancels a long response after a recognized header", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new TextEncoder().encode('{"JsonTimetableV1":{"type":"full"}}\n'));
  }, cancel() {cancelled = true;}});
  const sample = await readScheduleSample(new Response(stream));
  assert.equal(sample.recordKind, "JsonTimetableV1");
  assert.equal(sample.sampleOnly, true);
  assert.equal(cancelled, true);
});

test("HTML login pages do not count as usable CORPUS or schedule data", async () => {
  await assert.rejects(readJson(new Response("<html>Login</html>")), /INVALID_JSON/);
  await assert.rejects(readScheduleSample(new Response("<html>Login</html>")), /INVALID_SCHEDULE/);
  assert.throws(() => corpusRecords({error: "not subscribed"}), /INVALID_CORPUS/);
});

test("movement coverage excludes activations and handles leading zero location codes", () => {
  const audit = new MovementAudit([{STANOX: "00123"}]);
  audit.consume(JSON.stringify([
    {header: {msg_type: "0001"}, body: {train_id: "A", loc_stanox: "123"}},
    {header: {msg_type: "0003"}, body: {train_id: "A", loc_stanox: "123", actual_timestamp: "1760000000000"}},
    {header: {msg_type: "0003"}, body: {train_id: "B", loc_stanox: "99999", actual_timestamp: "bad"}}
  ]), 1760000010000);
  const summary = audit.summary(true);
  assert.equal(summary.records, 3);
  assert.equal(summary.distinctTrainIds, 2);
  assert.equal(summary.movementLocations.present, 2);
  assert.equal(summary.movementLocations.coveragePercent, 50);
  assert.equal(summary.movementTimes.rawDifferenceSeconds?.median, 10);
  assert.equal(summary.movementTimes.invalid, 1);
});

test("absent references and malformed batches are not reported as verified positions", () => {
  const audit = new MovementAudit(null);
  audit.consume("not json"); audit.consume("[]"); audit.consume('[{"header":null}]');
  assert.equal(audit.summary(false).movementLocations.coveragePercent, null);
  assert.equal(audit.invalidJsonBatches, 1);
  assert.equal(audit.emptyBatches, 1);
  assert.equal(audit.invalidRecords, 1);
});

test("diagnostic error categories never echo sensitive server text", () => {
  assert.equal(safeErrorCode(new Error("Login failed for secret@example.com")), "AUTHENTICATION_REJECTED");
  assert.equal(safeErrorCode(new Error("Unexpected response: password=secret")), "REQUEST_OR_PROTOCOL_ERROR");
  assert.equal(safeErrorCode({cause: {code: "ENOTFOUND"}}), "ENOTFOUND");
});

test("movement times keep the raw difference and add a London-corrected one", () => {
  const audit = new MovementAudit(null);
  // 1760000000000 is 09 October 2025, inside BST: the encoding hides one hour.
  audit.consume(JSON.stringify([
    {header: {msg_type: "0003"}, body: {train_id: "A", loc_stanox: "123", actual_timestamp: "1760000000000"}}
  ]), 1760000010000);
  const times = audit.summary(false).movementTimes;
  assert.equal(times.rawDifferenceSeconds?.median, 10);
  assert.equal(times.correctedDifferenceSeconds?.median, 3610);
  assert.deepEqual(times.correction, {
    timezone: "Europe/London", applied: 1, ambiguous: 0, nonexistent: 0, offsetsSecondsSeen: [3600]
  });
});
