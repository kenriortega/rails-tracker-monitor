import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH_SECONDS, SERVE_SECONDS, activatedInWindow, freshness } from "./freshness";

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

test("an activated train is shown around its scheduled departure, not its activation", () => {
  const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();
  assert.equal(activatedInWindow(at(60 * 60), NOW), true);           // sale en una hora
  assert.equal(activatedInWindow(at(-30 * 60), NOW), true);          // salió hace media hora y no reportó
  assert.equal(activatedInWindow(at(-90 * 60), NOW), false);         // debió salir hace rato
  assert.equal(activatedInWindow(at(5 * 60 * 60), NOW), false);      // sale demasiado tarde
});

test("an activated train without a scheduled departure is not kept by this rule", () => {
  assert.equal(activatedInWindow(null, NOW), false);
  assert.equal(activatedInWindow("no es una fecha", NOW), false);
});
