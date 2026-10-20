import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH_SECONDS, SERVE_SECONDS, freshness } from "./freshness";

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const agoSeconds = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

test("a recent report is fresh and an old one expires", () => {
  assert.equal(freshness(agoSeconds(60), NOW), "fresh");
  assert.equal(freshness(agoSeconds(FRESH_SECONDS - 1), NOW), "fresh");
  assert.equal(freshness(agoSeconds(FRESH_SECONDS + 1), NOW), "stale");
  assert.equal(freshness(agoSeconds(SERVE_SECONDS + 1), NOW), "expired");
});

test("the boundaries belong to the fresher side", () => {
  assert.equal(freshness(agoSeconds(FRESH_SECONDS), NOW), "fresh");
  assert.equal(freshness(agoSeconds(SERVE_SECONDS), NOW), "stale");
});

test("a timestamp ahead of now counts as fresh, not as invalid", () => {
  // TRUST publica marcas al minuto, así que un tercio llega por delante de su recepción.
  assert.equal(freshness(agoSeconds(-200), NOW), "fresh");
});

test("an unparseable timestamp expires instead of passing as fresh", () => {
  assert.equal(freshness("no es una fecha", NOW), "expired");
});

test("Date and ISO string are treated alike", () => {
  assert.equal(freshness(new Date(NOW - 60_000), NOW), "fresh");
});
